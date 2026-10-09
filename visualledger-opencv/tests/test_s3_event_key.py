"""S3 notification key encoding at the production Lambda ingress boundary.

One focused case file; these tests never provision AWS or run image analysis.
"""
from __future__ import annotations

import unittest
from unittest.mock import patch

from visualledger.aws_adapter import (
    event_identity,
    handle_s3_event,
    normalize_s3_event,
)
from visualledger.vision import VisionError


def s3_event(key: str) -> dict:
    return {
        "Records": [{
            "s3": {
                "bucket": {"name": "visualledger-fixtures"},
                "object": {"key": key, "versionId": "version-7", "eTag": "etag-7"},
            },
        }],
    }


class S3NotificationKeyTests(unittest.TestCase):
    def test_form_encoded_separator_and_stable_event_identity(self):
        raw = normalize_s3_event(s3_event("tenant-7/evidence.png"))
        encoded = normalize_s3_event(s3_event("tenant-7%2Fevidence.png"))
        encoded_scope = normalize_s3_event(s3_event("%74enant-7%2fevidence.png"))
        self.assertEqual(encoded, raw)
        self.assertEqual(encoded_scope, raw)
        self.assertEqual(event_identity(encoded), event_identity(raw))

    def test_loader_receives_original_unescaped_key_and_scope(self):
        calls = []
        def load(bucket, key, version):
            calls.append(("load", bucket, key, version))
            return b"synthetic-bytes"
        def priors(scope):
            calls.append(("priors", scope))
            return []
        def write(scope, event_id, record):
            calls.append(("write", scope, record["source"]["key"]))
        # Only the event-to-GetObject boundary is under test; mocked perception
        # is not represented as an OpenCV execution or deployed AWS proof.
        with patch("visualledger.aws_adapter.compile_trace", return_value={"test_only": True}):
            out = handle_s3_event(
                s3_event("tenant-7%2Fevidence.png"),
                load_object=load,
                read_record=lambda *_: None,
                write_record=write,
                load_prior_fingerprints=priors,
                record_auth_key=b"S" * 32,
            )
        self.assertEqual(out["status"], "RECORDED")
        self.assertIn(("load", "visualledger-fixtures", "tenant-7/evidence.png", "version-7"), calls)
        self.assertIn(("priors", "tenant-7"), calls)
        self.assertIn(("write", "tenant-7", "tenant-7/evidence.png"), calls)

    def test_invalid_encoded_keys_still_fail_closed(self):
        for key in (
            "tenant%2G/file.png", "tenant%/file.png",
            "tenant%FF/file.png", "tenant%C3%28/file.png",
            "tenant%2F..%2Fescape.png", "%2Fabsolute.png",
            "tenant%2Fspace+key.png", "tenant%2Fback%5Cslash.png",
            "tenant%2500/file.png",
        ):
            with self.subTest(key=key), self.assertRaises(VisionError):
                normalize_s3_event(s3_event(key))

    def test_decoded_key_still_obeys_length_bound(self):
        with self.assertRaises(VisionError):
            normalize_s3_event(s3_event("tenant%2F" + ("a" * 1024)))


if __name__ == "__main__":
    unittest.main()
