#!/usr/bin/env python3
"""Focused original-source intake, view repair and scoped verification course."""
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model.common import (atomic_json, file_digest, retain_file,
                          _retained_object_matches)
from model.verified_files import verified_files
from model.workspace import Workspace


class SourceMaterialization(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.original = self.root / "original"
        self.original.mkdir()
        self.body = self.original / "native.bin"
        self.body.write_bytes(bytes(range(256)) * 8192)
        self.sha = file_digest(self.body)
        self.note = self.original / "metadata.txt"
        self.note.write_text("Original authored byte-preservation fixture.\n", encoding="utf-8")
        self.manifest = self.original / "sources.json"
        atomic_json(self.manifest, {
            "schema": "upstate.sources/v1", "title": "Authored transfer fixture",
            "captured_at": "2026-10-13T00:00:00Z",
            "entries": [
                {"id": key, "kind": "document", "title": key,
                 "uri": "urn:authored:source-materialization:" + key, "vintage": "2026-10-13",
                 "path": "native.bin", "bytes": self.body.stat().st_size, "sha256": self.sha,
                 "companions": [{"path": "metadata.txt", "sha256": file_digest(self.note),
                                 "bytes": self.note.stat().st_size}]}
                for key in ("first", "second", "third")]})
        self.workspace = Workspace(self.root / "workspace", create=True)

    def tearDown(self):
        self.temporary.cleanup()

    def test_whole_import_repeated_views_and_cold_scope(self):
        with verified_files() as operation:
            collection = self.workspace.import_sources(self.manifest)
            for _ in range(3):
                for entry in collection["entries"]:
                    path, actual = self.workspace.source_file(collection["id"], entry["id"])
                    self.assertEqual(actual, entry)
                    self.assertEqual(file_digest(path), self.sha)
                if _ == 1:
                    previous = operation.observation()
            final = operation.observation()
            self.assertEqual(final["source_hashed_bytes"], previous["source_hashed_bytes"])
            self.assertGreater(final["source_reused_verifications"], previous["source_reused_verifications"])
            self.assertGreater(final["source_copied_bytes"], 0)
        self.assertFalse(operation.entries)
        with verified_files() as cold:
            reopened = Workspace(self.workspace.root)
            path, _ = reopened.source_file(collection["id"], "first")
            self.assertEqual(file_digest(path), self.sha)
            self.assertGreater(cold.source_hashed_bytes, 0)
        self.assertEqual(collection["original_manifest"]["sha256"], file_digest(self.manifest))
        self.assertEqual(file_digest(self.body), self.sha)

    def test_changed_same_length_same_mtime_is_not_reused(self):
        retained = retain_file(self.workspace.root, self.body, self.sha)
        target = self.workspace.root / retained["object"]
        with verified_files() as operation:
            self.assertTrue(_retained_object_matches(target, self.sha, retained["bytes"]))
            before = target.stat()
            with target.open("r+b") as stream:
                stream.write(b"x")
                stream.flush()
                os.fsync(stream.fileno())
            os.utime(target, ns=(before.st_atime_ns, before.st_mtime_ns))
            self.assertNotEqual(target.stat().st_ctime_ns, before.st_ctime_ns)
            self.assertFalse(_retained_object_matches(target, self.sha, retained["bytes"]))
            self.assertGreaterEqual(operation.source_hash_reads, 2)

    def test_hardlink_metadata_change_and_atomic_replacement_require_hash(self):
        retained = retain_file(self.workspace.root, self.body, self.sha)
        target = self.workspace.root / retained["object"]
        with verified_files() as operation:
            self.assertTrue(_retained_object_matches(target, self.sha, retained["bytes"]))
            reads = operation.source_hash_reads
            alias = self.root / "alias.bin"
            os.link(target, alias)
            self.assertTrue(_retained_object_matches(alias, self.sha, retained["bytes"]))
            self.assertEqual(operation.source_hash_reads, reads + 1)
            self.assertTrue(_retained_object_matches(target, self.sha, retained["bytes"]))
            self.assertEqual(operation.source_hash_reads, reads + 1)
            replacement = self.root / "replacement.bin"
            replacement.write_bytes(self.body.read_bytes())
            os.replace(replacement, target)
            self.assertTrue(_retained_object_matches(target, self.sha, retained["bytes"]))
            self.assertEqual(operation.source_hash_reads, reads + 2)

    def test_damaged_native_alias_reimports_and_repairs_without_changing_original(self):
        with verified_files():
            collection = self.workspace.import_sources(self.manifest)
            view, entry = self.workspace.source_file(collection["id"], "first")
            original_object = self.workspace.root / entry["body"]["object"]
            self.assertEqual(view.stat().st_ino, original_object.stat().st_ino)
            with view.open("r+b") as stream:
                stream.write(b"broken")
            self.assertNotEqual(file_digest(original_object), self.sha)
            received = self.workspace.import_sources(self.manifest)
            self.assertEqual(received, collection)
            self.assertEqual(file_digest(original_object), self.sha)
            repaired, _ = self.workspace.source_file(collection["id"], "first")
            self.assertEqual(file_digest(repaired), self.sha)
            self.assertEqual(file_digest(self.body), self.sha)
            self.assertEqual(file_digest(self.manifest), collection["original_manifest"]["sha256"])

    def test_wrong_expected_hash_and_symlink_are_not_admitted(self):
        with verified_files():
            with self.assertRaises(ValueError):
                retain_file(self.workspace.root, self.body, "0" * 64)
            self.assertFalse((self.workspace.root / "objects" / ("0" * 64)).exists())
            alias = self.root / "link"
            alias.symlink_to(self.body)
            with self.assertRaises((OSError, ValueError)):
                _retained_object_matches(alias, self.sha, self.body.stat().st_size)

    def test_nested_scope_reuses_and_other_thread_starts_independent(self):
        import threading
        retained = retain_file(self.workspace.root, self.body, self.sha)
        target = self.workspace.root / retained["object"]
        with verified_files() as original:
            self.assertTrue(_retained_object_matches(target, self.sha, retained["bytes"]))
            with verified_files() as nested:
                self.assertIs(original, nested)
                self.assertTrue(_retained_object_matches(target, self.sha, retained["bytes"]))
                self.assertEqual(original.source_hash_reads, 1)
            result, failures = [], []
            def check():
                try:
                    with verified_files() as other:
                        self.assertTrue(_retained_object_matches(target, self.sha, retained["bytes"]))
                        result.append(other.observation())
                except BaseException as error:
                    failures.append(error)
            thread = threading.Thread(target=check)
            thread.start()
            thread.join()
            if failures:
                raise failures[0]
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["source_hash_reads"], 1)
            self.assertEqual(original.source_hash_reads, 1)


if __name__ == "__main__":
    unittest.main()
