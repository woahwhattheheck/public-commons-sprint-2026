from __future__ import annotations

import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from urllib.parse import quote

from scripts import check_external_surface_isolation as guard


class ExternalSurfaceIsolationTests(unittest.TestCase):
    def test_missing_root_and_obfuscated_marker_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            with self.assertRaises(guard.ScanError):
                guard.scan_root(root / "missing")
            obfuscated = (
                "https://github.com/woahwhattheheck"
                + "%26%23x2f%3Bcomm%26%23x200b%3Bons"
            )
            (root / "index.html").write_text(obfuscated + "\n", encoding="utf-8")
            _, findings = guard.scan_root(root)
            self.assertEqual(len(findings), 1)
            self.assertEqual(findings[0][2], "commons-repository")

    def test_source_escapes_and_encoded_invisibles_cannot_hide_marker(self) -> None:
        repo = "woahwhattheheck" + "/commons"
        cases = (
            "woahwhattheheck" + r"\u002fcommons",
            "woahwhattheheck" + r"\x2fcommons",
            "woahwhattheheck" + r"\u{63}ommons",
            "woahwhattheheck" + r"\/commons",
            "woahwhattheheck" + "%E2%80%8B/commons",
            "woahwhattheheck" + "&#8203;/commons",
        )
        for case in cases:
            normalized = guard.normalized_for_scan(case)
            self.assertIn(repo, normalized)

    def test_marker_boundaries_avoid_owner_and_repo_prefix_false_positives(self) -> None:
        clean = (
            "https://github.com/notwoahwhattheheck/commons",
            "https://github.com/woahwhattheheck/commons-demo",
        )
        for case in clean:
            candidate = guard.normalized_for_scan(case)
            self.assertFalse(
                any(guard.marker_present(candidate, marker) for _, marker in guard.FORBIDDEN_MARKERS)
            )

        target = "woahwhattheheck" + "/commons.git"
        candidate = guard.normalized_for_scan("git@github.com:" + target)
        self.assertTrue(guard.marker_present(candidate, guard.FORBIDDEN_MARKERS[0][1]))

    def test_normalization_exhaustion_fails_closed(self) -> None:
        value = "woahwhattheheck" + "/commons"
        for _ in range(guard.MAX_NORMALIZATION_PASSES + 2):
            value = quote(value, safe="")
        with self.assertRaisesRegex(guard.ScanError, "normalization pass limit"):
            guard.normalized_for_scan(value)

    def test_scan_reports_normalization_exhaustion_as_blocking_line(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            value = "woahwhattheheck" + "/commons"
            for _ in range(guard.MAX_NORMALIZATION_PASSES + 2):
                value = quote(value, safe="")
            (root / "surface.txt").write_text(value + "\n", encoding="utf-8")
            _, findings = guard.scan_root(root)
            self.assertEqual(len(findings), 1)
            self.assertEqual(findings[0][0:2], ("surface.txt", 1))
            self.assertTrue(findings[0][2].startswith("unscannable-public-line:normalization pass limit"))

    def test_scan_flags_json_unicode_escaped_commons_path(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            escaped = "woahwhattheheck" + r"\u002fcommons"
            (root / "surface.json").write_text('{"url":"' + escaped + '"}\n', encoding="utf-8")
            _, findings = guard.scan_root(root)
            self.assertEqual(len(findings), 1)
            self.assertEqual(findings[0][2], "commons-repository")

    def test_internal_slack_and_svg_xml_surfaces_are_blocking(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            slack = "https://tokenjunkielabs.slack.com" + "/archives/C0EXAMPLE/p123"
            (root / "diagram.svg").write_text(
                '<svg><a href="' + slack + '">internal</a></svg>\n',
                encoding="utf-8",
            )
            (root / "feed.xml").write_text(
                '<link href="' + slack.replace("/archives/", "%2Farchives%2F") + '"/>\n',
                encoding="utf-8",
            )
            checked, findings = guard.scan_root(root)
            self.assertEqual(checked, 2)
            self.assertEqual(
                [finding[2] for finding in findings],
                ["internal-slack-archive", "internal-slack-archive"],
            )

    def test_symlinked_public_directory_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            target = root / "target"
            target.mkdir()
            (target / "README.md").write_text("clean\n", encoding="utf-8")
            link = root / "linked-public"
            try:
                link.symlink_to(target, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("directory symlink unavailable")
            with self.assertRaisesRegex(guard.ScanError, "symlinked public directory"):
                guard.scan_root(root)

    def test_walk_traversal_error_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)

            def broken_walk(_root, *, topdown, onerror, followlinks):
                self.assertTrue(topdown)
                self.assertFalse(followlinks)
                error = OSError("simulated traversal failure")
                error.filename = str(root / "raced-subtree")
                onerror(error)
                return iter(())

            with patch.object(guard.os, "walk", broken_walk):
                with self.assertRaisesRegex(guard.ScanError, "cannot traverse public directory"):
                    guard.scan_root(root)

    def test_unscannable_public_text_is_blocking(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "README.md").write_bytes(b"\xff\xfe")
            _, findings = guard.scan_root(root)
            self.assertTrue(findings)
            self.assertEqual(findings[0][2], "unscannable-public-text")

    def test_extensionless_public_text_is_scanned(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "Dockerfile").write_text("FROM python:3.13\n", encoding="utf-8")
            checked, findings = guard.scan_root(root)
            self.assertEqual((checked, findings), (1, []))


if __name__ == "__main__":
    unittest.main(verbosity=2)
