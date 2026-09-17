from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from repoatlas.core import RepoAtlasError, compile_packet, verify_bundle

ROOT = Path(__file__).parents[1]


def fixture():
    return json.loads((ROOT / "fixtures" / "synthetic-repo.json").read_text())


class ObjectModeMappingBoundTests(unittest.TestCase):
    def test_exact_schema_mappings_still_compile_and_verify(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        self.assertTrue(verify_bundle(copy.deepcopy(raw), packet, receipt))

    def test_root_mapping_rejects_over_cardinality_before_unknown_field_sort(self):
        raw = fixture()
        raw["unknown-1"] = None
        with self.assertRaisesRegex(RepoAtlasError, "root:field_cardinality"):
            compile_packet(raw)

    def test_nested_mapping_field_cardinality_is_bounded(self):
        cases = (
            ("file", lambda raw: raw["files"][0], r"files\[0\]:field_cardinality"),
            (
                "dependency",
                lambda raw: raw["dependencies"][0],
                r"dependencies\[0\]:field_cardinality",
            ),
            ("change", lambda raw: raw["changes"][0], r"changes\[0\]:field_cardinality"),
            ("adr", lambda raw: raw["adrs"][0], r"adrs\[0\]:field_cardinality"),
            (
                "runbook",
                lambda raw: raw["runbooks"][0],
                r"runbooks\[0\]:field_cardinality",
            ),
            ("provider", lambda raw: raw["provider"], r"provider:field_cardinality"),
        )
        for label, selector, error in cases:
            with self.subTest(label=label):
                raw = fixture()
                selector(raw)["__oversized_unknown_field__"] = None
                with self.assertRaisesRegex(RepoAtlasError, error):
                    compile_packet(raw)

    def test_non_string_key_cannot_escape_as_sort_type_error(self):
        raw = fixture()
        # Keep provider field count at the valid maximum so this exercises the
        # key-shape fence rather than the cardinality fence.
        raw["provider"].pop("tracks_published")
        raw["provider"][7] = False
        with self.assertRaisesRegex(RepoAtlasError, "provider:field_name"):
            compile_packet(raw)

    def test_pathological_unknown_key_name_is_bounded(self):
        raw = fixture()
        # Keep root field count at the valid maximum by replacing one optional
        # collection field; a giant field name must fail before `_source._only`
        # constructs/sorts its unknown-key set.
        raw.pop("runbooks")
        raw["x" * 257] = []
        with self.assertRaisesRegex(RepoAtlasError, "root:field_name"):
            compile_packet(raw)

    def test_utf8_invalid_unknown_key_fails_before_error_rendering(self):
        raw = fixture()
        # Keep root field count at the valid maximum so the field-name fence,
        # not the cardinality fence, owns this predecessor.
        raw.pop("runbooks")
        raw["\ud800"] = []
        with self.assertRaisesRegex(RepoAtlasError, "root:field_name"):
            compile_packet(raw)


if __name__ == "__main__":
    unittest.main()
