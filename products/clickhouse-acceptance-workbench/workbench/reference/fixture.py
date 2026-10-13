#!/usr/bin/env python3
"""Own one reference ClickHouse lifetime around the original receiving programme."""
import argparse
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import secrets
import signal
import socket
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from xml.sax.saxutils import escape

VERSION = "26.8.24.9"
BINARY_BYTES = 799107680
SEED_SHA256 = "443b0c3b4add59aa60a5d97b296e3721f5192562b9684399da9f7b155074661e"
ROOT = pathlib.Path(__file__).resolve().parent
COLUMNS = [
    {"name": "record_id", "type": "UInt64"},
    {"name": "ledger", "type": "UInt64"},
    {"name": "account", "type": "String"},
    {"name": "amount", "type": "Decimal(38, 7)"},
    {"name": "memo", "type": "Nullable(String)"},
    {"name": "successful", "type": "Bool"},
    {"name": "observed_at", "type": "DateTime64(6, 'UTC')"},
]
EXPECTED = [
    ["18446744073709551615", "9007199254740993", "merchant-demo",
     "123456789012345678901234567890.1234567", None, "1", "2026-10-11 17:00:00.123456"],
    ["18446744073709551614", "9007199254740994", "merchant-demo",
     "0.0000001", "\\N", "1", "2026-10-11 17:00:01.000001"],
    ["18446744073709551615", "9007199254740994", "merchant-demo",
     "12.3400000", "Example — 東京", "0", "2026-10-11 17:00:02.654321"],
]
ROWS_SQL = (
    "SELECT toString(record_id) AS record_id, toString(ledger) AS ledger, account, "
    "toString(amount) AS amount, memo, toString(toUInt8(successful)) AS successful, "
    "toString(observed_at) AS observed_at FROM starforge_example.transfers "
    "ORDER BY ledger, record_id FORMAT JSON"
)

def load_worker():
    spec = importlib.util.spec_from_file_location("altinity_original_worker", ROOT.parent / "commissioning/worker.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def digest(path):
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(data)
    return {"bytes": path.stat().st_size, "sha256": hasher.hexdigest()}

def check(condition, message):
    if not condition:
        raise ValueError(message)

def private_root(path):
    path = path.expanduser().absolute()
    check(not path.is_symlink(), "Select the original real private fixture directory")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = path.resolve()
    info = path.stat()
    check(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid(),
          "The fixture directory must belong to the current operator")
    check(info.st_mode & 0o077 == 0, "The fixture directory must be private (0700)")
    return path


# A maintained receiver may observe the original immutable application edition.
# Admission occurs before importing its original worker or starting native work.
SOURCE_EXTENSIONS = {".mjs", ".cjs", ".js", ".json", ".md", ".html", ".css",
                     ".py", ".toml", ".yaml", ".yml", ".txt", ".csv", ".tsv",
                     ".sql", ".go", ".mod", ".sum"}
SOURCE_SKIPS = {"node_modules", ".git", ".runtime", "dist"}

def measured(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}

def same_identity(actual, expected):
    return (isinstance(actual, dict) and isinstance(expected, dict) and type(expected.get("bytes")) is int
            and expected["bytes"] >= 0 and isinstance(expected.get("sha256"), str)
            and re.fullmatch(r"[a-f0-9]{64}", expected["sha256"]) is not None
            and actual.get("bytes") == expected["bytes"] and actual.get("sha256") == expected["sha256"])

def canonical_path(value):
    check(isinstance(value, str) and value and "\x00" not in value,
          "Keep canonical absolute original observer paths")
    path = pathlib.Path(value)
    check(path.is_absolute() and str(path) == value and str(path.resolve(strict=True)) == value,
          "Select the existing canonical original path without symlinks")
    return path

def safe_source_path(value):
    check(isinstance(value, str) and value and "\\" not in value and "\x00" not in value
          and not value.startswith("/") and all(p not in ("", ".", "..") for p in value.split("/")),
          "Retain portable complete source member names")
    return value

def checked_file(path, private=False, retain=False, maximum=None):
    path = canonical_path(str(path))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        check(stat.S_ISREG(before.st_mode), "Retain an original regular file")
        if private:
            check(before.st_uid == os.getuid() and before.st_mode & 0o077 == 0 and before.st_nlink == 1,
                  "Keep observer and operation records private to their original operator")
        check(maximum is None or before.st_size <= maximum, "The complete selected record exceeds its supported size")
        hasher, parts, count = hashlib.sha256(), [], 0
        while True:
            data = os.read(fd, 1024 * 1024)
            if not data:
                break
            count += len(data)
            check(count <= before.st_size, "The selected original file grew while being read")
            hasher.update(data)
            if retain:
                parts.append(data)
        after = os.fstat(fd)
        stamp = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        check(count == before.st_size and stamp(before) == stamp(after),
              "The complete selected original file changed while being read")
        return {"bytes": count, "sha256": hasher.hexdigest()}, b"".join(parts) if retain else None
    finally:
        os.close(fd)

def checked_json(path, private=False):
    identity, data = checked_file(path, private=private, retain=True, maximum=32 * 1024 * 1024)
    value = json.loads(data.decode("utf-8", "strict"))
    check(isinstance(value, dict), "Retain a complete original JSON record")
    return value, identity, data

def editable_names(root):
    names = set()
    def visit(directory):
        for entry in sorted(directory.iterdir(), key=lambda item: item.name):
            if entry.name in SOURCE_SKIPS:
                continue
            mode = entry.lstat().st_mode
            check(not stat.S_ISLNK(mode), "The complete editable source contains a symlink")
            if stat.S_ISDIR(mode):
                visit(entry)
            elif stat.S_ISREG(mode) and (entry.suffix in SOURCE_EXTENSIONS
                                        or re.match(r"^(LICENSE|NOTICE)(\.|$)", entry.name)):
                names.add(entry.relative_to(root).as_posix())
    visit(root)
    return names

def admit_source(root, expected):
    path = root / "SOURCE_MANIFEST.json"
    manifest, identity, _ = checked_json(path)
    check(same_identity(identity, expected) and manifest.get("schema") == "commons.editable-source-manifest.v1",
          "Select the exact complete source manifest for this edition")
    rows = manifest.get("files")
    check(isinstance(rows, list) and len(rows) == 53, "Retain all 53 original editable-source leaves")
    declared = {}
    for row in rows:
        check(isinstance(row, dict), "Retain each complete source descriptor")
        name = safe_source_path(row.get("path"))
        check(name not in declared and name != "SOURCE_MANIFEST.json", "A source manifest repeats its selected file")
        actual, _ = checked_file(root / name)
        check(same_identity(actual, row), "The selected original source member changed: " + name)
        declared[name] = actual
    check(editable_names(root) == set(declared) | {"SOURCE_MANIFEST.json"},
          "The manifest must cover the entire selected editable source")
    for name in ("reference/fixture.py", "reference/fixture-input.json", "reference/seed.sql",
                 "commissioning/worker.py", "receiving/receive.mjs", "receiving/browser.mjs",
                 "commissioning/server.mjs", "web/app.mjs", "cli.mjs"):
        check(name in declared, "The selected source lacks its original application/receiving closure")
    return identity, declared

def command_selection(command):
    check(isinstance(command, list) and len(command) >= 2
          and all(isinstance(part, str) and part and "\x00" not in part for part in command),
          "Retain the original receiving argv")
    allowed = {"--source", "--directory", "--config", "--source-manifest",
               "--python", "--playwright", "--chromium"}
    check((len(command) - 2) % 2 == 0, "Retain complete original option/value pairs")
    options = {}
    for offset in range(2, len(command), 2):
        key, value = command[offset:offset + 2]
        check(key in allowed and key not in options, "Keep each original receiving option once")
        options[key] = value
    check(allowed - {"--python"} <= set(options), "Keep the complete original receiving selection")
    return options

def admit_observer(args, command):
    descriptor_path = canonical_path(str(args.source_observer))
    descriptor, descriptor_identity, descriptor_bytes = checked_json(descriptor_path, private=True)
    check(descriptor.get("schema") == "altinity.source-observer.v1"
          and isinstance(descriptor.get("id"), str)
          and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}", descriptor["id"]),
          "Select one original source-observer identity")
    check(isinstance(descriptor.get("reason"), str) and descriptor["reason"].strip()
          and isinstance(descriptor.get("at"), str), "Retain the source observer's actual reason and preparation time")
    prepared = datetime.datetime.fromisoformat(descriptor["at"].replace("Z", "+00:00"))
    check(prepared.tzinfo is not None, "Retain the observer's explicit UTC offset")
    normalized = [part for part in command if part != "--resume"]
    check(normalized == descriptor.get("originalCommand"), "Keep the exact original command selected by this observer")
    options = command_selection(normalized)
    baseline = canonical_path(descriptor.get("baseline", {}).get("root"))
    observer = canonical_path(descriptor.get("observer", {}).get("root"))
    operation_root = canonical_path(options["--directory"])
    check(args.resume and (args.directory / "fixture.json").is_file(),
          "A source observer resumes the existing original fixture; it cannot create a new one")
    check(descriptor_path == operation_root / "merchant-reference" / "source-observers" / descriptor["id"] / "request.json",
          "Select the observer request retained under its original receiving operation")
    check(options["--source"] == str(baseline)
          and options["--source-manifest"] == str(baseline / "SOURCE_MANIFEST.json")
          and normalized[1] == str(baseline / "receiving" / "receive.mjs"),
          "Retain the original baseline source, manifest and receiver selection")
    check(pathlib.Path(__file__).resolve() == observer / "reference" / "fixture.py",
          "Invoke the fixture from the complete admitted observer edition")
    baseline_identity, _ = admit_source(baseline, descriptor["baseline"].get("manifest"))
    observer_identity, observer_files = admit_source(observer, descriptor["observer"].get("manifest"))
    self_identity, _ = checked_file(pathlib.Path(__file__).resolve())
    check(same_identity(self_identity, observer_files["reference/fixture.py"]),
          "The executing observer fixture differs from its retained source")
    config_path = canonical_path(descriptor.get("config", {}).get("path"))
    config_identity, _ = checked_file(config_path)
    check(str(config_path) == options["--config"] and same_identity(config_identity, descriptor["config"]),
          "Retain the exact original receiving configuration")
    expected = list(normalized)
    expected[1] = str(observer / "receiving" / "receive.mjs")
    expected += ["--source-observer", str(descriptor_path)]
    check(descriptor.get("command") == expected,
          "The observer may only replace the receiver and add its explicit original descriptor")
    # Additional documented metadata is retained in full. When supplied its
    # source/archive/request binding is verified, not used as executable input.
    if "sourceArchive" in descriptor:
        archive = descriptor["sourceArchive"]
        check(isinstance(archive, dict) and isinstance(archive.get("files"), list), "Retain the complete observer source archive")
        archive_root = canonical_path(archive.get("directory"))
        check(observer == archive_root / "workbench" and archive_root == descriptor_path.parent / "source",
              "Keep the complete observer edition next to its original request")
        names = set()
        for row in archive["files"]:
            check(isinstance(row, dict), "Retain each complete observer archive member")
            name = safe_source_path(row.get("path"))
            check(name not in names, "The complete observer source archive repeats a member")
            names.add(name)
            actual, _ = checked_file(archive_root / name)
            check(same_identity(actual, row), "An original observer archive member changed: " + name)
        expected_names = {"workbench/" + name for name in observer_files}
        expected_names.update({"workbench/SOURCE_MANIFEST.json", "source-observer.mjs",
                               "source-editions.mjs", "original-source.json"})
        check(expected_names == names and editable_names(archive_root) == names,
              "Retain every observer source and support file in the exact complete archive")
    if "referenceRequest" in descriptor:
        selected = descriptor["referenceRequest"]
        check(isinstance(selected, dict), "Retain the original reference request descriptor")
        original_request, original_identity, _ = checked_json(canonical_path(selected.get("path")))
        check(same_identity(original_identity, selected)
              and original_request.get("schema") == "stellar-forge.clickhouse-acceptance-reference-request.v1",
              "The original complete reference request changed")
        for key, expected_value in (("source", str(baseline)), ("directory", str(operation_root)),
                                    ("fixtureDirectory", str(args.directory.resolve())),
                                    ("config", str(config_path)), ("sourceManifest", options["--source-manifest"]),
                                    ("node", normalized[0]), ("playwright", options["--playwright"]),
                                    ("chromium", options["--chromium"])):
            check(original_request.get(key) == expected_value, "The observer differs from the original reference " + key)
        check(pathlib.Path(original_request.get("clickhouse", "")).resolve(strict=True) == args.clickhouse.resolve(strict=True),
              "Retain the original fixture binary selected by the reference request")
        if "--python" in options:
            check(original_request.get("python") == options["--python"], "Retain the original receiving Python selection")
        if "command" in original_request:
            check(original_request["command"] == normalized, "The original reference argv changed")
    original_snapshot = None
    if "originalOperation" in descriptor:
        snapshot_path = descriptor_path.parent / "original-operation.json"
        snapshot, snapshot_identity, original_snapshot = checked_json(snapshot_path, private=True)
        check(same_identity(snapshot_identity, descriptor["originalOperation"])
              and snapshot.get("schema") == "altinity.complete-receiving.v1"
              and snapshot.get("id") == descriptor.get("operationId"),
              "Retain the exact original operation snapshot selected before observer dispatch")
    context = {"descriptor": descriptor, "descriptor_identity": descriptor_identity,
               "descriptor_bytes": descriptor_bytes, "descriptor_path": descriptor_path,
               "baseline": baseline, "observer": observer, "operation_root": operation_root,
               "baseline_identity": baseline_identity, "observer_identity": observer_identity,
               "config_identity": config_identity, "original_command": normalized,
               "command": expected, "self_identity": self_identity, "original_snapshot": original_snapshot}
    current_observer_operation(context)
    return context

def current_observer_operation(context):
    descriptor, root = context["descriptor"], context["operation_root"]
    state, _, _ = checked_json(root / "operation.json", private=True)
    selection = state.get("selection", {})
    check(state.get("schema") == "altinity.complete-receiving.v1" and state.get("id") == descriptor.get("operationId")
          and state.get("status") in ("prepared", "running", "interrupted", "complete")
          and selection.get("schema") == "altinity.complete-receiving.v1"
          and same_identity(selection.get("sourceManifest", {}), context["baseline_identity"])
          and same_identity(selection.get("config", {}), context["config_identity"])
          and selection.get("node", {}).get("executable") == context["original_command"][0]
          and selection.get("expectedRows") == 3,
          "Continue the same original receiving operation and its immutable source/configuration/runtime selection")
    original_manifest, _ = checked_file(root / "source-manifest.json", private=True)
    check(same_identity(original_manifest, context["baseline_identity"]), "The original retained source manifest changed")
    if context["original_snapshot"] is not None:
        original = json.loads(context["original_snapshot"].decode("utf-8", "strict"))
        check(original.get("selection") == selection, "The retained original operation selection changed")
    if state["status"] == "complete":
        result, result_identity, _ = checked_json(root / "CUSTOMER_RESULT.json", private=True)
        check(same_identity(result_identity, state.get("resultIdentity"))
              and result.get("schema") == "altinity.customer-result.v1"
              and result.get("status") == "complete" and result.get("operationId") == state["id"]
              and same_identity(result.get("sourceManifest", {}), context["baseline_identity"]),
              "Keep the complete original result selected by its finished operation")
    return state

def retain_observer_attempt(context, root, worker, operation):
    base = private_root(root / "source-observers")
    directory = private_root(base / context["descriptor"]["id"])
    worker.atomic(directory / "request.json", context["descriptor_bytes"], True)
    if context["original_snapshot"] is not None:
        worker.atomic(directory / "original-operation.json", context["original_snapshot"], True)
    previous = root / "fixture-result.json"
    if previous.exists():
        previous_identity, data = checked_file(previous, private=True, retain=True, maximum=32 * 1024 * 1024)
        previous_directory = private_root(directory / "previous-results")
        worker.atomic(previous_directory / (previous_identity["sha256"] + ".json"), data, True)
    attempts = private_root(directory / "attempts")
    attempt = private_root(attempts / secrets.token_hex(16))
    actual = list(context["command"]) + ["--resume"]
    request = {"schema": "altinity.source-observer-fixture-attempt.v1",
               "id": attempt.name, "observerId": context["descriptor"]["id"],
               "operationId": context["descriptor"]["operationId"], "preparedAt": worker.now(),
               "request": {"path": str(context["descriptor_path"]), **context["descriptor_identity"]},
               "baselineManifest": context["baseline_identity"], "observerManifest": context["observer_identity"],
               "fixtureSource": context["self_identity"], "originalCommand": context["original_command"],
               "command": actual, "cwd": str(context["baseline"]),
               "receiverMode": "reuse-complete" if operation["status"] == "complete" else "observer"}
    worker.save(attempt / "command.json", request, True)
    context["attempt"] = attempt
    context["attempt_request"] = request
    return actual


def unused_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]

def server_xml(root, private):
    path = lambda part: escape(str(root / part)) + "/"
    return (
        "<clickhouse><logger><level>warning</level><console>true</console></logger>"
        "<listen_host>127.0.0.1</listen_host><http_port>" + str(private["port"]) + "</http_port>"
        "<path>" + path("data") + "</path><tmp_path>" + path("tmp") + "</tmp_path>"
        "<access_control_path>" + path("access") + "</access_control_path>"
        "<max_thread_pool_size>256</max_thread_pool_size>"
        "<background_pool_size>2</background_pool_size><background_schedule_pool_size>2</background_schedule_pool_size>"
        "<background_buffer_flush_schedule_pool_size>1</background_buffer_flush_schedule_pool_size>"
        "<background_message_broker_schedule_pool_size>1</background_message_broker_schedule_pool_size>"
        "<background_distributed_schedule_pool_size>1</background_distributed_schedule_pool_size>"
        "<background_move_pool_size>1</background_move_pool_size>"
        "<background_fetches_pool_size>1</background_fetches_pool_size>"
        "<background_common_pool_size>2</background_common_pool_size>"
        "<mark_cache_size>16777216</mark_cache_size><uncompressed_cache_size>0</uncompressed_cache_size>"
        "<merge_tree><number_of_free_entries_in_pool_to_lower_max_size_of_merge>0</number_of_free_entries_in_pool_to_lower_max_size_of_merge>"
        "<number_of_free_entries_in_pool_to_execute_mutation>0</number_of_free_entries_in_pool_to_execute_mutation>"
        "<number_of_free_entries_in_pool_to_execute_optimize_entire_partition>0</number_of_free_entries_in_pool_to_execute_optimize_entire_partition></merge_tree>"
        "<users><default><password>" + private["admin"] + "</password><networks><ip>127.0.0.1</ip></networks>"
        "<profile>default</profile><quota>default</quota><access_management>1</access_management></default></users>"
        "<profiles><default><max_memory_usage>268435456</max_memory_usage><max_threads>2</max_threads></default></profiles>"
        "<quotas><default/></quotas></clickhouse>"
    )

class Reference:
    def __init__(self, root, private, worker):
        self.root, self.private, self.worker = root, private, worker
        self.endpoint = "http://127.0.0.1:" + str(private["port"]) + "/"
        self.opener = urllib.request.build_opener(worker.NoRedirect())

    def sql(self, query, password=None, user="default"):
        parameters = {"wait_end_of_query": "1", "max_execution_time": "30",
                      "max_threads": "2", "max_memory_usage": "268435456"}
        request = urllib.request.Request(
            self.endpoint + "?" + urllib.parse.urlencode(parameters),
            data=query.encode("utf-8"),
            headers={"X-ClickHouse-User": user,
                     "X-ClickHouse-Key": password if password is not None else self.private["admin"],
                     "Content-Type": "text/plain; charset=utf-8"},
            method="POST")
        try:
            with self.opener.open(request, timeout=40) as response:
                body = response.read(4 * 1024 * 1024 + 1)
                check(len(body) <= 4 * 1024 * 1024, "Reference response exceeds its complete metadata/three-row size")
                check(response.status == 200 and response.headers.get("X-ClickHouse-Exception-Code", "0") == "0",
                      "Reference command did not complete successfully")
                return body
        except urllib.error.HTTPError as error:
            raise RuntimeError("Reference native HTTP command failed with status " + str(error.code)) from None

    def json(self, query):
        return json.loads(self.sql(query).decode("utf-8", "strict"))

    def rows(self):
        rows = self.json(ROWS_SQL)["data"]
        return [[row[column["name"]] for column in COLUMNS] for row in rows]

    def ready(self, database):
        for _ in range(300):
            check(database.poll() is None, "Owned ClickHouse server exited; its private native.log retains the cause")
            try:
                version = self.sql("SELECT version()").decode().strip()
                check(version == VERSION, "The actual server is not the original ClickHouse " + VERSION)
                return
            except (OSError, urllib.error.URLError, TimeoutError):
                time.sleep(0.1)
        raise RuntimeError("Owned ClickHouse server did not become ready; retain this fixture directory")

    def prepare(self, seed):
        statements = [part.strip() for part in seed.decode("utf-8").split(";") if part.strip()]
        check(len(statements) == 3, "The original seed statement count changed")
        self.sql(statements[0])
        present = self.json(
            "SELECT engine,toString(uuid) AS uuid FROM system.tables "
            "WHERE database='starforge_example' AND name='transfers' FORMAT JSON")["data"]
        if not present:
            self.sql(statements[1])
        present = self.json(
            "SELECT engine,toString(uuid) AS uuid FROM system.tables "
            "WHERE database='starforge_example' AND name='transfers' FORMAT JSON")["data"]
        check(len(present) == 1 and present[0]["engine"] == "Memory", "The original source table engine changed")
        columns = self.json(
            "SELECT name,type FROM system.columns WHERE database='starforge_example' "
            "AND table='transfers' ORDER BY position FORMAT JSON")["data"]
        check(columns == COLUMNS, "The original source columns changed")
        existing = self.rows()
        # A Memory table is empty after its owned server restarts. Reload only an
        # empty original source and then compare every cell. Never change a candidate.
        if not existing:
            try:
                self.sql(statements[2])
            except (OSError, urllib.error.URLError, RuntimeError, TimeoutError):
                check(self.rows() == EXPECTED, "Retained seed insertion needs reconciliation from its actual rows")
        check(self.rows() == EXPECTED, "The retained source does not contain the exact three original rows")
        self.sql("CREATE DATABASE IF NOT EXISTS altinity_acceptance ENGINE = Atomic")
        databases = self.json("SELECT engine FROM system.databases WHERE name='altinity_acceptance' FORMAT JSON")["data"]
        check(databases == [{"engine": "Atomic"}], "The retained candidate database is not Atomic")
        for account, key in [("fixture_source", "source"), ("fixture_target", "target")]:
            self.sql("CREATE USER IF NOT EXISTS " + account + " IDENTIFIED BY " + self.worker.lit(self.private[key]))
            self.sql("GRANT SELECT ON system.tables TO " + account)
            self.sql("GRANT SELECT ON system.columns TO " + account)
            self.sql("GRANT SELECT ON system.databases TO " + account)
        self.sql("GRANT SELECT ON starforge_example.transfers TO fixture_source")
        self.sql("GRANT SELECT, CREATE TABLE, INSERT ON altinity_acceptance.* TO fixture_target")
        # Verify the retained accounts through their real credential path.
        for key, account in [("source", "fixture_source"), ("target", "fixture_target")]:
            actual = self.sql("SELECT currentUser()", self.private[key], account).decode().strip()
            check(actual == account, "The retained reference account identity changed")
        return {"version": VERSION, "sourceUuid": present[0]["uuid"], "sourceEngine": "Memory",
                "sourceRows": 3, "orderedRowsSha256": self.worker.sha(self.worker.encoded(EXPECTED)),
                "targetDatabase": "altinity_acceptance", "targetDatabaseEngine": "Atomic"}

    def environment(self):
        environment = os.environ.copy()
        for key in ["source", "target"]:
            prefix = "ALTINITY_" + key.upper() + "_"
            environment.update({prefix + "URL": self.endpoint, prefix + "USER": "fixture_" + key,
                                prefix + "PASSWORD": self.private[key]})
        return environment

def close_owned(child):
    """Reap this lifetime's child and retain every attempted shutdown outcome."""
    outcome = {"owned": child is not None, "runningBefore": None,
               "terminateRequested": False, "forceKill": False,
               "reaped": False, "exit": None, "errors": [], "acceptedNormal": False}
    if child is None:
        return outcome

    def failed(step, error):
        outcome["errors"].append({"step": step, "type": type(error).__name__,
                                  "message": str(error)[:2000]})

    try:
        prior = child.poll()
        outcome["runningBefore"] = prior is None
        if prior is not None:
            outcome["exit"], outcome["reaped"] = prior, True
            return outcome
    except BaseException as error:
        failed("poll", error)
    # Even a poll/terminate failure must not skip a reap attempt or the other child.
    try:
        child.terminate()
        outcome["terminateRequested"] = True
    except BaseException as error:
        failed("terminate", error)
    try:
        outcome["exit"] = child.wait(timeout=30)
        outcome["reaped"] = True
    except subprocess.TimeoutExpired as error:
        failed("wait-after-terminate", error)
        outcome["forceKill"] = True
        try:
            child.kill()
        except BaseException as error:
            failed("kill", error)
        try:
            outcome["exit"] = child.wait(timeout=10)
            outcome["reaped"] = True
        except BaseException as error:
            failed("wait-after-kill", error)
    except BaseException as error:
        failed("wait-after-terminate", error)
        # A failed wait is not evidence of closure. Keep trying this owned child.
        outcome["forceKill"] = True
        try:
            child.kill()
        except BaseException as error:
            failed("kill", error)
        try:
            outcome["exit"] = child.wait(timeout=10)
            outcome["reaped"] = True
        except BaseException as error:
            failed("wait-after-kill", error)
    outcome["acceptedNormal"] = accepted_database_close(outcome)
    return outcome

def accepted_database_close(outcome):
    """Normal closure requires this owner's terminate and its received exit."""
    return (isinstance(outcome, dict) and outcome.get("owned") is True
            and outcome.get("runningBefore") is True
            and outcome.get("terminateRequested") is True
            and outcome.get("forceKill") is False and outcome.get("reaped") is True
            and type(outcome.get("exit")) is int
            and outcome["exit"] in (0, -signal.SIGTERM) and outcome.get("errors") == [])

def completed_fixture(result):
    """Admit only a complete original programme and actual normal owned closure."""
    if not (isinstance(result, dict) and result.get("completed") is True
            and result.get("sourceUnchanged") is True and result.get("programmeExit") == 0
            and not result.get("error") and not result.get("interrupted")
            and not result.get("resultPersistenceErrors") and result.get("closedAt")):
        return False
    cleanup = result.get("cleanup", {})
    database, programme = cleanup.get("database"), cleanup.get("programme")
    if not (accepted_database_close(database) and database.get("acceptedNormal") is True
            and result.get("databaseExit") == database["exit"]
            and isinstance(programme, dict) and programme.get("errors") == []):
        return False
    if programme.get("owned") is True:
        return (programme.get("reaped") is True and type(programme.get("exit")) is int
                and programme["exit"] == result["programmeExit"] == 0)
    reused = result.get("reusedProgramme")
    return (programme.get("owned") is False and programme.get("exit") is None
            and isinstance(reused, dict) and bool(reused.get("operationId"))
            and isinstance(reused.get("resultIdentity"), dict))

def main():
    global ROOT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, type=pathlib.Path)
    parser.add_argument("--clickhouse", required=True, type=pathlib.Path,
                        help="Existing original 26.8.24.9 executable; no download is performed")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--source-observer", type=pathlib.Path,
                        help="Existing exact observer request for this original interrupted programme")
    parser.add_argument("command", nargs=argparse.REMAINDER,
                        help="After --, the original node receiving/receive.mjs command")
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    check(command, "Supply the original complete receiving command after --")
    observer = admit_observer(args, command) if args.source_observer is not None else None
    if observer is not None:
        ROOT = observer["baseline"] / "reference"
    root, worker = private_root(args.directory), load_worker()
    seed = (ROOT / "seed.sql").read_bytes()
    check(hashlib.sha256(seed).hexdigest() == SEED_SHA256, "The original seed bytes changed")
    binary = args.clickhouse.expanduser().resolve(strict=True)
    check(binary.is_file() and os.access(binary, os.X_OK) and binary.stat().st_size == BINARY_BYTES,
          "Select the existing original 799107680-byte ClickHouse executable")
    # One filesystem lease covers this owned database and its receiving child.
    with (root / "lifetime.lock").open("a+") as lifetime:
        os.chmod(root / "lifetime.lock", 0o600)
        fcntl.flock(lifetime, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest_path, private_path = root / "fixture.json", root / "credentials.json"
        fingerprint = digest(binary)
        version = subprocess.run([str(binary), "--version"], capture_output=True, text=True, check=True, timeout=30)
        check(re.search(r"(?<![0-9.])26\.8\.24\.9(?![0-9.])", version.stdout), "Selected executable reports another version")
        normalized = [part for part in command if part != "--resume"]
        selected = {"schema": "altinity.reference-fixture.v1", "binary": {"path": str(binary), **fingerprint},
                    "seed": {"bytes": len(seed), "sha256": SEED_SHA256},
                    "input": digest(ROOT / "fixture-input.json"), "command": normalized,
                    "sourceCommit": "ce4fd5b79c7d098305a00567cf2c3cb983d4065d"}
        if manifest_path.exists():
            check(args.resume, "Continue this original fixture with --resume")
            check(worker.read(manifest_path) == selected, "Original fixture source, engine or receiving command changed")
            check(private_path.is_file(), "Original private credentials are unavailable")
            private = worker.read(private_path)
        else:
            check(not args.resume, "Select an existing fixture directory when resuming")
            check({p.name for p in root.iterdir()} <= {"lifetime.lock", "credentials.json"},
                  "A new fixture needs an empty private directory")
            # A crash between the private credential write and manifest write has
            # no database/receiving effect. Reuse that original private selection.
            private = worker.read(private_path) if private_path.exists() else {
                "port": unused_port(), "admin": secrets.token_hex(32),
                "source": secrets.token_hex(32), "target": secrets.token_hex(32)}
            worker.save(private_path, private, True)
            worker.save(manifest_path, selected, True)
        check(set(private) == {"port", "admin", "source", "target"}
              and isinstance(private["port"], int) and 1024 <= private["port"] <= 65535
              and all(re.fullmatch(r"[0-9a-f]{64}", private[key]) for key in ["admin", "source", "target"]),
              "The original private reference selection is invalid")
        observer_state = current_observer_operation(observer) if observer is not None else None
        if observer is not None and observer_state["status"] == "complete" and (root / "fixture-result.json").exists():
            stored, _, _ = checked_json(root / "fixture-result.json", private=True)
            if (stored.get("schema") == "altinity.reference-result.v1" and completed_fixture(stored)
                    and stored.get("fixture") == str(root) and same_identity(stored.get("binary", {}), fingerprint)
                    and stored.get("native", {}).get("version") == VERSION
                    and stored.get("native", {}).get("sourceRows") == 3):
                check(worker.read(root / "reference-observation.json") == stored["native"],
                      "The completed fixture's original native observation changed")
                print(json.dumps({"fixture": str(root), "completed": True, "programmeExit": 0,
                                  "databaseExit": stored.get("databaseExit"), "retained": True}))
                return 0
        actual = retain_observer_attempt(observer, root, worker, observer_state) if observer is not None else list(command)
        if args.resume and "--resume" not in actual:
            actual.append("--resume")
        config = server_xml(root, private).encode()
        worker.atomic(root / "server.xml", config, True)
        reference = Reference(root, private, worker)
        database = programme = None
        result = {"schema": "altinity.reference-result.v1", "startedAt": worker.now(),
                  "fixture": str(root), "binary": fingerprint, "completed": False}
        if observer is not None:
            result["sourceObserver"] = {"id": observer["descriptor"]["id"],
                "request": {"path": str(observer["descriptor_path"]), **observer["descriptor_identity"]},
                "attempt": str(observer["attempt"]), "fixtureSource": observer["self_identity"],
                "baselineManifest": observer["baseline_identity"], "observerManifest": observer["observer_identity"]}
        original_handlers = {}
        for signum in [signal.SIGINT, signal.SIGTERM]:
            original_handlers[signum] = signal.getsignal(signum)
            signal.signal(signum, lambda _signum, _frame: (_ for _ in ()).throw(KeyboardInterrupt()))
        primary_error = None
        return_code = 1
        persistence_errors = []
        try:
            with (root / "native.log").open("ab", buffering=0) as log:
                os.chmod(root / "native.log", 0o600)
                # Never adopt a listener left by an earlier live owner or another job.
                with socket.socket() as check_port:
                    check_port.bind(("127.0.0.1", private["port"]))
                database = subprocess.Popen(
                    [str(binary), "server", "--config-file", str(root / "server.xml")],
                    env={**os.environ, "CLICKHOUSE_WATCHDOG_ENABLE": "0"},
                    stdin=subprocess.DEVNULL, stdout=log, stderr=log, pass_fds=(lifetime.fileno(),))
                reference.ready(database)
                result["native"] = reference.prepare(seed)
                observation_path = root / "reference-observation.json"
                if observation_path.exists():
                    check(worker.read(observation_path) == result["native"],
                          "The original retained native source identity changed")
                worker.save(observation_path, result["native"], True)
                if observer is not None and observer_state["status"] == "complete":
                    # The original receiving programme already finished. Only its
                    # interrupted fixture closeout remains; never repeat native jobs.
                    current_observer_operation(observer)
                    result["reusedProgramme"] = {"operationId": observer_state["id"],
                        "resultIdentity": observer_state["resultIdentity"]}
                    result["programmeExit"] = 0
                else:
                    programme = subprocess.Popen(actual, env=reference.environment(), cwd=str(ROOT.parent), pass_fds=(lifetime.fileno(),))
                    result["programmeExit"] = programme.wait()
                check(reference.rows() == EXPECTED, "The receiving programme changed its original source")
                result["sourceUnchanged"] = True
                return_code = result["programmeExit"]
        except KeyboardInterrupt:
            result["interrupted"] = True
            return_code = 130
        except Exception as error:
            primary_error = error
            result["error"] = {"type": type(error).__name__, "message": str(error)[:2000]}
        finally:
            # Repeated signals during closeout are retained; they cannot abandon
            # the other owned child or skip publication of the actual outcome.
            def cleanup_signal(signum, _frame):
                result.setdefault("cleanupSignals", []).append(signum)
                result["interrupted"] = True
                result["completed"] = False
            for signum in original_handlers:
                signal.signal(signum, cleanup_signal)
            try:
                cleanup = {}
                for label, child in (("programme", programme), ("database", database)):
                    try:
                        cleanup[label] = close_owned(child)
                    except BaseException as error:
                        # Preserve an unexpected cleanup implementation failure and
                        # still attempt the independently owned next child.
                        cleanup[label] = {"owned": child is not None, "runningBefore": None,
                            "terminateRequested": False, "forceKill": False, "reaped": False,
                            "exit": None, "acceptedNormal": False,
                            "errors": [{"step": "close-owned", "type": type(error).__name__,
                                        "message": str(error)[:2000]}]}
                result["cleanup"] = cleanup
                if programme is not None:
                    result["programmeExit"] = cleanup["programme"]["exit"]
                else:
                    result.setdefault("programmeExit", None)
                result["databaseExit"] = cleanup["database"]["exit"]
                result["closedAt"] = worker.now()
                result["completed"] = True
                result["completed"] = completed_fixture(result)
                # Keep the complete attempt before its fixture pointer. Each save
                # is attempted independently even after another save fails.
                targets = []
                if observer is not None:
                    targets.append(("observer-attempt", observer["attempt"] / "result.json", True))
                targets.append(("fixture-result", root / "fixture-result.json", False))
                for label, path, immutable in targets:
                    try:
                        value = ({"schema": "altinity.source-observer-fixture-result.v1",
                                  "request": observer["attempt_request"], "result": result}
                                 if label == "observer-attempt" else result)
                        worker.save(path, value, immutable)
                    except BaseException as error:
                        persistence_errors.append({"step": label, "type": type(error).__name__,
                                                   "message": str(error)[:2000]})
                        result["resultPersistenceErrors"] = list(persistence_errors)
                        result["completed"] = False
                print(json.dumps({"fixture": str(root), "completed": result["completed"],
                                  "programmeExit": result["programmeExit"], "databaseExit": result["databaseExit"],
                                  "cleanup": cleanup, "interrupted": result.get("interrupted", False),
                                  "resultPersistenceErrors": persistence_errors}))
            finally:
                for signum, handler in original_handlers.items():
                    signal.signal(signum, handler)
        if primary_error is not None:
            raise primary_error
        if persistence_errors:
            raise RuntimeError("Original fixture outcome publication failed; retain its attempt and fixture directory")
        if result.get("interrupted"):
            return 130
        return return_code if return_code != 0 else (0 if completed_fixture(result) else 1)

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)[:2000]}), file=sys.stderr)
        sys.exit(1)
