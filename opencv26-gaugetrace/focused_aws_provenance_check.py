"""Small offline provider-mock check for S3 evidence identity; no AWS requests."""
from __future__ import annotations

import importlib
import io
import json
import os
import sys
from types import ModuleType
from unittest.mock import patch

import cv2
import numpy as np


class FakeS3:
    def __init__(self):
        self.payload = b""
        self.etag = "etag1"
        self.version = "version1"
        self.gets = []
        self.puts = []

    def get_object(self, **request):
        self.gets.append(request)
        return {"Body": io.BytesIO(self.payload), "ETag": f'"{self.etag}"',
                "VersionId": self.version, "ContentLength": len(self.payload)}

    def put_object(self, **request):
        self.puts.append(request)


def event(*, etag="etag1", version="version1", key="gauge-input/a%2Fb.png", name="ObjectCreated:Put"):
    obj = {"key": key}
    if etag is not None:
        obj["eTag"] = etag
    if version is not None:
        obj["versionId"] = version
    return {"Records": [{"eventSource": "aws:s3", "eventName": name,
                          "s3": {"bucket": {"name": "private-input"}, "object": obj}}]}


def run():
    stub = ModuleType("gaugetrace")
    stub.analyze_image = lambda image, config: (
        {"schema": "gaugetrace/observation/v1", "decision": "RETAKE_OR_REVIEW", "reading": None}, image)
    fake = FakeS3()
    provider = ModuleType("boto3")
    provider.client = lambda service: fake if service == "s3" else None
    with patch.dict(sys.modules, {"boto3": provider, "gaugetrace": stub}), patch.dict(os.environ, {
        "GAUGE_OUTPUT_BUCKET": "private-review", "GAUGE_CALIBRATION_JSON":
        '{"start_deg":135,"end_deg":405,"min_value":0,"max_value":100}',
    }):
        adapter = importlib.import_module("aws_lambda")
        base = np.full((160, 160, 3), 90, np.uint8)
        cv2.line(base, (80, 80), (115, 105), (20, 20, 20), 2)
        ok, encoded = cv2.imencode(".png", base)
        assert ok
        fake.payload = encoded.tobytes()
        first = adapter.handler(event(), None)
        assert len(fake.puts) == 2 and first["operator_review_required"]
        assert fake.gets[-1]["VersionId"] == "version1"
        assert first["report_key"].startswith("gauge-review/reports/a/b.png.")
        receipt = json.loads(fake.puts[-2]["Body"])
        assert receipt["schema"] == "gaugetrace/observation/v1"
        assert receipt["source_evidence"]["version_bound"] is True
        assert receipt["source_evidence"]["key"] == "gauge-input/a/b.png"
        assert receipt["review_id"] == first["review_id"]
        assert len(first["source_sha256"]) == 64
        repeat = adapter.handler(event(), None)
        assert repeat["review_id"] == first["review_id"]
        assert repeat["report_key"] == first["report_key"]
        base[80, 80] = 230
        ok, encoded = cv2.imencode(".png", base)
        assert ok
        fake.payload = encoded.tobytes()
        fake.etag = "etag2"
        fake.version = "version2"
        second = adapter.handler(event(etag="etag2", version="version2"), None)
        assert second["review_id"] != first["review_id"]
        assert second["report_key"] != first["report_key"]
        assert second["overlay_key"] != first["overlay_key"]
        assert first["report_key"] in [p["Key"] for p in fake.puts]
        assert second["report_key"] in [p["Key"] for p in fake.puts]
        before = len(fake.puts)
        for stale in (event(etag="etag1", version="version2"),
                      event(etag="etag2", version="version1"),
                      event(etag=None, version=None),
                      event(name="ObjectRemoved:Delete"),
                      event(key="different-prefix/a.png")):
            try:
                adapter.handler(stale, None)
            except ValueError:
                pass
            else:
                raise AssertionError(f"invalid/stale S3 source accepted: {stale}")
        assert len(fake.puts) == before, "invalid events published evidence"
        # New calibration must identify a new review even for identical source pixels.
        os.environ["GAUGE_CALIBRATION_JSON"] = '{"max_value":200,"start_deg":135,"end_deg":405,"min_value":0}'
        third = adapter.handler(event(etag="etag2", version="version2"), None)
        assert third["review_id"] != second["review_id"]
        # Cross-event ETag on an unversioned object remains a fail-closed freshness check.
        fake.version = None
        fourth = adapter.handler(event(etag="etag2", version=None), None)
        assert json.loads(fake.puts[-2]["Body"])["source_evidence"]["version_bound"] is False
        assert fourth["review_id"] != third["review_id"]
        os.environ["GAUGE_CALIBRATION_JSON"] = '{"start_deg":135,"end_deg":405,"min_value":0,"max_value":100}'
        assert adapter.handler(event(etag="etag2", version=None), None)["review_id"] != second["review_id"]
    print("PASS focused S3 mock: 2 versions distinct; identical replay stable; calibration distinct; "
          "5 rejection gates no writes; version/ETag binding; unversioned ETag; source report schema preserved; "
          f"OpenCV {cv2.__version__} for synthetic encoding only; NO AWS calls")


if __name__ == "__main__":
    run()
