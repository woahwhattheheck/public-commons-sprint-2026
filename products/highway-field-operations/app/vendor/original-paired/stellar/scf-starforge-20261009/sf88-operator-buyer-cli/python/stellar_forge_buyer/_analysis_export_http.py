"""HTTP delivery of an already verified, immutable query-export descriptor.

The owning handler performs origin/capability checks before opening the original
QueryExport stream. This helper retains that same descriptor for full or resumed
delivery. Range/If-Range follow RFC 9110 sections 13.1.5 and 14:
https://www.rfc-editor.org/rfc/rfc9110.html
"""
from __future__ import annotations

import re

_BYTE_RANGE = re.compile(r"bytes=([0-9]*)-([0-9]*)", re.IGNORECASE)
_TAG_LIST = re.compile(r'(?:W/)?"[\x21\x23-\x7e\x80-\xff]*"')
_UNSATISFIABLE = object()
_CHUNK = 1024 * 1024


def _tag_matches(raw, etag, *, weak=False):
    if raw.strip() == "*":
        return True
    # Quoted entity tags may contain commas. Parse tags before their separators.
    tags, position = [], 0
    for match in _TAG_LIST.finditer(raw):
        separator = raw[position:match.start()]
        if separator.strip() not in ({""} if not tags else {","}):
            return False
        tags.append(match.group())
        position = match.end()
    if raw[position:].strip():
        return False
    return any((tag.removeprefix("W/") if weak else tag) == etag for tag in tags)


def _byte_range(value, total):
    # Unsupported/multiple/malformed ranges receive the ordinary full response.
    # The header bound also avoids expensive conversion of arbitrary integers.
    if not isinstance(value, str) or len(value) > 256:
        return None
    match = _BYTE_RANGE.fullmatch(value.strip())
    if not match or not any(match.groups()):
        return None
    first, last = match.groups()
    if first:
        start = int(first)
        end = int(last) if last else total - 1
        if last and end < start:
            return None
        if start >= total:
            return _UNSATISFIABLE
        return start, min(end, total - 1)
    suffix = int(last)
    if suffix == 0 or total == 0:
        return _UNSATISFIABLE
    return max(0, total - suffix), total - 1


def send_export(handler, stream, record):
    """Send verified output bytes; a disconnect leaves the export reopenable.

    record contains name, bytes, mime and the entire file's sha256. ETag and
    X-Content-SHA256 always identify the complete file, including on a206 reply.
    The caller owns the stream context and closes it after this method returns.
    """
    total, etag = record["bytes"], '"sha256-' + record["sha256"] + '"'
    status, start, length, content_range = 200, 0, total, None
    if_match = handler.headers.get_all("If-Match")
    if_none = handler.headers.get_all("If-None-Match")
    if if_match and not _tag_matches(",".join(if_match), etag):
        status, length = 412, 0
    elif if_none and _tag_matches(",".join(if_none), etag, weak=True):
        status, length = 304, 0
    elif handler.command == "GET":
        ranges = handler.headers.get_all("Range")
        validators = handler.headers.get_all("If-Range")
        # An exact strong ETag is the available validator for this immutable
        # representation. Weak tags and dates cannot establish that identity.
        matches = not validators or len(validators) == 1 and validators[0].strip() == etag
        selected = _byte_range(ranges[0], total) if ranges and len(ranges) == 1 and matches else None
        if selected is _UNSATISFIABLE:
            status, length, content_range = 416, 0, f"bytes */{total}"
        elif selected is not None:
            start, end = selected
            status, length, content_range = 206, end - start + 1, f"bytes {start}-{end}/{total}"
    if status in {200, 206}:
        stream.seek(start)
    handler.send_response(status)
    handler.send_header("ETag", etag)
    handler.send_header("Accept-Ranges", "bytes")
    handler.send_header("X-Content-SHA256", record["sha256"])
    if status != 304:
        handler.send_header("Content-Type", record["mime"])
        handler.send_header("Content-Length", str(length))
    if content_range:
        handler.send_header("Content-Range", content_range)
    handler._headers(record["name"])
    try:
        handler.end_headers()
        if handler.command == "HEAD" or status not in {200, 206}:
            return
        remaining = length
        while remaining:
            block = stream.read(min(_CHUNK, remaining))
            if not block:
                # Headers already describe the verified length. End this
                # transfer cleanly rather than append a second JSON response.
                handler.close_connection = True
                return
            handler.wfile.write(block)
            remaining -= len(block)
    except OSError:
        handler.close_connection = True
