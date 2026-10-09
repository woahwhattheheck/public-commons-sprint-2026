# SPDX-License-Identifier: MIT
"""Focused synthetic S3 event replay checks; no AWS, OpenCV or customer images."""
import hashlib
import io
import json
import os
import sys
import types
import unittest
from unittest.mock import patch

fake_vision = types.ModuleType("thermoloom")
fake_vision.decode_image = lambda data: data
fake_vision.inspect = lambda data, rows, cols: {
    "capture_sha256": hashlib.sha256(data).hexdigest(), "decision": "MONITOR"
}
sys.modules["thermoloom"] = fake_vision
import aws_handler

E = "a" * 32

def event(*, name="ObjectCreated:Put", version=None, etag=E):
    o = {"key": "images%2Fpanel.png"}
    if version is not None: o["versionId"] = version
    if etag is not None: o["eTag"] = etag
    return {"Records": [{"eventSource": "aws:s3", "eventName": name,
                          "s3": {"bucket": {"name": "safe-input"}, "object": o}}]}

class FakeS3:
    def __init__(self, *, payload=b"synthetic-png", etag=E, version=None, ignore_match=False):
        self.payload, self.etag, self.version = payload, etag, version
        self.ignore_match = ignore_match
        self.get_calls = []
        self.put_calls = []
    def get_object(self, **request):
        self.get_calls.append(request)
        if (not self.ignore_match and request.get("IfMatch") and
                request["IfMatch"].strip('"').lower() != self.etag.lower()):
            raise ValueError("412 Precondition Failed — overwritten object")
        result = {"Body": io.BytesIO(self.payload), "ETag": '"'+self.etag+'"'}
        if self.version is not None: result["VersionId"] = self.version
        return result
    def put_object(self, **request):
        self.put_calls.append(request)
        return {}

class ThermoLoomS3IdentityTest(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"THERMOLOOM_OUTPUT_BUCKET": "safe-review"})
        self.env.start()
    def tearDown(self):
        self.env.stop()
    def test_unversioned_event_read_pinned_by_etag_and_receipt(self):
        s3 = FakeS3()
        result = aws_handler.lambda_handler(event(), None, s3_client=s3)
        self.assertEqual(s3.get_calls[0]["IfMatch"], E)
        self.assertNotIn("VersionId", s3.get_calls[0])
        self.assertEqual(result["count"], 1)
        self.assertEqual(len(s3.put_calls), 1)
        receipt = json.loads(s3.put_calls[0]["Body"])
        self.assertEqual(receipt["analysis"]["capture_sha256"], hashlib.sha256(b"synthetic-png").hexdigest())
    def test_overwritten_current_key_and_provider_ignoring_ifmatch_never_publish(self):
        for ignore_match in (False, True):
            with self.subTest(ignore_match=ignore_match):
                s3 = FakeS3(etag="b" * 32, ignore_match=ignore_match)
                with self.assertRaisesRegex(ValueError, "Precondition|ETag differs"):
                    aws_handler.lambda_handler(event(), None, s3_client=s3)
                self.assertEqual(s3.put_calls, [])
    def test_reject_non_create_and_unbound_events_before_read(self):
        for specimen in (event(name="ObjectRemoved:Delete"), event(etag=None), event(etag="bad\nvalue")):
            s3 = FakeS3()
            with self.subTest(specimen=specimen), self.assertRaises(ValueError):
                aws_handler.lambda_handler(specimen, None, s3_client=s3)
            self.assertEqual(s3.get_calls, [])
            self.assertEqual(s3.put_calls, [])
    def test_versioned_event_pin_and_reject_response_version_drift(self):
        s3 = FakeS3(version="v1")
        result = aws_handler.lambda_handler(event(version="v1", etag=None), None, s3_client=s3)
        self.assertEqual(result["count"], 1)
        self.assertEqual(s3.get_calls[0]["VersionId"], "v1")
        self.assertNotIn("IfMatch", s3.get_calls[0])
        stale = FakeS3(version="v2")
        with self.assertRaisesRegex(ValueError, "version differs"):
            aws_handler.lambda_handler(event(version="v1", etag=None), None, s3_client=stale)
        self.assertEqual(stale.put_calls, [])

if __name__ == "__main__":
    unittest.main()
