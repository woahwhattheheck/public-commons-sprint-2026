"""Focused regression: canonical ProofLine inputs reject ambiguous JSON objects."""
import unittest

from proofline.codec import CodecError, canonical_json, digest_json, loads_strict


class StrictJsonDuplicatesTest(unittest.TestCase):
    def test_root_nested_array_and_unicode_alias_duplicates(self):
        duplicate_inputs = (
            b'{"receipt_sha256":"a","receipt_sha256":"b"}',
            b'{"source":{"version_id":"1","version_id":"2"}}',
            b'{"rows":[{"value":1},{"label":3,"label":4}]}',
            b'{"region": {"a": 1, "\\u0061": 2}}',
        )
        for raw in duplicate_inputs:
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(CodecError, "duplicate JSON object field"):
                    loads_strict(raw)

    def test_genuine_canonical_packets_still_roundtrip(self):
        packet = {"schema":"proofline.evidence.v1","nested":{"selected":True,"μ":"foo"},
                  "regions":[{"id":"R001","n":0},{"id":"R002","n":1}],"authority":{"act":False}}
        raw = canonical_json(packet)
        self.assertEqual(loads_strict(raw), packet)
        self.assertEqual(canonical_json(loads_strict(raw)), raw)
        self.assertEqual(digest_json(loads_strict(raw)), digest_json(packet))

    def test_existing_byte_bounds_utf8_and_nonfinite_rejections(self):
        with self.assertRaisesRegex(CodecError, "size limit"):
            loads_strict(b'{"x":1}', max_bytes=2)
        with self.assertRaises(CodecError):
            loads_strict(b'{"x":\xff}')
        with self.assertRaisesRegex(CodecError, "non-finite"):
            loads_strict(b'{"x":NaN}')

    def test_distinct_keys_and_multiple_objects_do_not_collide(self):
        raw = b'{"a":1,"b":{"a":2},"c":[{"a":3},{"a":4}]}'
        self.assertEqual(loads_strict(raw)["b"]["a"], 2)


if __name__ == "__main__":
    unittest.main()
