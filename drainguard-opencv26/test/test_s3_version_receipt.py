"""One focused offline regression for version-pinned, byte-bound S3 receipts."""
import hashlib
import io
import json
import unittest
from urllib.parse import quote_plus

import cv2

from drainguard.aws_handler import process_event
from drainguard.synthetic import make_scene


class _Body(io.BytesIO):
    pass


class _FakeS3:
    def __init__(self, ref, older, latest, slot_data):
        self.history = {
            ("reference/reference.png", None): ref,
            ("reference/slots.json", None): slot_data,
            ("captures/camera.png", "version-before-overwrite"): older,
            ("captures/camera.png", "version-after-overwrite"): latest,
        }
        self.reads = []
        self.writes = {}

    def get_object(self, **kwargs):
        key, version = kwargs["Key"], kwargs.get("VersionId")
        self.reads.append((key, version))
        raw = self.history[key, version]
        return {"Body": _Body(raw), "ContentLength": len(raw),
                "VersionId": version, "ETag": '"event-etag"'}

    def put_object(self, **kwargs):
        self.writes[kwargs["Key"]] = kwargs["Body"]


class _FakeTable:
    def __init__(self):
        self.items = []

    def put_item(self, **kwargs):
        self.items.append(kwargs["Item"])


class S3VersionReceipt(unittest.TestCase):
    def test_delayed_event_uses_original_capture_bytes(self):
        ref, old, slots = make_scene()
        _, old_png = cv2.imencode(".png", old)
        _, ref_png = cv2.imencode(".png", ref)
        latest_png = cv2.imencode(".png", ref)[1].tobytes()
        slot_data = json.dumps({"schema": "drainguard/slots/v1", "slots": [
            {"id": s.slot_id, "x": s.x, "y": s.y, "width": s.width, "height": s.height}
            for s in slots]}).encode()
        source = _FakeS3(ref_png.tobytes(), old_png.tobytes(), latest_png, slot_data)
        table = _FakeTable()
        base_event = {"eventSource": "aws:s3", "s3": {
            "bucket": {"name": "fixture-bucket"},
            "object": {"key": quote_plus("captures/camera.png"),
                       "versionId": "version-before-overwrite", "eTag": "event-etag"}}}
        first = process_event(base_event, source, table, "fixture-bucket", "reference/reference.png", "reference/slots.json")
        again = process_event(base_event, source, table, "fixture-bucket", "reference/reference.png", "reference/slots.json")
        self.assertEqual(first["assessment_id"], again["assessment_id"])
        self.assertIn(("captures/camera.png", "version-before-overwrite"), source.reads)
        self.assertNotIn(("captures/camera.png", None), source.reads)
        report = json.loads(source.writes[first["report_key"]])
        self.assertEqual(report["input_sha256"], hashlib.sha256(old_png.tobytes()).hexdigest())
        self.assertEqual(report["input_version_id"], "version-before-overwrite")
        self.assertFalse(report["can_authorize_maintenance"])
        self.assertTrue(report["human_review_required"])
        second_event = {**base_event, "s3": {**base_event["s3"], "object": {
            **base_event["s3"]["object"], "versionId": "version-after-overwrite"}}}
        newer = process_event(second_event, source, table, "fixture-bucket", "reference/reference.png", "reference/slots.json")
        self.assertNotEqual(first["assessment_id"], newer["assessment_id"])
        with self.assertRaisesRegex(ValueError, "versioned capture event required"):
            process_event({**base_event, "s3": {**base_event["s3"], "object": {
                "key": "captures/camera.png"}}}, source, table, "fixture-bucket",
                "reference/reference.png", "reference/slots.json")


if __name__ == "__main__":
    unittest.main()
