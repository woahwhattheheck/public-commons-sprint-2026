from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts import check_external_surface_isolation as guard


class ExternalSurfaceIsolationTests(unittest.TestCase):
    def test_missing_root_and_obfuscated_marker_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            with self.assertRaises(guard.ScanError):
                guard.scan_root(root / "missing")
            (root / "index.html").write_text(
                "https://github.com/woahwhattheheck%26%23x2f%3Bcomm%26%23x200b%3Bons\n",
                encoding="utf-8",
            )
            _, findings = guard.scan_root(root)
            self.assertEqual(len(findings), 1)
            self.assertEqual(findings[0][2], "commons-repository")

    def test_unscannable_public_text_is_blocking(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "README.md").write_bytes(b"\xff\xfe")
            _, findings = guard.scan_root(root)
            self.assertTrue(findings)
            self.assertTrue(findings[0][2].startswith("unscannable-public-text:"))

    def test_extensionless_public_text_is_scanned(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "Dockerfile").write_text("FROM python:3.13\n", encoding="utf-8")
            checked, findings = guard.scan_root(root)
            self.assertEqual((checked, findings), (1, []))


if __name__ == "__main__":
    unittest.main(verbosity=2)
