"""One focused offline adapter check; synthetic bytes and fake AWS only.

No actual OpenCV, AWS credentials, provider calls, or official contest data.
"""
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import types


class FakePreconditionFailed(Exception):
    response = {"Error": {"Code": "PreconditionFailed"}}


class FakeS3:
    def __init__(self):
        self.source = {}
        self.latest = {}
        self.written = {}
        self.writes = 0
        self.requested = []
        self.bad_response_version = False

    def add(self, key, version, raw):
        self.source[("images", key, version)] = raw
        self.latest[("images", key)] = version

    def get_object(self, *, Bucket, Key, VersionId=None):
        self.requested.append((Bucket, Key, VersionId))
        if Bucket == "images":
            assert VersionId is not None, "unversioned latest-key fetch forbidden"
            raw = self.source[(Bucket, Key, VersionId)]
            return {"VersionId": "WRONG" if self.bad_response_version else VersionId,
                    "ContentLength": len(raw), "Body": io.BytesIO(raw)}
        raw = self.written[(Bucket, Key)]
        return {"ContentLength": len(raw), "Body": io.BytesIO(raw)}

    def put_object(self, *, Bucket, Key, Body, ContentType, IfNoneMatch):
        assert IfNoneMatch == "*" and ContentType in ("application/json", "image/png")
        if (Bucket, Key) in self.written:
            raise FakePreconditionFailed()
        self.written[(Bucket, Key)] = Body
        self.writes += 1


def stub_analyzer(raw):
    return ({"schema":"orchardcue-review/1", "input_sha256":hashlib.sha256(raw).hexdigest(),
             "candidate_count":0, "decision":{"action":"HUMAN_REVIEW_REQUIRED"}},
            b"PNG-SYNTHETIC-" + hashlib.sha256(raw).digest())


def event(version=None, key="incoming/tree.png"):
    object_info = {"key":key}
    if version is not None:
        object_info["versionId"] = version
    return {"Records":[{"eventSource":"aws:s3", "eventName":"ObjectCreated:Put",
                        "s3":{"bucket":{"name":"images"},"object":object_info}}]}


def run():
    fake = FakeS3()
    engine = types.ModuleType("engine")
    engine.analyze_bytes = stub_analyzer
    boto3 = types.ModuleType("boto3")
    boto3.client = lambda service: fake if service == "s3" else None
    sys.modules["engine"] = engine
    sys.modules["boto3"] = boto3
    os.environ["ORCHARDCUE_INPUT_BUCKET"] = "images"
    os.environ["ORCHARDCUE_REVIEW_BUCKET"] = "private-review"
    p = Path(__file__).with_name("aws_lambda.py")
    spec = importlib.util.spec_from_file_location("orchardcue_adapter_focused", p)
    adapter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(adapter)

    same = b"synthetic-image-bytes" * 800
    different = b"synthetic-new-image-bytes" * 800
    fake.add("incoming/tree.png", "v1", same)
    fake.add("incoming/tree.png", "v2", same)  # same content, distinct immutable version
    fake.add("incoming/tree.png", "v3", different)  # latest key differs from delayed event
    a = adapter.lambda_handler(event("v1"), None)
    b = adapter.lambda_handler(event("v2"), None)
    c = adapter.lambda_handler(event("v3"), None)
    assert a["receipt_status"] == b["receipt_status"] == c["receipt_status"] == "CREATED"
    assert len({a["review_prefix"], b["review_prefix"], c["review_prefix"]}) == 3
    assert a["input_sha256"] == b["input_sha256"] != c["input_sha256"]
    assert fake.requested[0] == ("images", "incoming/tree.png", "v1")
    assert fake.writes == 6
    replay = adapter.lambda_handler(event("v1"), None)
    assert replay["receipt_status"] == "ALREADY_IDENTICAL" and fake.writes == 6
    for prefix in (a["review_prefix"],b["review_prefix"],c["review_prefix"]):
        assert ("private-review", prefix+"/report.json") in fake.written
        assert ("private-review", prefix+"/overlay.png") in fake.written

    invalid_before = len(fake.requested)
    try:
        adapter.lambda_handler(event(), None)
        raise AssertionError("missing version incorrectly accepted")
    except ValueError as err:
        assert "versioned S3 event" in str(err)
    assert len(fake.requested) == invalid_before  # reject BEFORE get_object
    fake.bad_response_version = True
    try:
        adapter.lambda_handler(event("v1"), None)
        raise AssertionError("version mismatch incorrectly accepted")
    except ValueError as err:
        assert "version differs" in str(err)
    fake.bad_response_version = False
    # Changed analyzer/source under a replay must not overwrite the prior immutable pair.
    existing = fake.written[("private-review", a["review_prefix"]+"/report.json")]
    fake.written[("private-review", a["review_prefix"]+"/report.json")] = b"tampered"
    try:
        adapter.lambda_handler(event("v1"), None)
        raise AssertionError("conflicting prior evidence incorrectly accepted")
    except ValueError as err:
        assert "conflicts" in str(err)
    fake.written[("private-review", a["review_prefix"]+"/report.json")] = existing
    assert fake.writes == 6
    print("PASS focused fake-S3: event VersionId bound despite later latest version;"
          " equal-byte distinct versions preserved; replay idempotent;"
          " unversioned/mismatched/tampered evidence rejected; zero AWS calls")


if __name__ == "__main__":
    run()
