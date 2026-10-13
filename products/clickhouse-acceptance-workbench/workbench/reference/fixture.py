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

def stop_owned(child):
    if child is None or child.poll() is not None:
        return None if child is None else child.returncode
    child.terminate()
    try:
        return child.wait(timeout=30)
    except subprocess.TimeoutExpired:
        child.kill()
        return child.wait(timeout=10)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, type=pathlib.Path)
    parser.add_argument("--clickhouse", required=True, type=pathlib.Path,
                        help="Existing original 26.8.24.9 executable; no download is performed")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("command", nargs=argparse.REMAINDER,
                        help="After --, the original node receiving/receive.mjs command")
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    check(command, "Supply the original complete receiving command after --")
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
        config = server_xml(root, private).encode()
        worker.atomic(root / "server.xml", config, True)
        reference = Reference(root, private, worker)
        database = programme = None
        result = {"schema": "altinity.reference-result.v1", "startedAt": worker.now(),
                  "fixture": str(root), "binary": fingerprint, "completed": False}
        for signum in [signal.SIGINT, signal.SIGTERM]:
            signal.signal(signum, lambda _signum, _frame: (_ for _ in ()).throw(KeyboardInterrupt()))
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
                actual = list(command)
                if args.resume and "--resume" not in actual:
                    actual.append("--resume")
                programme = subprocess.Popen(actual, env=reference.environment(), cwd=str(ROOT.parent), pass_fds=(lifetime.fileno(),))
                result["programmeExit"] = programme.wait()
                check(reference.rows() == EXPECTED, "The receiving programme changed its original source")
                result["completed"] = result["programmeExit"] == 0
                return result["programmeExit"]
        except KeyboardInterrupt:
            result["interrupted"] = True
            return 130
        except Exception as error:
            result["error"] = {"type": type(error).__name__, "message": str(error)[:2000]}
            raise
        finally:
            result["programmeExit"] = stop_owned(programme) if programme is not None and programme.poll() is None else (
                programme.returncode if programme is not None else None)
            result["databaseExit"] = stop_owned(database)
            result["closedAt"] = worker.now()
            worker.save(root / "fixture-result.json", result)
            print(json.dumps({"fixture": str(root), "completed": result["completed"],
                              "programmeExit": result["programmeExit"], "databaseExit": result["databaseExit"]}))

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)[:2000]}), file=sys.stderr)
        sys.exit(1)
