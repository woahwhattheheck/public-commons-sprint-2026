"""Resume one original HTTP capture without discarding its received prefix.

TokenJunkieLabs. The original capture and lock remain authoritative. Recovery
retains each actual response and appends only contiguous ranges carrying the
same strong source validator. No geographic request is made by this module.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request

from model.common import atomic_json, digest, file_digest, held, now, read_json

SCHEMA = "upstate.public-source-range-recovery/v1"
HEADERS = ("Date", "ETag", "Last-Modified", "Content-Type", "Content-Length",
           "Content-Encoding", "Accept-Ranges", "Content-Range", "Retry-After")
BLOCK_BYTES = 1024 * 1024
DEFAULT_CHUNK_BYTES = 32 * 1024 * 1024


class InvalidRangeBody(ValueError):
    """The response body contradicts its otherwise accepted range metadata."""


def _positive(value, label):
    if type(value) is not int or value <= 0:
        raise ValueError(label + " must be a positive integer")
    return value


def _sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _headers(value):
    return {str(k).lower(): str(v) for k, v in value.items()}


def _strong_etag(value):
    return isinstance(value, str) and re.fullmatch(r'"[\x21\x23-\x7e\x80-\xff]*"', value) is not None


def _hash_prefix(path, count):
    result = hashlib.sha256()
    with path.open("rb") as source:
        remaining = count
        while remaining:
            block = source.read(min(BLOCK_BYTES, remaining))
            if not block:
                raise ValueError("The retained original prefix is incomplete")
            result.update(block)
            remaining -= len(block)
    return result


def _owned_file(path):
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError("Use an ordinary retained source file")
    return path


def _receipt(receipt_path, original, selection, state, error=None):
    value = {**original, "state": "interrupted" if error else "receiving",
             "received_bytes": state["committed_bytes"], "observed_at": now(),
             "range_recovery": {"schema": SCHEMA, "selection_sha256": digest(selection),
                                "committed_bytes": state["committed_bytes"],
                                "prefix_sha256": state["prefix_sha256"]}}
    value.pop("error", None)
    if error:
        value["error"] = error
    atomic_json(receipt_path, value)


def _commit_response(state_path, receipt_path, original, selection, state,
                     active, prefix_hash, segment_hash, received, error=None):
    record = {**active, "state": "interrupted" if error else "complete",
              "bytes": received, "sha256": segment_hash.hexdigest(),
              "observed_at": now()}
    if received:
        record["received_end"] = active["start"] + received - 1
    if error:
        record["error"] = error
    state["requests"].append(record)
    state.update(committed_bytes=active["start"] + received,
                 prefix_sha256=prefix_hash.hexdigest(), active=None)
    # The recovery state commits first. An interrupted outer receipt write is
    # reconciled from this same state, without repeating the completed request.
    atomic_json(state_path, state)
    _receipt(receipt_path, original, selection, state, error)


def _validate_state(selection, state):
    if (state.get("schema") != SCHEMA or state.get("selection_sha256") != digest(selection)
            or type(state.get("committed_bytes")) is not int
            or not selection["original_prefix_bytes"] <= state["committed_bytes"] <= selection["total_bytes"]
            or not isinstance(state.get("requests"), list)):
        raise ValueError("The saved recovery state belongs to another original source")
    cursor = selection["original_prefix_bytes"]
    for row in state["requests"]:
        count = row.get("bytes")
        if type(count) is not int or count < 0 or row.get("start") != cursor:
            raise ValueError("The retained responses do not describe a contiguous original prefix")
        if count:
            if (row.get("status") != 206 or row.get("validated") is not True
                    or row.get("etag") != selection["etag"]
                    or cursor + count > row.get("end", -1) + 1):
                raise ValueError("An appended response differs from its original validated range")
            cursor += count
    if cursor != state["committed_bytes"]:
        raise ValueError("The retained response lengths differ from the original prefix")


def _complete(path, receipt_path, original, selection, state):
    target = path if path.exists() else path.with_name(path.name + ".partial")
    if target.stat().st_size != selection["total_bytes"]:
        raise ValueError("The complete entity differs from its original byte count")
    if file_digest(target) != state["prefix_sha256"]:
        raise ValueError("The complete entity differs from its recovered original bytes")
    value = {**original, "state": "received", "observed_at": now(),
             "bytes": selection["total_bytes"], "sha256": state["prefix_sha256"],
             "received_bytes": selection["total_bytes"],
             "range_recovery": {"schema": SCHEMA, "selection": selection,
                                "requests": state["requests"], "recovered_at": now(),
                                "integrity": "Original prefix and contiguous source-validated HTTP 206 ranges"}}
    value.pop("error", None)
    atomic_json(receipt_path, value)
    if target != path:
        os.replace(target, path)
        _sync_directory(path.parent)
    value["state"] = "complete"
    atomic_json(receipt_path, value)
    return value


def resume(path, *, maximum_bytes, chunk_bytes=DEFAULT_CHUNK_BYTES, progress=None):
    """Continue the original interrupted entity, retaining valid partial progress."""
    _positive(maximum_bytes, "Maximum original entity bytes")
    _positive(chunk_bytes, "Requested range bytes")
    # Preserve explicit parent aliases, while refusing a symlinked source leaf.
    path = Path(os.path.abspath(os.fspath(path)))
    path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path = _owned_file(path.with_name(path.name + ".capture.json"))
    partial = _owned_file(path.with_name(path.name + ".partial"))
    _owned_file(path)
    recovery = path.with_name(path.name + ".range-recovery")

    def emit(stage, state, **extra):
        if progress:
            progress({"stage": stage, "observed_at": now(),
                      "received_bytes": state["committed_bytes"],
                      "total_bytes": selection["total_bytes"],
                      "remaining_bytes": selection["total_bytes"] - state["committed_bytes"],
                      **extra})

    with held(path.with_name(path.name + ".lock"), blocking=False):
        receipt = read_json(receipt_path)
        if receipt.get("schema") != "upstate.public-source-capture/v1":
            raise ValueError("Select the original source capture receipt")
        headers = _headers(receipt.get("headers", {}))
        url = receipt.get("url")
        if not isinstance(url, str) or not url.startswith("https://"):
            raise ValueError("The original capture must identify its HTTPS source")
        total = int(headers.get("content-length", "0"))
        if not 0 < total <= maximum_bytes:
            raise ValueError("The original entity must fit its observed source budget")
        if receipt.get("state") in ("received", "complete"):
            existing = path if path.exists() else partial
            if (receipt.get("status") != 200 or receipt.get("bytes") != total
                    or not existing.is_file() or existing.stat().st_size != total
                    or file_digest(existing) != receipt.get("sha256")):
                raise ValueError("The completed original entity differs from its source receipt")
            if existing != path:
                os.replace(existing, path)
                _sync_directory(path.parent)
            if receipt["state"] != "complete":
                receipt["state"] = "complete"
                atomic_json(receipt_path, receipt)
            return receipt

        if recovery.is_symlink() or (recovery.exists() and not recovery.is_dir()):
            raise ValueError("Use an ordinary source recovery directory")
        recovery.mkdir(exist_ok=True)
        selection_path = _owned_file(recovery / "selection.json")
        state_path = _owned_file(recovery / "state.json")
        if selection_path.exists():
            selection = read_json(selection_path)
            original = selection["original_receipt"]
            if (selection.get("schema") != SCHEMA or selection["url"] != url
                    or selection["total_bytes"] != total
                    or selection["maximum_bytes"] != maximum_bytes
                    or selection["etag"] != headers.get("etag")):
                raise ValueError("The original recovery selects a different HTTP entity")
        else:
            etag = headers.get("etag")
            if (receipt.get("status") != 200 or not _strong_etag(etag)
                    or headers.get("accept-ranges", "").lower() != "bytes"
                    or headers.get("content-encoding", "identity").lower() != "identity"):
                raise ValueError("The original response needs byte ranges and its same strong ETag")
            if path.exists() or not partial.is_file():
                raise ValueError("Keep the original interrupted partial and its capture receipt")
            prefix = partial.stat().st_size
            if receipt.get("received_bytes") != prefix or not 0 < prefix < total:
                raise ValueError("The retained prefix differs from the interrupted capture")
            prefix_hash = _hash_prefix(partial, prefix)
            original = receipt
            selection = {"schema": SCHEMA, "url": url, "etag": etag, "total_bytes": total,
                         "maximum_bytes": maximum_bytes, "original_prefix_bytes": prefix,
                         "original_prefix_sha256": prefix_hash.hexdigest(),
                         "original_receipt": original}
            atomic_json(selection_path, selection, immutable=True)

        original_headers = _headers(original.get("headers", {}))
        if (not _strong_etag(selection["etag"]) or original.get("status") != 200
                or original.get("url") != url or original_headers.get("etag") != selection["etag"]
                or int(original_headers.get("content-length", "0")) != total):
            raise ValueError("The original recovery source validator differs")
        if state_path.exists():
            state = read_json(state_path)
        else:
            # A process can stop after selecting the source but before its first
            # state write. Recreate only the unchanged original initial prefix.
            prefix = selection["original_prefix_bytes"]
            if (path.exists() or not partial.is_file() or partial.stat().st_size != prefix
                    or _hash_prefix(partial, prefix).hexdigest() != selection["original_prefix_sha256"]):
                raise ValueError("The initial recovery prefix differs from its original selection")
            state = {"schema": SCHEMA, "selection_sha256": digest(selection),
                     "committed_bytes": prefix, "prefix_sha256": selection["original_prefix_sha256"],
                     "requests": [], "active": None}
            atomic_json(state_path, state, immutable=True)

        _validate_state(selection, state)
        target = path if path.exists() else partial
        if not target.is_file() or target.stat().st_size < state["committed_bytes"]:
            raise ValueError("The retained original prefix is missing")
        prefix_hash = _hash_prefix(target, state["committed_bytes"])
        if prefix_hash.hexdigest() != state["prefix_sha256"]:
            raise ValueError("The retained original prefix changed")
        if path.exists() and state["committed_bytes"] != total:
            raise ValueError("Reconcile the final source path before continuing its partial")
        tail = target.stat().st_size - state["committed_bytes"]
        active = state.get("active")
        if active and active.get("discard_all"):
            if (path.exists() or active.get("start") != state["committed_bytes"]
                    or active.get("validated") is not True
                    or tail > active["end"] - active["start"] + 1):
                raise ValueError("The rejected tail differs from its original append boundary")
            with partial.open("r+b", buffering=0) as output:
                output.truncate(state["committed_bytes"])
                os.fsync(output.fileno())
            _commit_response(state_path, receipt_path, original, selection, state, active,
                             prefix_hash, hashlib.sha256(), 0,
                             active.get("error", "The source range body contradicted its declared end"))
        elif tail:
            # An interrupted commit may leave an appended response tail. Adopt
            # only bytes bound to its already-saved original response metadata.
            if (path.exists() or not active or active.get("validated") is not True
                    or active["start"] != state["committed_bytes"]
                    or tail > active["end"] - active["start"] + 1
                    or active["etag"] != selection["etag"]):
                raise ValueError("Reconcile the uncommitted tail against its original response")
            segment_hash = hashlib.sha256()
            with partial.open("rb") as source:
                source.seek(state["committed_bytes"])
                remaining = tail
                while remaining:
                    block = source.read(min(BLOCK_BYTES, remaining))
                    if not block:
                        raise ValueError("The retained response tail is incomplete")
                    prefix_hash.update(block)
                    segment_hash.update(block)
                    remaining -= len(block)
                os.fsync(source.fileno())
            active = {**active, "recovery": "INTERRUPTED_COMMIT_TAIL"}
            _commit_response(state_path, receipt_path, original, selection, state, active,
                             prefix_hash, segment_hash, tail, "Original response tail retained after interruption")
        elif active:
            _commit_response(state_path, receipt_path, original, selection, state, active,
                             prefix_hash, hashlib.sha256(), 0, "Original request interrupted before its body")

        emit("ORIGINAL_PREFIX_RECEIVED", state, etag=selection["etag"])
        while state["committed_bytes"] < total:
            start = state["committed_bytes"]
            end = min(total - 1, start + chunk_bytes - 1)
            active = {"request_number": len(state["requests"]) + 1, "url": url,
                      "start": start, "requested_end": end, "etag": selection["etag"],
                      "requested_at": now(), "validated": False}
            state["active"] = active
            atomic_json(state_path, state)
            emit("RANGE_REQUESTED", state, start=start, end=end)
            segment_hash, received = hashlib.sha256(), 0
            prior_hash = prefix_hash.copy()
            failure = None
            try:
                request = urllib.request.Request(url, headers={
                    "User-Agent": "TokenJunkieLabs-Upper-Savannah-Source/1.0",
                    "Accept-Encoding": "identity", "Range": "bytes=" + str(start) + "-" + str(end),
                    "If-Range": selection["etag"], "If-Match": selection["etag"]})
                with urllib.request.urlopen(request, timeout=60) as response:
                    observed = {k: response.headers[k] for k in HEADERS if k in response.headers}
                    lower = _headers(observed)
                    active.update(status=response.status, final_url=response.url, headers=observed)
                    match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", lower.get("content-range", ""))
                    if (response.status != 206 or lower.get("etag") != selection["etag"]
                            or lower.get("content-encoding", "identity").lower() != "identity" or not match):
                        raise ValueError("Keep the original partial: the source did not return its same validated byte range")
                    actual_start, actual_end, actual_total = map(int, match.groups())
                    expected = actual_end - actual_start + 1
                    if (actual_start != start or actual_total != total
                            or not start <= actual_end <= end or expected <= 0
                            or ("content-length" in lower and int(lower["content-length"]) != expected)):
                        raise ValueError("Keep the original partial: the returned Content-Range differs")
                    active.update(validated=True, end=actual_end, total=actual_total)
                    atomic_json(state_path, state)
                    with partial.open("r+b", buffering=0) as output:
                        if output.seek(0, os.SEEK_END) != start:
                            raise ValueError("The original partial changed before range append")
                        while received < expected:
                            block = response.read(min(BLOCK_BYTES, expected - received))
                            if not block:
                                raise EOFError("The observed HTTP range ended early")
                            offset = 0
                            while offset < len(block):
                                written = output.write(block[offset:])
                                if not written:
                                    raise OSError("The original source append wrote no bytes")
                                committed = block[offset:offset + written]
                                prefix_hash.update(committed)
                                segment_hash.update(committed)
                                received += written
                                offset += written
                        if response.read(1):
                            raise InvalidRangeBody("The observed HTTP range exceeded its declared end")
                        os.fsync(output.fileno())
            except BaseException as error:
                failure = error
                active["error"] = type(error).__name__ + ": " + str(error)
                if isinstance(error, urllib.error.HTTPError):
                    active.update(status=error.code, final_url=error.url,
                                  headers={k: error.headers[k] for k in HEADERS if k in error.headers})
                if isinstance(error, InvalidRangeBody):
                    # Save the exact rejected append boundary before removing
                    # this operation's invalid tail. A killed rollback resumes.
                    active.update(discard_all=True, discarded_bytes=received)
                    atomic_json(state_path, state)
                    with partial.open("r+b", buffering=0) as output:
                        output.truncate(start)
                        os.fsync(output.fileno())
                    prefix_hash, segment_hash, received = prior_hash, hashlib.sha256(), 0
                elif received:
                    with partial.open("rb") as output:
                        os.fsync(output.fileno())

            if partial.stat().st_size != start + received:
                # Keep the saved active response when a failed filesystem write
                # has an uncertain byte count; the original tail recovery owns it.
                raise OSError("Reconcile the observed source append before committing its byte count")

            # Bookkeeping and progress errors are deliberately outside the
            # network exception handler. A saved response is never appended a
            # second time because a later receipt or progress write failed.
            _commit_response(state_path, receipt_path, original, selection, state, active,
                             prefix_hash, segment_hash, received,
                             active["error"] if failure else None)
            if failure:
                emit("INTERRUPTED", state, error=active["error"])
                raise failure
            emit("RANGE_RECEIVED", state, start=start, end=start + received - 1)

        completed = _complete(path, receipt_path, original, selection, state)
        emit("COMPLETE", state, path=str(path), sha256=completed["sha256"])
        return completed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--maximum-bytes", required=True, type=int)
    parser.add_argument("--chunk-bytes", type=int, default=DEFAULT_CHUNK_BYTES)
    args = parser.parse_args(argv)
    resume(args.archive, maximum_bytes=args.maximum_bytes, chunk_bytes=args.chunk_bytes,
           progress=lambda value: print(json.dumps(value, sort_keys=True), flush=True))


if __name__ == "__main__":
    main()
