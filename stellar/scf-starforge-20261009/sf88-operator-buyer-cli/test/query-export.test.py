"""One complete native customer export journey and its failure/recovery seams.

PYTHONPATH=.../sf88-operator-buyer-cli/python python query-export.test.py
Set SF_QUERY_EXPORT_ROWS=1000000 for the full-scale local workload.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import resource
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest

from stellar_forge_buyer.datasets import DatasetDelivery
from stellar_forge_buyer.errors import StateError
from stellar_forge_buyer.query_export import QueryExport, prepare_query
from stellar_forge_buyer.sqlite_dataset import DatasetDatabase


def encoded(value):
    return (json.dumps(value, separators=(",", ":"), ensure_ascii=False) + "\n").encode()


def save(path, raw):
    path.write_bytes(raw)
    path.chmod(0o600)
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def native_delivery(directory, count, *, edition="A"):
    """A deterministic workload in the actual retained native delivery format."""
    directory.mkdir(mode=0o700)
    path = directory / "dataset.jsonl"
    checksum = hashlib.sha256()
    size = 0
    with path.open("wb") as stream:
        for number in range(count):
            raw = encoded({"id": number, "price": "00001000.2000000", "large": 9007199254740993 + number,
                           "nullable": None if number % 2 == 0 else "", "edition": edition})
            stream.write(raw)
            checksum.update(raw)
            size += len(raw)
    path.chmod(0o600)
    rows = {"bytes": size, "sha256": checksum.hexdigest()}
    dataset = {"projectedFields": ["id", "price", "large", "nullable", "edition"], "rows": count, "snapshot": edition}
    manifest = {"schema": "stellar-forge.buyer-delivery-manifest.v1", "dataset": dataset,
                "sourcePages": [{"index": 1, "rows": count}], "paymentStatus": "LOCAL_WORKLOAD",
                "outputs": {"dataset.jsonl": rows}}
    manifest_meta = save(directory / "manifest.json", encoded(manifest))
    return DatasetDelivery(native={"schema": "stellar-forge.sf88.dataset-delivery.v1",
        "sourceBindingSha256": hashlib.sha256(encoded(dataset)).hexdigest(),
        "nativeStatus": {"complete": True, "finalized": True, "rows": count, "pages": 1, "snapshot": edition},
        "paymentStatus": "LOCAL_WORKLOAD", "sourceDirectory": str(directory),
        "outputs": {"dataset.jsonl": {**rows, "path": str(path)},
                    "manifest.json": {**manifest_meta, "path": str(directory / "manifest.json")}}}, directory=directory)


def populated(root, count=12):
    database = DatasetDatabase(root / "analysis")
    version = database.import_delivery(native_delivery(root / "source", count))
    database.activate("working", version["version_id"], expected_revision=0)
    return database, version


def command(*arguments):
    return subprocess.run([sys.executable, "-m", "stellar_forge_buyer.query_export", *map(str, arguments)],
                          text=True, capture_output=True, check=True)


class ExportJourney(unittest.TestCase):
    def test_native_delivery_complete_export_and_portable_cli(self):
        count = int(os.environ.get("SF_QUERY_EXPORT_ROWS", "2500"))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database, version = populated(root, count)
            sql = "SELECT id,price,large,nullable,edition,X'00FF' AS payload,'=1+1' AS formula FROM working ORDER BY id"
            sql_path = root / "query.sql"
            save(sql_path, sql.encode())
            planned = json.loads(command("prepare", "--database", database.directory,
                                         "--sql-file", sql_path, "--out", root / "review.json").stdout)
            self.assertEqual(planned["expectedViews"][0]["version_id"], version["version_id"])
            self.assertEqual(len(planned["preview"]["rows"]), min(20, count))
            before = time.monotonic()
            result = json.loads(command("run", "--request", root / "review.json", "--out", root / "export").stdout)
            elapsed = time.monotonic() - before
            self.assertEqual(result["rowCount"], count)
            self.assertTrue(result["queryComplete"])
            self.assertEqual(result["binding"]["sourceVersions"][0]["version_id"], version["version_id"])
            self.assertEqual(result["binding"]["sourceVersions"][0]["originalPaymentStatus"], "LOCAL_WORKLOAD")
            bundle = QueryExport(root / "export")
            self.assertEqual(bundle.inspect(), result)
            total = 0
            for number, row in enumerate(bundle.rows()):
                self.assertEqual(row, {"id": number, "price": "00001000.2000000", "large": 9007199254740993 + number,
                    "nullable": None if number % 2 == 0 else "", "edition": "A", "payload": b"\x00\xff", "formula": "=1+1"})
                total += row["id"]
            self.assertEqual(total, count * (count - 1) // 2)
            with sqlite3.connect((root / "export/rows.sqlite3").as_uri() + "?mode=ro", uri=True) as output:
                self.assertEqual(output.execute("SELECT count(*),max(large) FROM result").fetchone(), (count, 9007199254740993 + count - 1))
                self.assertEqual(output.execute("SELECT typeof(price),typeof(large),typeof(payload) FROM result LIMIT 1").fetchone(), ("text", "integer", "blob"))
            with bundle.open("rows.csv") as source:
                source.readline()
                self.assertIn(b"'=1+1", source.readline())
            copied = json.loads(command("copy", "--directory", root / "export", "--out", root / "recipient").stdout)
            self.assertEqual(copied, result)
            database.directory.rename(root / "retired-source")
            reopened = json.loads(command("inspect", "--directory", root / "recipient").stdout)
            self.assertEqual(reopened, result)
            self.assertEqual((root / "recipient/manifest.json").read_bytes(), (root / "export/manifest.json").read_bytes())
            print(json.dumps({"workloadRows": count, "exportSeconds": round(elapsed, 3),
                  "childPeakRssKiB": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
                  "exportBytes": sum(item["bytes"] for item in result["outputs"].values()),
                  "sourceVersions": len(result["binding"]["sourceVersions"]), "reopenedAfterSourceMoved": True}), flush=True)

    def test_shared_preview_reader_and_context_lifecycle(self):
        with tempfile.TemporaryDirectory() as directory:
            database, _ = populated(Path(directory))
            result = database.query("SELECT * FROM working ORDER BY id", max_rows=3)
            self.assertTrue(result.truncated)
            self.assertEqual(len(result.rows), 3)
            self.assertIn("working", result.read_tables)
            with database.stream_query("SELECT id FROM working ORDER BY id") as rows:
                self.assertEqual(next(rows), (0,))
            self.assertFalse(rows.complete)
            with self.assertRaisesRegex(StateError, "STREAM_CLOSED"):
                next(rows)
            for sql in ("DELETE FROM working", "ATTACH DATABASE ':memory:' AS extra", "PRAGMA user_version=99",
                        "SELECT load_extension('missing')", "CREATE TABLE forbidden(x)"):
                with self.assertRaises(StateError), database.stream_query(sql):
                    pass
            with database._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                database._query(connection, "SELECT 1")
                connection.execute("CREATE TABLE after_query(x)")
                connection.rollback()
            with database.stream_query("SELECT 1") as rows:
                self.assertEqual(list(rows), [(1,)])
                self.assertTrue(rows.complete)

    def test_snapshot_survives_concurrent_activation_and_stale_review_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database, original = populated(root)
            other = database.import_delivery(native_delivery(root / "other", 4, edition="B"))
            with database._connection() as connection:
                connection.execute("PRAGMA journal_mode=WAL")
            expected = database.view_bindings()
            failures = []
            def activate():
                try:
                    DatasetDatabase(database.directory, create=False).activate("working", other["version_id"], expected_revision=1)
                except Exception as exc:
                    failures.append(exc)
            with database.stream_query("SELECT edition FROM working", expected_views=expected) as rows:
                self.assertEqual(next(rows), ("A",))
                writer = threading.Thread(target=activate)
                writer.start()
                writer.join(5)
                self.assertFalse(writer.is_alive())
                self.assertEqual(failures, [])
                self.assertEqual(set(rows), {("A",)})
                self.assertEqual(rows.source_versions()[0]["version_id"], original["version_id"])
            self.assertEqual(database.current("working")["revision"], 2)
            with self.assertRaisesRegex(StateError, "VIEWS_CHANGED"):
                database.export_query("SELECT * FROM working", expected_views=expected, destination=root / "stale")
            self.assertFalse((root / "stale").exists())

    def test_cancel_limits_timeout_cleanup_and_metadata_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database, _ = populated(root)
            for options, code in (({"max_rows": 3}, "ROW_LIMIT"), ({"max_output_bytes": 20}, "OUTPUT_LIMIT"),
                                  ({"timeout": 0.000001}, "TIMEOUT"), ({"cancel": lambda: True}, "CANCELLED")):
                with self.assertRaisesRegex(StateError, code):
                    database.export_query("SELECT * FROM working", destination=root / "failed", **options)
                self.assertFalse((root / "failed").exists())
            cancelled = threading.Event()
            with self.assertRaisesRegex(StateError, "CANCELLED"):
                database.export_query("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10000) SELECT x FROM n",
                    destination=root / "cancel", cancel=cancelled.is_set, progress=lambda _: cancelled.set())
            self.assertFalse((root / "cancel").exists())
            for sql in ("SELECT id AS x,id AS x FROM working", "SELECT 1 AS _sf_export_row", "DELETE FROM working"):
                with self.assertRaises(StateError):
                    database.export_query(sql, destination=root / "invalid")
                self.assertFalse((root / "invalid").exists())
            with self.assertRaisesRegex(StateError, "TIMEOUT"), database.stream_query(
                    "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n) SELECT sum(x) FROM n", timeout=0.01):
                pass

    def test_empty_typed_bindings_independent_reopen_and_tamper(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database, _ = populated(root)
            empty = database.export_query("SELECT id FROM working WHERE 0", destination=root / "empty")
            self.assertEqual(empty.manifest["rowCount"], 0)
            self.assertEqual(list(empty.rows()), [])
            special = database.export_query("SELECT :blob AS binary,:n AS large,:text AS text,1e999 AS infinity", 
                {"blob": b"\x00\xff", "n": 9223372036854775807, "text": "雪\n0.0000000000000000001"}, destination=root / "special")
            row = next(special.rows())
            self.assertEqual(row["binary"], b"\x00\xff")
            self.assertEqual(row["large"], 9223372036854775807)
            self.assertTrue(math.isinf(row["infinity"]))
            self.assertEqual(row["text"], "雪\n0.0000000000000000001")
            with self.assertRaisesRegex(StateError, "DESTINATION_EXISTS"):
                special.copy_to(root / "special")
            path = root / "special/rows.jsonl"
            raw = path.read_bytes()
            path.write_bytes(raw.replace(b'9223372036854775807', b'9223372036854775806'))
            with self.assertRaisesRegex(StateError, "FILE_CHANGED"):
                next(QueryExport(root / "special").rows())
            (root / "incomplete").mkdir(mode=0o700)
            with self.assertRaisesRegex(StateError, "INCOMPLETE"):
                QueryExport(root / "incomplete")


if __name__ == "__main__":
    unittest.main(verbosity=2)
