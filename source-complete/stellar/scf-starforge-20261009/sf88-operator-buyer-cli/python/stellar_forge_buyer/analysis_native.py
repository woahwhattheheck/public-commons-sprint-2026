"""Attach a verified COMPLETE native dataset through the original workspace.

The authenticated host bridge supplies paths. The agent supplies only its saved
native acquisition ID and analytical alias. This module neither starts an
acquisition nor creates another database/process owner.
"""
from __future__ import annotations

import os
from pathlib import Path
import re

from .errors import StateError
from .storage import digest, parse, private_directory, read

_HASH = re.compile(r"[a-f0-9]{64}")
_SESSION = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}")


def _expected(value):
    if (not isinstance(value, dict)
            or set(value) != {"sessionId", "configurationSha256", "sourceBindingSha256"}
            or not isinstance(value["sessionId"], str)
            or not _SESSION.fullmatch(value["sessionId"])
            or any(not isinstance(value[key], str) or not _HASH.fullmatch(value[key])
                   for key in ("configurationSha256", "sourceBindingSha256"))):
        raise StateError("ANALYSIS_NATIVE_DATASET_IDENTITY_REQUIRED")
    return value


def _path(value):
    if not isinstance(value, str) or "\0" in value or not os.path.isabs(value) or os.path.abspath(value) != value:
        raise StateError("ANALYSIS_NATIVE_DATASET_PATH_INVALID")
    path = Path(value)
    if private_directory(path, create=False) != path:
        raise StateError("ANALYSIS_NATIVE_DATASET_PATH_CHANGED")
    return path


def attach_dataset(workspace, body):
    """Authenticated POST adapter; native registration remains the only writer."""
    if (not isinstance(body, dict)
            or set(body) != {"name", "expected_revision", "session", "room", "expected_native"}):
        raise StateError("ANALYSIS_NATIVE_DATASET_REQUEST_INVALID")
    expected = _expected(body["expected_native"])
    session, room = _path(body["session"]), _path(body["room"])
    # The original registration validates name/revision and performs its own CAS.
    return workspace.register_source(body["name"], session, room=room,
        expected_revision=body["expected_revision"], expected_native=expected)


def verify_dataset_source(workspace, source, report, expected_native):
    """Called by original register_source before any source-alias DB mutation.

    The original SF88/SF100 deliver operation reopens an existing finalized room,
    verifies all original page and output identities, and appends zero pages.
    """
    expected = _expected(expected_native)
    session, room = _path(source["session"]), _path(source["room"])
    if (report.get("status") != "COMPLETE"
            or report.get("sessionId") != expected["sessionId"]
            or report.get("configurationSha256") != expected["configurationSha256"]):
        raise StateError("ANALYSIS_NATIVE_DATASET_IDENTITY_CHANGED")
    session_path, manifest_path = session / "session.json", room / "manifest.json"
    session_sha = digest(read(session_path, 4 * 1024 * 1024))
    if session_sha != source["session_sha256"]:
        raise StateError("ANALYSIS_NATIVE_DATASET_SESSION_CHANGED")
    manifest_bytes = read(manifest_path, 4 * 1024 * 1024)
    manifest = parse(manifest_bytes)
    if (not isinstance(manifest, dict)
            or manifest.get("schema") != "stellar-forge.buyer-delivery-manifest.v1"):
        raise StateError("ANALYSIS_NATIVE_FINALIZED_ROOM_REQUIRED")
    delivery = workspace._acquisition(source).deliver(room)
    native, status = delivery.native, delivery.status
    if (native.get("sourceDirectory") != str(session)
            or native.get("sourceBindingSha256") != expected["sourceBindingSha256"]
            or native.get("resumed") is not True or native.get("appendedPages") != 0
            or not isinstance(status, dict) or status.get("complete") is not True
            or status.get("finalized") is not True):
        raise StateError("ANALYSIS_NATIVE_DATASET_DELIVERY_CHANGED")
    manifest_sha = digest(manifest_bytes)
    retained = native["outputs"]["manifest.json"]
    if (retained.get("bytes") != len(manifest_bytes) or retained.get("sha256") != manifest_sha
            or digest(read(manifest_path, 4 * 1024 * 1024)) != manifest_sha
            or digest(read(session_path, 4 * 1024 * 1024)) != session_sha):
        raise StateError("ANALYSIS_NATIVE_DATASET_SOURCE_CHANGED")
    source["native_delivery"] = {
        "schema": native["schema"], "sourceBindingSha256": expected["sourceBindingSha256"],
        "manifestSha256": manifest_sha, "initialNativeBlob": native.get("initialNativeBlob"),
        "nativeBlob": native.get("nativeBlob"), "paymentStatus": delivery.payment_status,
        "rows": status.get("rows"), "snapshot": status.get("snapshot"),
    }
