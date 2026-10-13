"""Reopen original source bytes carried by the maintained SourceArtifacts helper.

The original helper owns HTTP streaming and Slack finalization. This reader
binds its completed result to the exact local file supplied to source intake.
"""
from pathlib import Path
import re
from model.common import file_digest, read_json

def _matches(path, record):
    path = Path(path)
    return (path.is_file() and path.stat().st_size == record["bytes"]
            and file_digest(path) == record["sha256"])

def received_transfer(path, artifact, *, source_url, maximum_bytes):
    value = read_json(path)
    if isinstance(value, dict) and value.get("event") == "result":
        value = value.get("result")
    if (not isinstance(value, dict)
            or value.get("schema") != "commons.source-artifact-transfer.v1"
            or value.get("phase") != "COMPLETE" or value.get("ok", True) is not True):
        raise ValueError("Select the completed original source-artifact transfer result")
    receipt, body = value.get("receipt"), value.get("body")
    if not isinstance(receipt, dict) or not isinstance(body, dict):
        raise ValueError("The original transfer lacks its completed source and upload receipt")
    source = receipt.get("source", {})
    count, sha = receipt.get("bytes"), receipt.get("sha256")
    if (not isinstance(source, dict)
            or type(count) is not int or not 0 < count <= maximum_bytes
            or not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{64}", sha)
            or source.get("url") != source_url or source.get("bytes") != count
            or value.get("source") != source or body.get("complete") is not True
            or body.get("bytes") != count or body.get("sha256") != sha
            or not isinstance(body.get("streamed_at"), str) or not body["streamed_at"]
            or not _matches(artifact, {"bytes": count, "sha256": sha})):
        raise ValueError("The received source bytes differ from the original completed transfer")
    upload = receipt.get("upload_receipt", {})
    if (not isinstance(upload, dict) or upload.get("ok") is not True
            or type(upload.get("http_status")) is not int
            or not 200 <= upload["http_status"] < 300
            or upload.get("bytes_uploaded") != count
            or upload.get("acknowledged_bytes") not in (None, count)):
        raise ValueError("The original archive upload acknowledgment is incomplete")
    file_id = receipt.get("file_id")
    readback = receipt.get("readback", {})
    completed = receipt.get("provider_completion")
    destination = value.get("destination", {})
    provider_completed = (
        isinstance(completed, dict) and completed.get("ok") is True
        and isinstance(completed.get("files"), list)
        and any(isinstance(row, dict) and row.get("id") == file_id
                for row in completed["files"]))
    # A completed readback recovery can retain a null provider response when
    # the original finalization journal was interrupted. Keep that original
    # record unchanged; the full byte/upload/readback checks still apply.
    # An explicit unsuccessful provider response is not a recovery record.
    recovered_completion = (
        "provider_completion" in receipt and completed is None
        and isinstance(receipt.get("completed_at"), str)
        and bool(receipt["completed_at"].strip()))
    if (not isinstance(file_id, str) or not re.fullmatch(r"F[A-Z0-9]+", file_id)
            or value.get("file_id") != file_id
            or not (provider_completed or recovered_completion)
            or not isinstance(readback, dict) or not isinstance(destination, dict)
            or readback.get("ok") is not True or readback.get("file_id") != file_id
            or not isinstance(readback.get("message_ts"), str)
            or not re.fullmatch(r"[0-9]+\.[0-9]{1,6}", readback["message_ts"])
            or any(readback.get(key) != receipt.get(key) or destination.get(key) != receipt.get(key)
                   for key in ("channel_id", "thread_ts"))):
        raise ValueError("The received source must keep its original completed file and destination")
    return value, receipt


def capture_from_transfer(value, receipt, *, transfer_sha256):
    """Project the accepted transfer into the existing public-source receipt."""
    source = receipt["source"]
    return {
        "schema": "upstate.received-public-source/v1", "state": "complete",
        "url": source["url"], "final_url": source["final_url"], "status": 200,
        "source_header_observed_at": source["observed_at"],
        "observed_at": value["body"]["streamed_at"],
        "bytes": receipt["bytes"], "sha256": receipt["sha256"],
        "headers": {name: source[key] for name, key in
                    (("Content-Type", "content_type"), ("ETag", "etag"), ("Last-Modified", "last_modified"))
                    if source.get(key) is not None},
        "capture_method": "Original SourceArtifacts HTTP-200 stream and completed file handoff",
        "transfer_operation_id": value["operation_id"],
        "transfer_file_id": receipt["file_id"],
        "transfer_receipt_sha256": transfer_sha256,
    }
