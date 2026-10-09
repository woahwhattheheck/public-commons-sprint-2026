"""Focused QOracle CLI input boundary and allocation checks; stdlib-only."""
from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from qoracle.cli import _read, main
from qoracle.engine import OracleError


class ReadLimitTests(unittest.TestCase):
    def test_exact_limit_accepted_and_one_byte_excess_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            name = Path(folder) / "input.json"
            name.write_bytes(b"x" * 1_000_000)
            self.assertEqual(len(_read(name)), 1_000_000)
            with name.open("ab") as writer:
                writer.write(b"x")
            with self.assertRaisesRegex(OracleError, "input exceeds 1 MiB"):
                _read(name)

    def test_bounded_read_and_no_read_bytes_call(self):
        with tempfile.TemporaryDirectory() as folder:
            name = Path(folder) / "manifest.json"
            name.write_bytes(b'{"schema":1,"qubits":1,"gates":[]}')
            calls = []

            class Spy(io.BytesIO):
                def read(self, n=-1):
                    calls.append(n)
                    return super().read(n)

            with mock.patch.object(Path, "open", return_value=Spy(name.read_bytes())):
                with mock.patch.object(Path, "read_bytes", side_effect=AssertionError("unbounded read")):
                    self.assertIn('"qubits":1', _read(name))
            self.assertEqual(calls, [1_000_001])

    def test_sparse_large_file_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            name = Path(folder) / "large.json"
            with name.open("wb") as writer:
                writer.truncate(32 * 1024 * 1024)
            with self.assertRaises(OracleError):
                _read(name)

    def test_links_nonregular_and_invalid_utf8(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            normal = directory / "source.json"
            normal.write_text("{}", encoding="utf-8")
            link = directory / "alias.json"
            try:
                link.symlink_to(normal)
            except (NotImplementedError, OSError):
                pass  # Some hosts disallow creation of test symlinks.
            else:
                with self.assertRaises(OracleError):
                    _read(link)
            with self.assertRaises(OracleError):
                _read(directory)
            with self.assertRaises(OracleError):
                _read(directory / "missing.json")
            normal.write_bytes(b"\xff")
            with self.assertRaises(UnicodeError):
                _read(normal)

    def test_unmodified_valid_manifest_cli_simulation(self):
        with tempfile.TemporaryDirectory() as folder:
            manifest = Path(folder) / "bell.json"
            manifest.write_text(json.dumps({"schema":1,"qubits":2,
                "gates":[{"op":"H","wire":0},{"op":"CNOT","control":0,"target":1}],
                "observables":["ZZ"]}), encoding="utf-8")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertEqual(main(["simulate", str(manifest)]), 0)
            report = json.loads(output.getvalue())
            self.assertAlmostEqual(report["expectations"]["ZZ"], 1.0)


if __name__ == "__main__":
    unittest.main()
