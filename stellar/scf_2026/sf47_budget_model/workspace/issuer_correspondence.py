"""Receive original issuer correspondence for the existing Grant Operations case.

The inspector is a projection. Its source is the unchanged RFC822 or text bytes.
It makes no award, track, invitation, amount, deadline, or sender-trust decision.
All filesystem outputs use generated paths, never sender-supplied paths.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import codecs
import hashlib
import json
import os
import quopri
import re
import shutil
import tempfile
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from zipfile import ZIP_DEFLATED, ZipFile

SCHEMA = "stellar-forge.issuer-correspondence.v1"
BUNDLE_SCHEMA = "stellar-forge.issuer-correspondence-bundle.v1"
NATIVE_MAX_SOURCE = 8 * 1024 * 1024
MIME_TOKEN = re.compile(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+\Z")
LINE = re.compile(rb"([^\r\n]*)(\r\n|\r|\n|$)")
HEADER = re.compile(rb"([!-9;-~]+):")
MESSAGE_HEADERS = frozenset((
    b"from", b"to", b"subject", b"date", b"message-id", b"mime-version",
    b"content-type", b"sender", b"reply-to", b"return-path", b"received",
))
TEXT_TYPES = frozenset(("text/plain", "text/html", "text/markdown"))
MESSAGE_TYPES = frozenset(("message/rfc822", "message/global"))
EXTENSIONS = {
    "message/rfc822": ".eml", "message/global": ".eml",
    "text/plain": ".txt", "text/html": ".html", "text/markdown": ".md",
    "text/csv": ".csv", "application/json": ".json", "application/pdf": ".pdf",
    "application/zip": ".zip",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
}


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode("utf-8")


def _warning(rows: list, path: str, code: str, message: str) -> dict:
    row = {"path": path, "code": code, "message": message}
    if row not in rows:
        rows.append(row)
    return row


def _lines(raw: bytes):
    for match in LINE.finditer(raw):
        if match.end() == match.start():
            break
        yield match.start(), match.end(), match.group(1), match.group(2)


def _body_start(raw: bytes) -> int:
    """Locate the first body byte without normalizing any line endings."""
    header_seen = False
    for start, end, line, _ending in _lines(raw):
        if start == 0 and line.startswith(b"From "):
            continue
        if not line:
            return end
        if line[:1] in (b" ", b"\t") and header_seen:
            continue
        if HEADER.match(line):
            header_seen = True
            continue
        # The stdlib parser treats an invalid header line as the start of body.
        return start
    return len(raw)


def _without_boundary_newline(raw: bytes, start: int, end: int) -> int:
    if end <= start:
        return end
    if raw[max(start, end - 2):end] == b"\r\n":
        return end - 2
    if raw[end - 1:end] in (b"\r", b"\n"):
        return end - 1
    return end


def _multipart_ranges(raw: bytes, body_start: int, boundary: str | None):
    if not boundary:
        return [], False
    try:
        marker = b"--" + boundary.encode("ascii", "surrogateescape")
    except (UnicodeError, AttributeError):
        return [], False
    spans, current, closed = [], None, False
    for start, end, line, _ending in _lines(raw):
        if start < body_start:
            continue
        stripped = line.rstrip(b" \t")
        if stripped not in (marker, marker + b"--"):
            continue
        if current is not None:
            spans.append((current, _without_boundary_newline(raw, current, start)))
        if stripped == marker + b"--":
            current, closed = None, True
            break
        current = end
    if current is not None:
        spans.append((current, len(raw)))
    return spans, closed


def _text(raw: bytes, charset: str | None) -> tuple[str, str, str | None]:
    declared = charset.strip() if isinstance(charset, str) and charset.strip() else None
    used = declared or ("ascii" if raw.isascii() else "utf-8")
    issue = None
    if declared is None and not raw.isascii():
        issue = "No charset was declared; the display projection uses UTF-8."
    try:
        codecs.lookup(used)
        value = raw.decode(used, errors="strict")
    except (LookupError, UnicodeError, TypeError) as exc:
        value = raw.decode("utf-8", errors="replace")
        used = "utf-8"
        issue = f"Text could not be decoded exactly with the declared charset: {type(exc).__name__}. The display uses UTF-8 replacement characters."
    return value, used, issue


def _headers(part, path: str, warnings: list) -> list[dict]:
    rows = []
    for name, raw_value in part.raw_items():
        # Preserve every original occurrence, including folded/duplicate values.
        try:
            value = str(policy.default.header_fetch_parse(name, raw_value))
        except Exception as exc:
            value = raw_value
            _warning(warnings, path, "HEADER_DISPLAY", f"{name}: {type(exc).__name__}; original header text is retained.")
        rows.append({"name": name, "rawValue": raw_value, "value": value})
    for name in set(row["name"].lower() for row in rows):
        try:
            values = part.get_all(name, [])
            for value in values:
                for defect in getattr(value, "defects", ()):
                    _warning(warnings, path, type(defect).__name__, str(defect) or "The header parser reported this defect.")
        except Exception as exc:
            _warning(warnings, path, "HEADER_PARSE", f"{name}: {type(exc).__name__}.")
    return rows


def _first(headers: list[dict], name: str) -> str:
    return next((row["value"] for row in headers if row["name"].lower() == name.lower()), "")


def _all(headers: list[dict], name: str) -> list[str]:
    return [row["value"] for row in headers if row["name"].lower() == name.lower()]


def _addresses(values: list[str], path: str, label: str, warnings: list) -> list[dict]:
    try:
        return [{"name": name, "address": address} for name, address in getaddresses(values)]
    except (ValueError, TypeError) as exc:
        _warning(warnings, path, "ADDRESS_DISPLAY", f"{label}: {type(exc).__name__}; the original field remains available.")
        return []


def _metadata(headers: list[dict], warnings: list) -> dict:
    date = _first(headers, "Date")
    date_utc = None
    if date:
        try:
            parsed = parsedate_to_datetime(date)
            if parsed is not None and parsed.tzinfo is not None:
                date_utc = parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            else:
                _warning(warnings, "1", "DATE_ZONE_UNSPECIFIED", "The Date header has no usable timezone; no UTC date was inferred.")
        except (ValueError, TypeError, OverflowError):
            _warning(warnings, "1", "DATE_DISPLAY", "The Date header could not be parsed; its complete original value is retained.")
    for name in ("Subject", "Message-ID", "Date", "From", "Sender"):
        if len(_all(headers, name)) > 1:
            _warning(warnings, "1", "DUPLICATE_HEADER", f"Multiple {name} headers are present; metadata displays the first and headers preserves them all.")
    return {
        "subject": _first(headers, "Subject"),
        "messageId": _first(headers, "Message-ID"),
        "date": date, "dateUtc": date_utc,
        "from": ", ".join(_all(headers, "From")),
        "to": ", ".join(_all(headers, "To")),
        "cc": ", ".join(_all(headers, "Cc")),
        "sender": ", ".join(_all(headers, "Sender")),
        "replyTo": ", ".join(_all(headers, "Reply-To")),
        "fromAddresses": _addresses(_all(headers, "From"), "1", "From", warnings),
        "toAddresses": _addresses(_all(headers, "To"), "1", "To", warnings),
        "ccAddresses": _addresses(_all(headers, "Cc"), "1", "Cc", warnings),
    }


def _detect_media(raw: bytes, filename: str, media_type: str | None) -> tuple[str, bool]:
    if media_type is not None and (not isinstance(media_type, str) or any(char in media_type for char in "\r\n\x00")):
        raise ValueError("Use a single MIME media type.")
    explicit = (media_type or "").split(";", 1)[0].strip().lower()
    if explicit and not MIME_TOKEN.fullmatch(explicit):
        raise ValueError("Use a MIME media type such as message/rfc822 or text/plain.")
    if explicit in MESSAGE_TYPES:
        return explicit, True
    if explicit in TEXT_TYPES:
        return explicit, False
    suffix = Path(filename.replace("\\", "/")).suffix.lower()
    if suffix in (".eml", ".mime", ".rfc822"):
        return "message/rfc822", True
    if explicit and explicit != "application/octet-stream":
        return explicit, False
    names = []
    for _start, _end, line, _ending in _lines(raw):
        if not line:
            break
        match = HEADER.match(line)
        if match:
            names.append(match.group(1).lower())
        elif line[:1] not in (b" ", b"\t") and not line.startswith(b"From "):
            break
    if len(set(names) & MESSAGE_HEADERS) >= 2:
        return "message/rfc822", True
    if suffix in (".html", ".htm"):
        return "text/html", False
    if suffix in (".md", ".markdown"):
        return "text/markdown", False
    for known_media, extension in EXTENSIONS.items():
        if suffix == extension and not known_media.startswith(("text/", "message/")):
            return known_media, False
    if explicit == "application/octet-stream":
        return explicit, False
    return "text/plain", False


def _decode_transfer(body: bytes | None, part, path: str, warnings: list):
    transfer = str(part.get("Content-Transfer-Encoding", "")).strip().lower()
    issue = None
    recovered = False
    if body is None:
        try:
            data = part.get_payload(decode=True)
        except Exception as exc:
            _warning(warnings, path, "PAYLOAD_DECODE", type(exc).__name__)
            return None, "The parser could not decode this MIME part.", False
        if not isinstance(data, bytes):
            return None, "The original wire range of this MIME container could not be isolated.", False
        issue = "An exact wire range could not be isolated; these bytes are the standard MIME parser's decoded payload."
        return data, issue, True
    if transfer in ("", "7bit", "8bit", "binary"):
        if transfer == "7bit" and not body.isascii():
            issue = "The part declares 7bit but includes non-ASCII bytes; the original body bytes are preserved."
        return body, issue, False
    if transfer == "quoted-printable":
        if re.search(rb"=(?![0-9A-Fa-f]{2}|\r\n|\n|\r)", body):
            issue = "Malformed quoted-printable escapes were preserved by the standard decoder."
            recovered = True
        return quopri.decodestring(body), issue, recovered
    if transfer == "base64":
        compact = re.sub(rb"[ \t\r\n]", b"", body)
        try:
            return base64.b64decode(compact, validate=True), None, False
        except (binascii.Error, ValueError):
            try:
                data = part.get_payload(decode=True)
            except Exception:
                data = None
            if not isinstance(data, bytes):
                return None, "The base64 payload could not be decoded; receive the complete original message.", False
            issue = "The standard MIME parser recovered an invalid base64 payload; review against the retained original before selecting the extracted file."
            return data, issue, True
    _warning(warnings, path, "TRANSFER_ENCODING", f"Unsupported Content-Transfer-Encoding {transfer!r}; the original message retains its wire bytes.")
    return None, f"Unsupported transfer encoding: {transfer}", False


def _part_descriptor(part, path: str, parent: str | None, wire: bytes | None,
                     absolute: int | None, warnings: list) -> dict:
    headers = _headers(part, path, warnings)
    try:
        filename = part.get_filename()
        charset = part.get_content_charset()
        disposition = part.get_content_disposition()
        media = part.get_content_type()
    except Exception as exc:
        _warning(warnings, path, "MIME_METADATA", f"{type(exc).__name__}; original headers are retained.")
        filename, charset, disposition, media = None, None, None, "application/octet-stream"
    return {
        "path": path, "parentPath": parent, "mediaType": media,
        "filename": filename, "charset": charset, "disposition": disposition,
        "transferEncoding": _first(headers, "Content-Transfer-Encoding"),
        "contentId": _first(headers, "Content-ID"),
        "headers": headers, "children": [],
        "wire": None if wire is None else {
            "offset": absolute, "bytes": len(wire), "sha256": _sha(wire),
            "bodyOffset": _body_start(wire),
        },
    }


def _attachment(node: dict, data: bytes | None, issue: str | None,
                recovered: bool, representation: str = "decoded-body") -> dict:
    media = node["mediaType"]
    filename = node["filename"] or f"part-{node['path'].replace('.', '-')}{EXTENSIONS.get(media, '.bin')}"
    return {
        "path": node["path"], "filename": filename, "originalFilename": node["filename"],
        "mediaType": media, "disposition": node["disposition"],
        "contentId": node["contentId"], "representation": representation,
        "bytes": None if data is None else len(data),
        "sha256": None if data is None else _sha(data),
        "contentBase64": None if data is None else _b64(data),
        "decodeIssue": issue, "decodedWithRecovery": recovered,
        "wire": node["wire"],
    }


def inspect_correspondence(raw: bytes, filename: str, media_type: str | None = None) -> dict:
    """Project complete original bytes into reviewable MIME/text and file choices."""
    if not isinstance(raw, (bytes, bytearray, memoryview)):
        raise TypeError("Receive the original correspondence as bytes.")
    raw = bytes(raw)
    if not isinstance(filename, str) or not filename.strip():
        raise ValueError("Keep a filename for the original correspondence.")
    media, is_message = _detect_media(raw, filename, media_type)
    warnings: list[dict] = []
    result = {
        "schema": SCHEMA,
        "original": {"filename": filename, "mediaType": media, "declaredMediaType": media_type, "bytes": len(raw), "sha256": _sha(raw)},
        "metadata": {}, "headers": [], "parts": [], "textParts": [], "attachments": [],
        "warnings": warnings,
    }
    if not raw:
        _warning(warnings, "1", "EMPTY_SOURCE", "The original source contains no bytes.")
    if not is_message:
        declared_charset = None
        if media_type and ";" in media_type:
            try:
                external_headers = BytesParser(policy=policy.default).parsebytes(("Content-Type: " + media_type + "\r\n\r\n").encode("ascii"))
                declared_charset = external_headers.get_content_charset()
            except (UnicodeError, ValueError):
                _warning(warnings, "1", "EXTERNAL_CHARSET", "The supplied charset could not be interpreted; the original bytes are retained.")
        result["metadata"] = _metadata([], warnings)
        node = {
            "path": "1", "parentPath": None, "mediaType": media, "filename": filename,
            "charset": declared_charset, "disposition": None, "transferEncoding": "",
            "contentId": "", "headers": [], "children": [],
            "wire": {"offset": 0, "bytes": len(raw), "sha256": _sha(raw), "bodyOffset": 0},
        }
        result["parts"].append(node)
        if media.startswith("text/"):
            text_value, decoding, issue = _text(raw, declared_charset)
            result["textParts"].append({
                "path": "1", "mediaType": media, "charset": declared_charset, "decodingUsed": decoding,
                "text": text_value, "decodeIssue": issue, "bytes": len(raw),
                "sha256": _sha(raw), "contentBase64": _b64(raw), "isAttachment": False,
            })
            if issue:
                _warning(warnings, "1", "TEXT_DECODE", issue)
        return result
    try:
        message = BytesParser(policy=policy.default).parsebytes(raw)
    except Exception as exc:
        result["metadata"] = _metadata([], warnings)
        _warning(warnings, "1", "MESSAGE_PARSE", f"{type(exc).__name__}: the complete original remains available for receiving.")
        return result
    result["headers"] = _headers(message, "1", warnings)
    result["metadata"] = _metadata(result["headers"], warnings)
    stack = [(message, raw, "1", None, 0, False)]
    while stack:
        part, wire, path, parent, absolute, attached_parent = stack.pop()
        node = _part_descriptor(part, path, parent, wire, absolute, warnings)
        result["parts"].append(node)
        media = node["mediaType"]
        attached = attached_parent or node["disposition"] == "attachment" or bool(node["filename"])
        body_start = _body_start(wire) if wire is not None else None
        body = wire[body_start:] if wire is not None else None
        parsed_children = part.get_payload() if part.is_multipart() else []
        parsed_children = parsed_children if isinstance(parsed_children, list) else []
        if media.startswith("multipart/") and parsed_children:
            spans, closed = _multipart_ranges(wire, body_start, part.get_boundary()) if wire is not None else ([], False)
            if len(spans) != len(parsed_children):
                _warning(warnings, path, "WIRE_PART_ALIGNMENT", "MIME parser children and original boundary ranges differ; the full original preserves all bytes.")
            if not closed:
                _warning(warnings, path, "MIME_CLOSING_BOUNDARY", "No complete closing boundary was located in this original MIME container.")
            if attached and not attached_parent:
                item = _attachment(node, wire, None if wire is not None else "The exact MIME entity is unavailable.", False, "original-mime-entity")
                item["mediaType"] = "message/rfc822"
                if not node["filename"]:
                    item["filename"] = "part-" + path.replace(".", "-") + ".eml"
                result["attachments"].append(item)
            for index in range(len(parsed_children) - 1, -1, -1):
                child_path = path + "." + str(index + 1)
                child_wire, child_absolute = None, None
                if len(spans) == len(parsed_children):
                    start, end = spans[index]
                    child_wire = wire[start:end]
                    child_absolute = absolute + start if absolute is not None else None
                node["children"].insert(0, child_path)
                stack.append((parsed_children[index], child_wire, child_path, path, child_absolute, attached))
        elif media in MESSAGE_TYPES:
            data, issue, recovered = _decode_transfer(body, part, path, warnings)
            result["attachments"].append(_attachment(node, data, issue, recovered, "original-encapsulated-message"))
            if data is not None:
                try:
                    child = BytesParser(policy=policy.default).parsebytes(data)
                    child_path = path + ".1"
                    node["children"].append(child_path)
                    direct = node["transferEncoding"].strip().lower() in ("", "7bit", "8bit", "binary")
                    offset = absolute + body_start if direct and absolute is not None else None
                    stack.append((child, data, child_path, path, offset, True))
                except Exception as exc:
                    _warning(warnings, path, "ENCAPSULATED_MESSAGE", f"{type(exc).__name__}; its original decoded bytes are retained.")
            if issue:
                _warning(warnings, path, "PAYLOAD_DECODE", issue)
        else:
            data, issue, recovered = _decode_transfer(body, part, path, warnings)
            is_attachment = attached or not media.startswith("text/")
            if is_attachment:
                result["attachments"].append(_attachment(node, data, issue, recovered))
            if media.startswith("text/") and data is not None:
                text_value, decoding, text_issue = _text(data, node["charset"])
                combined = "; ".join(value for value in (issue, text_issue) if value) or None
                result["textParts"].append({
                    "path": path, "mediaType": media, "charset": node["charset"],
                    "decodingUsed": decoding, "text": text_value, "decodeIssue": combined,
                    "bytes": len(data), "sha256": _sha(data), "contentBase64": _b64(data),
                    "isAttachment": bool(is_attachment), "decodedWithRecovery": recovered,
                })
                if text_issue:
                    _warning(warnings, path, "TEXT_DECODE", text_issue)
            if issue:
                _warning(warnings, path, "PAYLOAD_DECODE", issue)
            # message/delivery-status and unusual message/* containers may have
            # parser children without delimiters. Retain their identities, too.
            for index in range(len(parsed_children) - 1, -1, -1):
                child_path = path + "." + str(index + 1)
                node["children"].insert(0, child_path)
                stack.append((parsed_children[index], None, child_path, path, None, True))
        for defect in getattr(part, "defects", ()):
            _warning(warnings, path, type(defect).__name__, str(defect) or "The MIME parser reported this defect.")
    return result


def _native_filename(filename: str, media: str, path: str, sha: str) -> str:
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join("_" if ord(char) < 32 or ord(char) == 127 else char for char in name).strip(" .")
    if not name or name in (".", ".."):
        name = "correspondence" + EXTENSIONS.get(media, ".bin")
    # Identity is the original content plus MIME path, including duplicate names.
    if len(name) > 210:
        extension = Path(name).suffix[:16]
        name = name[:190] + extension
    return name


def _observed(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError("Use an explicit ISO timestamp for observation.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Use an explicit ISO timestamp for observation.") from exc
    if parsed.tzinfo is None:
        raise ValueError("Observation needs an explicit timezone.")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def source_candidates(raw: bytes, inspection: dict, *, observed_at: str | None = None,
                      source_url: str = "") -> list[dict]:
    """Return native source.add data for the original and decoded attachments.

    Each candidate has a selection path. Inspecting creates no source or grant
    record; the operator chooses candidates and the host saves original bytes.
    """
    if inspection.get("schema") != SCHEMA:
        raise ValueError("Use a current correspondence inspection.")
    raw = bytes(raw)
    original = inspection["original"]
    if len(raw) != original["bytes"] or _sha(raw) != original["sha256"]:
        raise ValueError("The original bytes changed after correspondence inspection.")
    if source_url:
        parsed = urlsplit(source_url)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError("Use the original HTTPS source URL without embedded credentials.")
    stamp = _observed(observed_at)
    entries = [{
        "path": "original", "filename": original["filename"], "mediaType": original["mediaType"],
        "bytes": len(raw), "sha256": _sha(raw), "contentBase64": _b64(raw),
        "decodeIssue": None, "representation": "original-file",
    }, *inspection.get("attachments", [])]
    result = []
    for entry in entries:
        encoded = entry.get("contentBase64")
        if encoded is None:
            result.append({"path": entry["path"], "available": False, "issue": entry.get("decodeIssue"),
                           "filename": entry["filename"], "mediaType": entry["mediaType"]})
            continue
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ValueError("A selected inspection contains invalid attachment encoding.") from exc
        if len(content) != entry["bytes"] or _sha(content) != entry["sha256"]:
            raise ValueError("A decoded attachment changed after correspondence inspection.")
        media = entry["mediaType"]
        if not MIME_TOKEN.fullmatch(media):
            media = "application/octet-stream"
        data = {
            "filename": _native_filename(entry["filename"], media, entry["path"], entry["sha256"]),
            "mediaType": media, "kind": "grant", "sourceUrl": source_url,
            "contentBase64": encoded,
        }
        if stamp is not None:
            data["observedAt"] = stamp
        fits = 0 < len(content) <= NATIVE_MAX_SOURCE
        key = hashlib.sha256((original["sha256"] + "\n" + entry["path"] + "\n" + entry["sha256"]).encode("utf-8")).hexdigest()
        result.append({
            "path": entry["path"], "key": key, "available": fits,
            "filename": entry["filename"], "nativeFilename": data["filename"], "mediaType": media,
            "bytes": len(content), "sha256": entry["sha256"],
            "representation": entry.get("representation", "decoded-body"),
            "decodeIssue": entry.get("decodeIssue"),
            "issue": None if fits else "The existing Grant Operations source limit is a nonempty file up to 8 MiB.",
            "data": data,
        })
    return result


def prepare_source_commands(raw: bytes, inspection: dict, selected_paths: list[str], *,
                            expected_version: int, actor: str, request_prefix: str,
                            observed_at: str | None = None, source_url: str = "") -> dict:
    """Prepare an exact, replayable sequence; the caller performs host writes."""
    if not isinstance(selected_paths, list) or any(not isinstance(path, str) for path in selected_paths):
        raise ValueError("Select MIME paths explicitly.")
    if len(set(selected_paths)) != len(selected_paths):
        raise ValueError("Select each original source once.")
    if not selected_paths:
        raise ValueError("Select at least one original correspondence file.")
    if not isinstance(expected_version, int) or isinstance(expected_version, bool) or expected_version < 1:
        raise ValueError("Use the reviewed original operations version.")
    if not isinstance(actor, str) or not actor.strip():
        raise ValueError("Name the recording operator.")
    if not isinstance(request_prefix, str) or not re.fullmatch(r"[a-z][a-z0-9-]{1,50}", request_prefix):
        raise ValueError("Use a retained lowercase request prefix, at most 51 characters.")
    candidates = {row["path"]: row for row in source_candidates(
        raw, inspection, observed_at=observed_at, source_url=source_url)}
    chosen = []
    for path in selected_paths:
        row = candidates.get(path)
        if row is None:
            raise ValueError(f"Unknown correspondence source path: {path}")
        if not row["available"]:
            raise ValueError(f"{path}: {row.get('issue') or 'This part cannot be received as a separate original file.'}")
        chosen.append(row)
    commands = []
    for index, row in enumerate(chosen):
        commands.append({
            "path": row["path"], "sourceKey": row["key"], "sha256": row["sha256"], "bytes": row["bytes"],
            "body": {
                "requestId": request_prefix + "-" + row["key"][:32],
                "expectedVersion": expected_version + index, "actor": actor.strip(),
                "note": f"Received issuer correspondence {inspection['original']['sha256']} part {row['path']}.",
                "action": "source.add", "data": row["data"],
            },
        })
    return {
        "schema": "stellar-forge.issuer-correspondence-commands.v1",
        "originalSha256": inspection["original"]["sha256"], "expectedVersion": expected_version,
        "selectedPaths": selected_paths, "commands": commands,
    }


def _write(path: Path, raw: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as handle:
        handle.write(raw)


def write_correspondence_bundle(raw: bytes, filename: str, directory: str | Path, *,
                                media_type: str | None = None, observed_at: str | None = None,
                                source_url: str = "") -> dict:
    """Save an original, inspection, all MIME attachment bytes, and source choices.

    The complete directory appears atomically. Repeating the same original,
    filename, metadata and inspection reopens the existing bundle after checking
    every manifested file. A differing bundle never overwrites previous work.
    """
    raw = bytes(raw)
    inspection = inspect_correspondence(raw, filename, media_type)
    candidates = source_candidates(raw, inspection, observed_at=observed_at, source_url=source_url)
    destination = Path(directory).absolute()
    parent = destination.parent
    parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        return verify_correspondence_bundle(destination, raw=raw, filename=filename,
                                            expected_inspection=inspection, expected_candidates=candidates)
    staging = Path(tempfile.mkdtemp(prefix="." + destination.name + "-", dir=parent))
    os.chmod(staging, 0o700)
    files = []
    def add(relative: str, content: bytes, kind: str, mime_path: str | None = None):
        _write(staging / relative, content)
        row = {"path": relative, "bytes": len(content), "sha256": _sha(content), "kind": kind}
        if mime_path:
            row["mimePath"] = mime_path
        files.append(row)
    try:
        suffix = ".eml" if inspection["original"]["mediaType"] in MESSAGE_TYPES else EXTENSIONS.get(inspection["original"]["mediaType"], ".bin")
        add("original/message" + suffix, raw, "original", "original")
        add("inspection.json", _json(inspection), "inspection")
        add("source-candidates.json", _json(candidates), "native-source-choices")
        for row in inspection["attachments"]:
            if row["contentBase64"] is None:
                continue
            content = base64.b64decode(row["contentBase64"], validate=True)
            extension = EXTENSIONS.get(row["mediaType"], ".bin")
            relative = "attachments/part-" + row["path"].replace(".", "-") + extension
            add(relative, content, "attachment", row["path"])
        for row in inspection["textParts"]:
            content = base64.b64decode(row["contentBase64"], validate=True)
            relative = "text/part-" + row["path"].replace(".", "-") + EXTENSIONS.get(row["mediaType"], ".txt")
            add(relative, content, "decoded-text", row["path"])
        manifest = {
            "schema": BUNDLE_SCHEMA, "original": inspection["original"],
            "sourceUrl": source_url, "observedAt": _observed(observed_at), "files": files,
        }
        _write(staging / "manifest.json", _json(manifest))
        # A concurrent destination prevents replacement rather than losing data.
        os.rename(staging, destination)
        return verify_correspondence_bundle(destination, raw=raw, filename=filename,
                                            expected_inspection=inspection, expected_candidates=candidates)
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise


def verify_correspondence_bundle(directory: str | Path, *, raw: bytes | None = None,
                                 filename: str | None = None, expected_inspection: dict | None = None,
                                 expected_candidates: list | None = None) -> dict:
    root = Path(directory).absolute()
    if root.is_symlink():
        raise ValueError("Use the original correspondence bundle directory.")
    manifest = json.loads((root / "manifest.json").read_bytes())
    if manifest.get("schema") != BUNDLE_SCHEMA:
        raise ValueError("Use a current correspondence bundle.")
    seen = set()
    for row in manifest["files"]:
        relative = row["path"]
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts or relative in seen:
            raise ValueError("Invalid or repeated bundle path.")
        seen.add(relative)
        target = root / path
        if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(root.resolve()):
            raise ValueError(f"The bundle file is unavailable: {relative}")
        content = target.read_bytes()
        if len(content) != row["bytes"] or _sha(content) != row["sha256"]:
            raise ValueError(f"The retained bundle file changed: {relative}")
    actual = {path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()}
    if actual != seen | {"manifest.json"}:
        raise ValueError("The correspondence bundle contains unlisted or missing files.")
    original = manifest["original"]
    if raw is not None and (len(raw) != original["bytes"] or _sha(raw) != original["sha256"]):
        raise ValueError("An existing bundle belongs to a different original message.")
    if filename is not None and original["filename"] != filename:
        raise ValueError("An existing bundle has a different original filename.")
    if expected_inspection is not None and (root / "inspection.json").read_bytes() != _json(expected_inspection):
        raise ValueError("An existing bundle has a different correspondence inspection.")
    if expected_candidates is not None and (root / "source-candidates.json").read_bytes() != _json(expected_candidates):
        raise ValueError("An existing bundle has different native source choices or observation metadata.")
    return {"schema": BUNDLE_SCHEMA, "directory": str(root), "original": original,
            "files": manifest["files"], "manifestSha256": _sha((root / "manifest.json").read_bytes())}


def zip_correspondence_bundle(directory: str | Path, output: str | Path) -> dict:
    report = verify_correspondence_bundle(directory)
    root, target = Path(directory).absolute(), Path(output).absolute()
    if target.is_relative_to(root):
        raise ValueError("Save the ZIP outside the immutable correspondence directory.")
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        expected = {path.relative_to(root).as_posix(): path for path in root.rglob("*") if path.is_file()}
        with ZipFile(target) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)) or set(names) != set(expected):
                raise ValueError("The existing handover ZIP has different members.")
            for name, path in expected.items():
                if archive.read(name) != path.read_bytes():
                    raise ValueError("The existing handover ZIP differs from the original bundle.")
    else:
        with target.open("xb") as handle:
            with ZipFile(handle, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
                for path in sorted(root.rglob("*")):
                    if path.is_file():
                        archive.write(path, path.relative_to(root).as_posix())
    content = target.read_bytes()
    return {"path": str(target), "bytes": len(content), "sha256": _sha(content),
            "originalSha256": report["original"]["sha256"], "files": len(report["files"]) + 1}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Receive original issuer correspondence for Grant Operations.")
    parser.add_argument("action", choices=("inspect", "bundle", "verify"))
    parser.add_argument("input", help="Original RFC822/text file, or bundle directory for verify.")
    parser.add_argument("--media-type")
    parser.add_argument("--filename", help="Preserve the provider's original filename.")
    parser.add_argument("--directory", help="New immutable receiving directory for bundle.")
    parser.add_argument("--source-url", default="")
    parser.add_argument("--observed-at")
    parser.add_argument("--zip", dest="zip_path", help="Optional new ZIP outside the receiving directory.")
    args = parser.parse_args(argv)
    if args.action == "verify":
        result = verify_correspondence_bundle(args.input)
    else:
        path = Path(args.input)
        raw = path.read_bytes()
        filename = args.filename or path.name
        if args.action == "inspect":
            result = inspect_correspondence(raw, filename, args.media_type)
        else:
            if not args.directory:
                parser.error("bundle needs --directory")
            result = write_correspondence_bundle(
                raw, filename, args.directory, media_type=args.media_type,
                observed_at=args.observed_at, source_url=args.source_url)
            if args.zip_path:
                result["zip"] = zip_correspondence_bundle(args.directory, args.zip_path)
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
