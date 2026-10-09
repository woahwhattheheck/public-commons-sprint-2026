"""One bounded offline AWS-mocked PalletGap manifest snapshot/receipt check."""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import types
import unittest
from unittest.mock import patch

# Stub only the unrelated OpenCV vision dependency; all S3 handler code is real.
vision_stub = types.ModuleType("palletgap.vision")
vision_stub.decode_image = lambda image: image
vision_stub.orchestrate = lambda *args: None
with patch.dict(sys.modules, {"palletgap.vision": vision_stub}):
    from palletgap import aws_lambda

BUCKET = "synthetic-only"
MANIFEST_KEY = "requests/inspection.json"
CONFIG_KEY = "config/site/camera.json"
REFERENCE_KEY = "frames/site/reference.png"
FIRST_KEY = "frames/site/frame1.png"


def md5_etag(data):
    return hashlib.md5(data).hexdigest()  # Mock S3 ETag, NOT evidence identity.


class FakeS3:
    def __init__(self, current, versions=None):
        self.current = current
        self.versions = versions or {}
        self.calls = []

    def get_object(self, *, Bucket, Key, VersionId=None, IfMatch=None):
        assert Bucket == BUCKET
        self.calls.append((Key, VersionId, IfMatch))
        data = self.versions[(Key, VersionId)] if VersionId is not None else self.current[Key]
        etag = md5_etag(data)
        if IfMatch is not None and IfMatch.strip('"').lower() != etag:
            raise ValueError("PreconditionFailed: event content was overwritten")
        response = {"ContentLength": len(data), "Body": io.BytesIO(data), "ETag": '"' + etag + '"'}
        if VersionId is not None:
            response["VersionId"] = VersionId
        return response


class FakeDynamo:
    def __init__(self):
        self.items = []

    def Table(self, name):
        assert name == "audit-table"
        return self

    def put_item(self, **kwargs):
        self.items.append(kwargs["Item"])


class FakeSQS:
    def __init__(self):
        self.messages = []

    def send_message(self, **kwargs):
        self.messages.append(kwargs)


def fixture(frame=b"mock-image-A"):
    manifest = json.dumps({
        "schema": 1, "site": "site", "camera_key": CONFIG_KEY,
        "first_key": FIRST_KEY,
    }, sort_keys=True).encode()
    config = json.dumps({"reference_key": REFERENCE_KEY, "aisle_polygon": [[0, 0], [2, 0], [2, 2]]}).encode()
    return {MANIFEST_KEY: manifest, CONFIG_KEY: config, REFERENCE_KEY: b"reference-image", FIRST_KEY: frame}


def event(**event_object):
    return {"Records": [{"s3": {"bucket": {"name": BUCKET}, "object": {"key": MANIFEST_KEY, **event_object}}}]}


def execute(s3, notification):
    db, queue = FakeDynamo(), FakeSQS()
    def fake_client(service):
        return s3 if service == "s3" else queue if service == "sqs" else None
    env = {"PALLET_BUCKET": BUCKET, "PALLET_TABLE": "audit-table", "PALLET_REVIEW_QUEUE_URL": "mock-review-queue"}
    decision = {"decision": "HUMAN_REVIEW_REQUIRED", "next_action": "operator_review", "first": {"regions": [1]}}
    with patch.dict(os.environ, env), patch("boto3.client", side_effect=fake_client), \
            patch("boto3.resource", return_value=db), \
            patch.object(aws_lambda, "decode_image", side_effect=lambda data: data), \
            patch.object(aws_lambda, "orchestrate", return_value=decision):
        result = aws_lambda.handler(notification, None)
    return result, db, queue


class SnapshotBinding(unittest.TestCase):
    def test_pins_versioned_event_instead_of_current_manifest(self):
        old = fixture()
        new = fixture()
        new[MANIFEST_KEY] = b"{\"invalid\":true}"  # Simulates overwrite after event A.
        s3 = FakeS3(new, versions={(MANIFEST_KEY, "vA"): old[MANIFEST_KEY]})
        result, db, queue = execute(s3, event(versionId="vA", eTag=md5_etag(old[MANIFEST_KEY])))
        self.assertEqual(result["status"], "PROCESSED")
        self.assertEqual(result["evidence_sha256"]["manifest"], hashlib.sha256(old[MANIFEST_KEY]).hexdigest())
        self.assertIn((MANIFEST_KEY, "vA", '"' + md5_etag(old[MANIFEST_KEY]) + '"'), s3.calls)
        self.assertEqual(db.items[0]["inspection_id"], result["inspection_id"])
        self.assertEqual(len(queue.messages), 1)

    def test_rejects_stale_unversioned_event_before_a_review_receipt(self):
        old = fixture()
        new = fixture()
        new[MANIFEST_KEY] = b"{}"  # Key overwritten; event ETag refers to old bytes.
        s3 = FakeS3(new)
        with self.assertRaisesRegex(ValueError, "PreconditionFailed"):
            execute(s3, event(eTag=md5_etag(old[MANIFEST_KEY])))
        self.assertEqual(len(s3.calls), 1)

    def test_frame_bytes_bind_receipt_without_changing_manifest(self):
        original = fixture()
        notif = event(eTag=md5_etag(original[MANIFEST_KEY]))
        first, db1, queue1 = execute(FakeS3(original), notif)
        same, _, _ = execute(FakeS3(original), notif)
        changed = fixture(frame=b"different frame bytes")
        second, db2, queue2 = execute(FakeS3(changed), notif)
        self.assertEqual(first["inspection_id"], same["inspection_id"])
        self.assertNotEqual(first["inspection_id"], second["inspection_id"])
        self.assertNotEqual(first["evidence_sha256"]["first"], second["evidence_sha256"]["first"])
        self.assertEqual(db1.items[0]["evidence_sha256"],
                         json.loads(queue1.messages[0]["MessageBody"])["evidence_sha256"])
        self.assertEqual(db2.items[0]["inspection_id"], second["inspection_id"])
        self.assertEqual(len(queue2.messages), 1)

    def test_rejects_event_with_no_snapshot_binding(self):
        s3 = FakeS3(fixture())
        with self.assertRaisesRegex(ValueError, "neither versionId nor eTag"):
            execute(s3, event())
        self.assertEqual(s3.calls, [])


if __name__ == "__main__":
    unittest.main()
