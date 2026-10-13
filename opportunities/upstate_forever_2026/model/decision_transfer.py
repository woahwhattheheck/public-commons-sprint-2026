"""Resumable large-assessment transport for the original scientific operator.

The authenticated operator admits at most 4 MiB per JSON request. This transport
uses one-MiB immutable parts, preserving the complete calculated assessment and
resuming interrupted transfers by their original content identities.
"""
from __future__ import annotations

import base64
import binascii
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

from .common import canonical, held, read_json

SCHEMA = "upstate.decision-transfer/v1"
DIRECTORY = "decision-transfers"
PART_BYTES = 1024 * 1024
HEX = re.compile(r"^[0-9a-f]{64}$")


def _metadata(value):
    if not isinstance(value, dict):
        raise ValueError("Include the assessment transfer description.")
    keys = ("schema", "upload_id", "encoding", "bytes", "sha256",
            "raw_bytes", "raw_sha256", "parts")
    result = {key: value.get(key) for key in keys}
    if result["schema"] != SCHEMA or result["encoding"] not in ("identity", "gzip"):
        raise ValueError("Use the original JSON or gzip assessment transfer format.")
    for key in ("upload_id", "sha256", "raw_sha256"):
        if not isinstance(result[key], str) or not HEX.fullmatch(result[key]):
            raise ValueError("Preserve the complete SHA-256 identity for " + key + ".")
    if result["upload_id"] != result["sha256"]:
        raise ValueError("The transfer identity must match its original encoded content.")
    for key in ("bytes", "raw_bytes", "parts"):
        if type(result[key]) is not int or result[key] < 1:
            raise ValueError("Use a positive integer for transfer " + key + ".")
    if result["parts"] != (result["bytes"] + PART_BYTES - 1) // PART_BYTES:
        raise ValueError("The part count must match the original transfer byte length.")
    if result["encoding"] == "identity" and (
            result["bytes"] != result["raw_bytes"] or result["sha256"] != result["raw_sha256"]):
        raise ValueError("An uncompressed transfer must retain its original JSON byte identity.")
    return result


def _directory(workspace, metadata):
    root = (workspace.root / DIRECTORY).resolve()
    root.relative_to(workspace.root)
    path = (root / metadata["upload_id"]).resolve()
    path.relative_to(root)
    return path


def _once(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != content:
            raise ValueError("An existing assessment transfer part has different bytes.")
        return True
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".part-", delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_bytes() != content:
                raise ValueError("An existing assessment transfer part has different bytes.")
    finally:
        temporary.unlink(missing_ok=True)
    return False


def upload(workspace, request):
    metadata = _metadata(request.get("upload"))
    directory = _directory(workspace, metadata)
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".lock"):
        _once(directory / "transfer.json", canonical(metadata) + b"\n")
        if "part" not in request:
            present = []
            for path in sorted(directory.glob("*.part")):
                try:
                    index = int(path.stem)
                except ValueError:
                    continue
                if 0 <= index < metadata["parts"]:
                    present.append(index)
            return {"upload_id": metadata["upload_id"], "received_parts": present,
                    "parts": metadata["parts"], "part_bytes": PART_BYTES}
        index = request["part"]
        if type(index) is not int or not 0 <= index < metadata["parts"]:
            raise ValueError("Choose an existing assessment part index.")
        encoded = request.get("content")
        if not isinstance(encoded, str) or len(encoded) > 4 * ((PART_BYTES + 2) // 3):
            raise ValueError("Keep each assessment part within one MiB before base64 encoding.")
        try:
            content = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("The assessment part is not valid base64.") from error
        expected_bytes = min(PART_BYTES, metadata["bytes"] - index * PART_BYTES)
        if len(content) != expected_bytes:
            raise ValueError("The assessment part does not match its original byte length.")
        actual_sha = hashlib.sha256(content).hexdigest()
        if actual_sha != request.get("part_sha256"):
            raise ValueError("The assessment part does not match its original SHA-256.")
        reused = _once(directory / (str(index).zfill(8) + ".part"), content)
        return {"upload_id": metadata["upload_id"], "part": index,
                "bytes": len(content), "sha256": actual_sha, "reused": reused}


def _load_original(stream, metadata):
    digest = hashlib.sha256()
    size = 0
    with tempfile.TemporaryFile(mode="w+b") as original:
        while True:
            content = stream.read(min(PART_BYTES, metadata["raw_bytes"] - size + 1))
            if not content:
                break
            size += len(content)
            if size > metadata["raw_bytes"]:
                raise ValueError("The decoded assessment exceeds its original declared size.")
            digest.update(content)
            original.write(content)
        if size != metadata["raw_bytes"] or digest.hexdigest() != metadata["raw_sha256"]:
            raise ValueError("The decoded assessment does not match its original JSON bytes.")
        original.seek(0)
        def invalid(value):
            raise ValueError("Assessment numbers must be finite.")
        result = json.load(original, parse_constant=invalid)
    if not isinstance(result, dict):
        raise ValueError("The calculated assessment must be a JSON object.")
    return result


def load(workspace, reference):
    metadata = _metadata(reference)
    directory = _directory(workspace, metadata)
    with held(directory / ".lock"):
        if read_json(directory / "transfer.json") != metadata:
            raise ValueError("The assessment transfer description has changed.")
        with tempfile.TemporaryFile(mode="w+b") as combined:
            total = 0
            digest = hashlib.sha256()
            for index in range(metadata["parts"]):
                path = directory / (str(index).zfill(8) + ".part")
                if not path.is_file():
                    raise ValueError("Resume the assessment transfer; part " + str(index) + " is missing.")
                expected = min(PART_BYTES, metadata["bytes"] - index * PART_BYTES)
                with path.open("rb") as part:
                    content = part.read(PART_BYTES + 1)
                if len(content) != expected:
                    raise ValueError("The retained assessment part has changed: " + str(index))
                total += len(content)
                digest.update(content)
                combined.write(content)
            if total != metadata["bytes"] or digest.hexdigest() != metadata["sha256"]:
                raise ValueError("The retained assessment transfer does not match its original bytes.")
            combined.seek(0)
            if metadata["encoding"] == "gzip":
                with gzip.GzipFile(fileobj=combined, mode="rb") as decoded:
                    return _load_original(decoded, metadata)
            return _load_original(combined, metadata)


