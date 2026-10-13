#!/usr/bin/env python3
"""Assemble published Upper Savannah source layers into one portable application.

Run directly or as python -m source_tools.application_assembly. Uses only the
Python standard library; source inputs are never imported or executed.
"""
from __future__ import annotations

import argparse
import ast
import base64
import ctypes
import errno
import fcntl
from dataclasses import dataclass
import gzip
import hashlib
import io
import json
import os
import posixpath
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import zipfile

MAX_BYTES = 256 * 1024 * 1024
MAX_FILES = 10000
INLINE_ASSET_BYTES = 8 * 1024 * 1024
PART_SCHEMA = "upstate.application-source-part/v1"
ADDON_PART_SCHEMA = "upstate.conservation-addon-part/v1"
CONSERVATION_PART_SCHEMAS = {ADDON_PART_SCHEMA, "upstate.conservation-source-part/v1"}
MAP_SCHEMA = "commons.source-map/1"
MAP_KIND = "upstate.complete-application-source/v1"
BANK_SCHEMAS = {
    MAP_SCHEMA,
    "commons.source-bank/v1",
    "commons.source-bundle/v1",
    "upstate.regional-map-customer-source/v1",
    "upstate.operator-source/v1",
    "upstate.source-files/v1",
    "upstate.conservation-addon/v1",
    "upstate.conservation-source/v1",
    "upstate.print-native-original-source/v1",
    "upstate.source-map/v1",
}
RECEIPT_NAME = "APPLICATION_SOURCE_RECEIPT.json"
SELF_NAME = "source_tools/application_assembly.py"
FENCE = chr(96) * 3


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def document_schema(value):
    return value.get("schema", value.get("format")) if isinstance(value, dict) else None


def is_source_document(value):
    """Recognize a declared source inventory; every body is validated on intake."""
    return (isinstance(value, dict)
            and isinstance(document_schema(value), str)
            and bool(document_schema(value).strip())
            and isinstance(value.get("files"), (dict, list)))


def source_member_name(name, prefix=None):
    """Normalize only the source document's explicit application prefix."""
    member_name(name)
    if prefix is not None:
        if not isinstance(prefix, str) or not prefix.rstrip("/"):
            raise ValueError("Invalid declared application prefix")
        prefix = prefix.rstrip("/")
        member_name(prefix)
        if name.startswith(prefix + "/"):
            name = name[len(prefix) + 1:]
    member_name(name)
    return name


def represented_body(content, metadata):
    """Recover exact original bytes from a canonical source-map member."""
    if not isinstance(content, str):
        raise ValueError("Source-map member must be encoded as text")
    encoding = metadata.get("encoding", "utf-8")
    if encoding == "base64":
        return decode_base64(content)
    if encoding not in ("utf-8", "utf8"):
        raise ValueError("Unsupported canonical member encoding")
    return content.encode("utf-8")


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key: " + key)
        result[key] = value
    return result


def transport_json(text):
    # Canvas changes indentation to NBSP. Normalize only outside JSON strings.
    # A source string, including its Unicode whitespace, remains byte exact.
    normalized, quoted, escaped = [], False, False
    for char in text.lstrip("\ufeff"):
        if quoted:
            normalized.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        else:
            normalized.append(" " if char in "\u00a0\u2007\u202f" else char)
            if char == '"':
                quoted = True
    return json.loads("".join(normalized), object_pairs_hook=unique_pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(
                          ValueError("Nonfinite JSON number: " + value)))


def member_name(name):
    if not isinstance(name, str) or not name or "\\" in name:
        raise ValueError("Source member must be a relative POSIX path")
    if any(ord(char) < 32 for char in name):
        raise ValueError("Source member contains a control character")
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or str(path) != name or any(
            part in (".", "..") or ":" in part for part in path.parts):
        raise ValueError("Invalid source member path: " + name)
    if name == RECEIPT_NAME:
        raise ValueError("Source carrier uses the reserved receiving marker")
    return path


def check_layout(names):
    names = set(names)
    folded = {}
    for name in sorted(names):
        path = member_name(name)
        alias = name.casefold()
        if alias in folded and folded[alias] != name:
            raise ValueError("Source paths collide on a portable filesystem: " + name)
        folded[alias] = name
        for parent in path.parents:
            if str(parent) != "." and str(parent) in names:
                raise ValueError("A source file is also a parent directory: " + str(parent))


def checked_bytes(value, label, limit=MAX_BYTES):
    if type(value) is not int or value < 0 or value > limit:
        raise ValueError("Invalid declared byte length for " + label)
    return value


def check_identity(data, size, expected, label):
    checked_bytes(size, label)
    if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise ValueError("Invalid SHA256 for " + label)
    if len(data) != size or sha256(data) != expected:
        raise ValueError("Source identity differs: " + label)


def uncompress(data):
    if len(data) > MAX_BYTES:
        raise ValueError("Carrier exceeds the source receiving limit")
    if data[:2] != b"\x1f\x8b":
        return data
    with gzip.GzipFile(fileobj=io.BytesIO(data), mode="rb") as stream:
        decoded = stream.read(MAX_BYTES + 1)
    if len(decoded) > MAX_BYTES:
        raise ValueError("Decoded carrier exceeds the source receiving limit")
    return decoded


def decode_base64(value):
    if not isinstance(value, str):
        raise ValueError("Expected base64 source text")
    encoded = re.sub(r"[ \t\r\n]", "", value)
    if len(encoded) > (MAX_BYTES * 4 // 3) + 4:
        raise ValueError("Base64 carrier exceeds the source receiving limit")
    try:
        return base64.b64decode(encoded, validate=True)
    except (ValueError, UnicodeError) as error:
        raise ValueError("Invalid base64 source body") from error


def decode_parts(parts):
    first = parts[0]
    count = first.get("parts")
    if type(count) is not int or not 0 < count <= MAX_FILES:
        raise ValueError("Invalid source part count")
    if any(type(part.get("part")) is not int for part in parts):
        raise ValueError("Invalid source part number")
    parts = sorted(parts, key=lambda item: item["part"])
    if len(parts) != count or [part["part"] for part in parts] != list(range(1, count + 1)):
        raise ValueError("Missing or duplicate source part")
    fields = ("schema", "edition", "parts", "encoding", "payload_sha256",
              "payload_bytes", "compressed_sha256", "compressed_bytes")
    if any(any(part.get(key) != first.get(key) for key in fields) for part in parts):
        raise ValueError("Source parts belong to different carriers")
    if first.get("encoding") != "gzip+base64":
        raise ValueError("Unsupported source-part encoding")
    compressed = decode_base64("".join(part["data"] for part in parts))
    check_identity(compressed, first["compressed_bytes"],
                   first["compressed_sha256"], "compressed parts")
    decoded = uncompress(compressed)
    check_identity(decoded, first["payload_bytes"], first["payload_sha256"], "decoded parts")
    return decoded


def decode_addon_parts(parts):
    """Decode the complete E7A1 plain-base64 transport with its declared identity."""
    first = parts[0]
    count = first.get("parts")
    if type(count) is not int or not 0 < count <= MAX_FILES:
        raise ValueError("Invalid conservation source part count")
    if any(type(part.get("part")) is not int for part in parts):
        raise ValueError("Invalid conservation source part number")
    parts = sorted(parts, key=lambda part: part["part"])
    if len(parts) != count or [part["part"] for part in parts] != list(range(1, count + 1)):
        raise ValueError("Missing or duplicate conservation source part")
    fields = set(first) - {"part", "data"}
    if any(set(part) - {"part", "data"} != fields or
           any(part.get(key) != first.get(key) for key in fields) for part in parts):
        raise ValueError("Conservation source parts have different metadata")
    if first.get("schema") not in CONSERVATION_PART_SCHEMAS:
        raise ValueError("Unsupported conservation source-part schema")
    checked_bytes(first.get("payload_bytes"), "conservation source payload")
    decoded = decode_base64("".join(part["data"] for part in parts))
    check_identity(decoded, first.get("payload_bytes"), first.get("payload_sha256"),
                   "conservation source payload")
    return decoded


def decode_plain_parts(parts, carrier_text):
    first = parts[0]
    total = first.get("total")
    if type(total) is not int or not 0 < total <= MAX_FILES:
        raise ValueError("Invalid source packet part count")
    if any(type(part.get("part")) is not int for part in parts):
        raise ValueError("Invalid source packet part number")
    parts = sorted(parts, key=lambda part: part["part"])
    if len(parts) != total or [part["part"] for part in parts] != list(range(1, total + 1)):
        raise ValueError("Missing or duplicate source packet part")
    fields = set(first) - {"part", "data"}
    if any(set(part) - {"part", "data"} != fields or
           any(part.get(key) != first.get(key) for key in fields) for part in parts):
        raise ValueError("Source packet parts have different metadata")
    decoded = uncompress(decode_base64("".join(part["data"] for part in parts)))
    declared = re.search(r"Packet:\s*([\d,]+)\s*bytes;\s*SHA256\s*"
                         + chr(96) + r"?([0-9a-f]{64})", carrier_text)
    if declared:
        check_identity(decoded, int(declared[1].replace(",", "")), declared[2], "source packet")
    return decoded


def join_source_banks(documents):
    """Join lossless per-file source banks from one declared component carrier."""
    parsed = [transport_json(body.decode("utf-8")) for body in documents]
    if any(item.get("schema") != "commons.source-bank/v1" for item in parsed):
        raise ValueError("Multiple source documents must be one declared source-bank cohort")
    fields = ("operation_id", "source_root", "edition", "source_ref", "merge_ref", "repository")
    if any(any(item.get(key) != parsed[0].get(key) for key in fields) for item in parsed):
        raise ValueError("Source-bank blocks select different component identities")
    joined, originals = {}, {}
    for item in parsed:
        layer = layer_from_document(item)
        for name, content in layer.files.items():
            entry = {**layer.metadata[name], "path": name, "content": content}
            if name in joined and any(joined[name].get(key) != entry.get(key)
                                      for key in ("bytes", "sha256", "mode")):
                raise ValueError("Source-bank blocks contain different bodies: " + name)
            joined[name] = entry
        for original in item.get("external_sources", []):
            name = original["path"]
            if name in originals and any(originals[name].get(key) != original.get(key)
                                          for key in ("bytes", "sha256")):
                raise ValueError("Source-bank blocks select different original data: " + name)
            originals[name] = original
    value = {"schema": "commons.source-bank/v1",
             **{key: parsed[0][key] for key in fields if key in parsed[0]},
             "files": [joined[name] for name in sorted(joined)],
             "external_sources": [originals[name] for name in sorted(originals)],
             "source_bank_blocks": [{"bytes": len(body), "sha256": sha256(body)}
                                    for body in documents]}
    return canonical(value)


def provider_payload(value, depth=0):
    """Recover documented MCP content fields while retaining transport errors."""
    if depth > 12:
        raise ValueError("Source provider result has excessive nesting")
    if isinstance(value, str):
        stripped = value.lstrip("\ufeff \t\r\n\u00a0\u2007\u202f")
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                parsed = transport_json(stripped)
            except json.JSONDecodeError:
                parsed = None
            if parsed is not None:
                recovered = provider_payload(parsed, depth + 1)
                # A text field retains the actual JSON serialization and its pin.
                return value if is_source_document(parsed) else recovered
        return value if FENCE in value else None
    if isinstance(value, list):
        candidates = [provider_payload(item, depth + 1) for item in value]
        return next((item for item in candidates if item is not None), None)
    if not isinstance(value, dict):
        return None
    if value.get("isError") is True or value.get("error_code") or value.get("error"):
        code = value.get("error_code") or "provider_error"
        raise ValueError("Source transport returned " + str(code))
    if is_source_document(value):
        return canonical(value).decode("utf-8")
    candidates = []
    if "structuredContent" in value:
        candidates.append(provider_payload(value["structuredContent"], depth + 1))
    for key in ("markdown_content", "text_content"):
        if isinstance(value.get(key), str):
            candidates.append(provider_payload(value[key], depth + 1))
    if isinstance(value.get("section_id_mapping"), dict):
        sections = value["section_id_mapping"].values()
        if not all(isinstance(section, str) for section in sections):
            raise ValueError("Source Canvas section mapping contains a non-text section")
        candidates.append(provider_payload("\n\n".join(sections), depth + 1))
    if isinstance(value.get("content"), (str, dict, list)):
        candidates.append(provider_payload(value["content"], depth + 1))
    if value.get("type") == "text" and isinstance(value.get("text"), str):
        candidates.append(provider_payload(value["text"], depth + 1))
    # Read every relevant wrapper before choosing the preferred payload so that
    # a nested provider error cannot disappear behind another successful field.
    return next((item for item in candidates if item is not None), None)



def decode_carrier(data, _depth=0):
    """Return the complete decoded JSON bytes from a published source carrier."""
    if _depth > 12:
        raise ValueError("Source carrier has excessive wrapper nesting")
    if len(data) > MAX_BYTES:
        raise ValueError("Carrier exceeds the source receiving limit")
    if data[:2] == b"\x1f\x8b":
        return decode_carrier(uncompress(data), _depth + 1)
    text = data.decode("utf-8-sig")
    if text.lstrip().startswith(("{", "[")):
        value = transport_json(text)
        if is_source_document(value):
            return data.removeprefix(b"\xef\xbb\xbf")
        payload = provider_payload(value)
        if payload is None:
            raise ValueError("Provider result contains no complete source payload")
        return decode_carrier(payload.encode("utf-8"), _depth + 1)
    blocks = re.findall(FENCE + r"([a-zA-Z0-9_-]*)[ \t]*\r?\n(.*?)\r?\n" + FENCE,
                        text, re.S)
    parts, addon_parts, plain_parts, documents, encoded = [], [], [], [], []
    original_transports = []
    for language, body in blocks:
        if language.lower() == "base64":
            encoded.append(body)
        elif language.lower() in ("json", "") and body.lstrip().startswith("{"):
            item = transport_json(body)
            if isinstance(item, dict) and item.get("schema") == "upstate.original-source-transport/v1":
                original_transports.append(item)
            elif isinstance(item, dict) and item.get("schema") == PART_SCHEMA:
                parts.append(item)
            elif isinstance(item, dict) and item.get("schema") in CONSERVATION_PART_SCHEMAS:
                addon_parts.append(item)
            elif isinstance(item, dict) and {"part", "total", "data"} <= set(item):
                plain_parts.append(item)
            elif is_source_document(item):
                documents.append(body.encode("utf-8"))
    if sum(bool(group) for group in (parts, addon_parts, plain_parts, documents, encoded)) != 1:
        raise ValueError("Choose one complete source carrier per input")
    if parts:
        return decode_parts(parts)
    if addon_parts:
        return decode_addon_parts(addon_parts)
    if plain_parts:
        return decode_plain_parts(plain_parts, text)
    if documents:
        return documents[0] if len(documents) == 1 else join_source_banks(documents)
    if encoded:
        headings = [(int(a), int(b)) for a, b in re.findall(
            r"(?m)^##[ \t]+Part[ \t]+([0-9]+)[ \t]+of[ \t]+([0-9]+)[ \t]*$", text)]
        if headings and headings != [(index, len(encoded)) for index in range(1, len(encoded) + 1)]:
            raise ValueError("Missing, duplicated or reordered bare-base64 source part")
        compressed = decode_base64("".join(encoded))
        decoded = uncompress(compressed)
        if original_transports:
            if len(original_transports) != 1:
                raise ValueError("Choose one original-source transport identity")
            original = original_transports[0]
            if (original.get("encoding") != "gzip+base64"
                    or type(original.get("parts")) is not int
                    or original["parts"] != len(encoded)):
                raise ValueError("Original-source transport part inventory differs")
            check_identity(compressed, original.get("gzip_bytes"),
                           original.get("gzip_sha256"), "original source gzip")
            check_identity(decoded, original.get("json_bytes"),
                           original.get("json_sha256"), "original source JSON")
        # The current customer carrier declares both transport identities in prose.
        for title, body in (("Gzip", compressed), ("Complete JSON", decoded)):
            match = re.search(
                re.escape(title) + r":\s*([\d,]+)\s*bytes\s*/\s*SHA256\s*"
                + chr(96) + r"?([0-9a-f]{64})", text)
            if match:
                check_identity(body, int(match[1].replace(",", "")), match[2], title)
        return decoded
    raise ValueError("No complete source carrier found")


@dataclass(frozen=True)
class Layer:
    document: dict
    files: dict
    metadata: dict
    receipt: dict


def _source_fingerprint(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _source_inventory(root):
    roots = ("model", "operator", "source_tools", "source", "ecsa_runs",
             "integration", "tools", "receiving", "eco_intelligence")
    skip = {"__pycache__", ".git", ".venv", "venv", "node_modules"}
    selected = {}

    def add(path):
        relative = path.relative_to(root).as_posix()
        member_name(relative)
        value = path.lstat()
        if not stat.S_ISREG(value.st_mode):
            raise ValueError("Current source contains a nonregular member: " + relative)
        selected[relative] = _source_fingerprint(value)

    for path in sorted(root.iterdir()):
        if path.name == RECEIPT_NAME or path.name.endswith((".pyc", ".pyo", ".lock")):
            continue
        if path.name.startswith(".") and path.name != ".experiment-source.json":
            continue
        if path.is_symlink():
            raise ValueError("Current source contains a file alias: " + path.name)
        if path.is_file():
            add(path)
    for name in roots:
        folder = root / name
        if not folder.exists():
            continue
        if folder.is_symlink() or not folder.is_dir():
            raise ValueError("Current source directory is an alias: " + name)
        for directory, directories, names in os.walk(folder, followlinks=False):
            directory = Path(directory)
            kept = []
            for child in sorted(directories):
                if child.startswith(".") or child in skip:
                    continue
                if (directory / child).is_symlink():
                    raise ValueError("Current source contains a directory alias: " +
                                     (directory / child).relative_to(root).as_posix())
                kept.append(child)
            directories[:] = kept
            for child in sorted(names):
                if child.startswith(".") or child.endswith((".pyc", ".pyo", ".lock")):
                    continue
                add(directory / child)
    return dict(sorted(selected.items()))


def snapshot_application(root):
    """Capture the actual installed source after component installers have joined it."""
    root = Path(root).absolute()
    for ancestor in (root, *root.parents):
        if ancestor.is_symlink():
            raise ValueError("Current application root contains a directory alias")
    if not (root / "model/workspace.py").is_file() or not (root / "operator/server.py").is_file():
        raise ValueError("Choose the complete current Upper Savannah application directory")
    initial = _source_inventory(root)
    files, metadata, external = {}, {}, []
    binary_suffixes = {".zip", ".gz", ".pdf", ".tif", ".tiff", ".png", ".jpg", ".jpeg",
                       ".webp", ".mp4", ".gpkg", ".shp", ".shx", ".dbf", ".sqlite", ".sqlite3"}
    for name, before in initial.items():
        path = root.joinpath(*PurePosixPath(name).parts)
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(fd, "rb") as stream:
            status = os.fstat(stream.fileno())
            if not stat.S_ISREG(status.st_mode) or _source_fingerprint(status) != before:
                raise ValueError("Source changed before snapshot: " + name)
            retain = (status.st_size <= MAX_BYTES and
                      (path.suffix.lower() not in binary_suffixes or status.st_size <= INLINE_ASSET_BYTES))
            chunks, digest = [], hashlib.sha256()
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
                if retain:
                    chunks.append(block)
            if _source_fingerprint(os.fstat(stream.fileno())) != before:
                raise ValueError("Source changed during snapshot: " + name)
        data = b"".join(chunks) if retain else None
        try:
            content = data.decode("utf-8") if data is not None else None
        except UnicodeError:
            content = None
        if content is None or "\0" in content:
            if data is None or status.st_size > INLINE_ASSET_BYTES:
                external.append({"path": name, "bytes": status.st_size, "sha256": digest.hexdigest(),
                                 "retained_local_path": str(path)})
                continue
            content = base64.b64encode(data).decode("ascii")
            member_encoding = "base64"
        else:
            member_encoding = "utf-8"
        files[name] = content
        metadata[name] = {
            "bytes": len(data), "sha256": digest.hexdigest(),
            "git_blob": hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest(),
            "mode": "100755" if status.st_mode & 0o111 else "100644",
            "encoding": member_encoding,
        }
    if _source_inventory(root) != initial:
        raise ValueError("Current application source inventory changed during snapshot")
    previous = {}
    marker = root / RECEIPT_NAME
    if marker.exists():
        if marker.is_symlink() or not marker.is_file():
            raise ValueError("Current source receipt must be a retained regular file")
        previous = transport_json(marker.read_text("utf-8"))
    members = {name: {"bytes": item["bytes"], "sha256": item["sha256"], "mode": item["mode"]}
               for name, item in metadata.items()}
    identity = sha256(canonical({"members": members, "external_sources": external}))
    document = {
        "schema": MAP_SCHEMA, "kind": MAP_KIND, "edition": "installed-source-" + identity[:16],
        "source_ref": "snapshot:" + identity, "repository": previous.get("repository", "local"),
        "prefix": "opportunities/upstate_forever_2026",
        "state": "source_stage_complete_application", "files": files, "file_metadata": metadata,
        "external_sources": external,
        "snapshot": {"root": str(root), "previous_source_ref": previous.get("source_ref"),
                     "files": len(files), "external_inputs": len(external)},
    }
    return layer_from_document(document, {"captured_root": str(root)})


def read_layer(path, *, payload_sha256=None):
    path = Path(path)
    if path.is_dir() and not path.is_symlink():
        layer = snapshot_application(path)
        if payload_sha256 is not None and layer.receipt["payload_sha256"] != payload_sha256:
            raise ValueError("Selected current-source snapshot differs")
        return layer
    if path.is_symlink() or not path.is_file():
        raise ValueError("Source carrier must be a retained regular file: " + str(path))
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        data = stream.read(MAX_BYTES + 1)
        after = os.fstat(stream.fileno())
    if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError("Source carrier changed during reading")
    decoded = decode_carrier(data)
    actual = sha256(decoded)
    if payload_sha256 is not None and actual != payload_sha256:
        raise ValueError("Selected decoded payload differs: " + str(path))
    return layer_from_document(transport_json(decoded.decode("utf-8")), {
        "carrier_name": path.name, "carrier_sha256": sha256(data), "carrier_bytes": len(data),
        "payload_sha256": actual, "payload_bytes": len(decoded),
    })


def layer_from_document(document, receipt=None):
    """Validate a source-map, current customer component or base64 source bank."""
    if not is_source_document(document):
        raise ValueError("Source document needs a declared schema and a complete files inventory")
    raw = document.get("files")
    metadata = document.get("file_metadata", {})
    files, checked = {}, {}
    if isinstance(raw, dict):
        if raw and all(isinstance(value, dict) for value in raw.values()):
            if metadata:
                raise ValueError("Choose one metadata representation for the source map")
            entries = [{**entry, "path": name} for name, entry in raw.items()]
        else:
            if not isinstance(metadata, dict) or set(raw) != set(metadata):
                raise ValueError("Source file and metadata inventories differ")
            entries = [{**metadata[name], "path": name, "content": content}
                       for name, content in raw.items()]
    elif isinstance(raw, list):
        entries = raw
    else:
        raise ValueError("Invalid source file inventory")
    binary = document.get("binary_files", [])
    if not isinstance(binary, list):
        raise ValueError("Original binary companion inventory must be a list")
    entries = [*entries, *binary]
    if not entries or len(entries) > MAX_FILES:
        raise ValueError("Invalid source file count")
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Invalid source file entry")
        name = source_member_name(entry.get("path"), document.get("prefix"))
        if name in files:
            raise ValueError("Duplicate source member: " + name)
        encoding = entry.get("encoding", "utf-8")
        if not isinstance(encoding, str) or encoding.lower() not in ("utf-8", "utf8", "base64"):
            raise ValueError("Unsupported source body encoding: " + name)
        encoding = encoding.lower()
        if "content_base64" in entry:
            body = decode_base64(entry["content_base64"])
            if "content" in entry and (not isinstance(entry["content"], str)
                                      or entry["content"].encode("utf-8") != body):
                raise ValueError("Conflicting source representations: " + name)
        elif encoding == "base64":
            body = decode_base64(entry.get("content"))
        else:
            content = entry.get("content")
            if not isinstance(content, str):
                raise ValueError("Source member requires its complete body: " + name)
            body = content.encode("utf-8")
        try:
            content = body.decode("utf-8")
        except UnicodeError:
            content = None
        if content is None or "\0" in content:
            content = base64.b64encode(body).decode("ascii")
            member_encoding = "base64"
        else:
            member_encoding = "utf-8"
        check_identity(body, entry.get("bytes"), entry.get("sha256"), name)
        git_blob = entry.get("git_blob", entry.get("git_blob_sha", entry.get("git_sha")))
        if git_blob is not None:
            actual_git = hashlib.sha1(
                b"blob " + str(len(body)).encode("ascii") + b"\0" + body).hexdigest()
            if actual_git != git_blob:
                raise ValueError("Original Git body differs: " + name)
        mode = entry.get("mode")
        if mode is not None and mode not in ("100644", "100755"):
            raise ValueError("Unsupported source file mode: " + name)
        record = {"bytes": len(body), "sha256": sha256(body), "git_blob": git_blob, "mode": mode,
                  "encoding": member_encoding}
        expected_base = entry.get("base_sha256", entry.get("replaces_sha256"))
        if expected_base is not None:
            if not isinstance(expected_base, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_base):
                raise ValueError("Invalid predecessor identity: " + name)
            record["base_sha256"] = expected_base
        files[name], checked[name] = content, record
    if sum(record["bytes"] for record in checked.values()) > MAX_BYTES:
        raise ValueError("Source members exceed the receiving limit")
    check_layout(files)
    receipt = dict(receipt or {})
    if "payload_sha256" not in receipt:
        payload = canonical(document)
        receipt.update(payload_sha256=sha256(payload), payload_bytes=len(payload))
    receipt.update(schema=document_schema(document), files=len(files),
                   source_bytes=sum(record["bytes"] for record in checked.values()))
    for key in ("edition", "source_ref", "merge_ref", "repository", "operation_id",
                "installation", "native_consumers", "component"):
        if key in document:
            receipt[key] = document[key]
    return Layer(document, files, checked, receipt)


def compose(layers, *, edition, operation_id=None, include_receiver=True):
    """Apply caller-selected complete layers in order; never edit an input tree."""
    if not layers:
        raise ValueError("Choose a complete application base")
    base = layers[0].document
    complete_map = base.get("schema") == MAP_SCHEMA and base.get("kind") == MAP_KIND
    recovered_map = (document_schema(base) == "upstate.source-map/v1"
                     and {"model/workspace.py", "operator/server.py"} <= set(layers[0].files))
    if not (complete_map or recovered_map):
        raise ValueError("First layer must be a complete application map or recovered application source")
    if not isinstance(edition, str) or not edition.strip():
        raise ValueError("Choose an application edition")
    files, metadata, changes, externals = {}, {}, [], {}
    for index, layer in enumerate(layers):
        origin = layer.receipt["payload_sha256"]
        for name, content in sorted(layer.files.items()):
            item = dict(layer.metadata[name])
            previous = metadata.get(name)
            expected = item.pop("base_sha256", None)
            if expected is not None and (previous is None or previous["sha256"] not in
                                         (expected, item["sha256"])):
                raise ValueError("Selected predecessor differs for layer " + str(index) + ": " + name)
            item["mode"] = item["mode"] or (previous or {}).get("mode") or "100644"
            if previous and previous["sha256"] == item["sha256"] and item["git_blob"] is None:
                item["git_blob"] = previous.get("git_blob")
            prior_origins = list((previous or {}).get("origins", []))
            item["origins"] = prior_origins + ([origin] if origin not in prior_origins else [])
            if previous is None:
                action = "added"
            elif previous["sha256"] == item["sha256"] and previous["mode"] == item["mode"]:
                action = "identical"
            else:
                action = "replaced"
            if index or action != "identical":
                changes.append({"layer": index, "path": name, "action": action,
                                "previous_sha256": previous["sha256"] if previous else None,
                                "sha256": item["sha256"]})
            files[name], metadata[name] = content, item
        for original in layer.document.get("external_sources", []):
            if not isinstance(original, dict):
                raise ValueError("Invalid original external-source declaration")
            name = source_member_name(original.get("path"), layer.document.get("prefix"))
            original = {**original, "path": name}
            checked_bytes(original.get("bytes"), name, limit=(1 << 63) - 1)
            expected = original.get("sha256")
            if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
                raise ValueError("Invalid external source identity: " + name)
            if name in externals and any(externals[name].get(key) != original.get(key)
                                         for key in ("bytes", "sha256")):
                raise ValueError("External source path selects different original bytes: " + name)
            externals[name] = dict(original)
    if include_receiver and SELF_NAME not in files:
        body = Path(__file__).read_bytes()
        files[SELF_NAME] = body.decode("utf-8")
        metadata[SELF_NAME] = {"bytes": len(body), "sha256": sha256(body), "git_blob": None,
                               "mode": "100755", "origins": ["assembly-receiver"]}
    check_layout(files)
    if len(files) > MAX_FILES or sum(item["bytes"] for item in metadata.values()) > MAX_BYTES:
        raise ValueError("Combined source exceeds the receiving limit")
    for name, original in list(externals.items()):
        if name in metadata:
            if any(metadata[name][key] != original[key] for key in ("bytes", "sha256")):
                raise ValueError("Embedded source conflicts with declared original: " + name)
            del externals[name]
    composition = {
        "schema": "upstate.application-assembly/v1",
        "edition": edition, "operation_id": operation_id,
        "layers": [layer.receipt for layer in layers],
        "changes": changes,
        "members": {name: {key: item[key] for key in ("bytes", "sha256", "mode")}
                    for name, item in sorted(metadata.items())},
        "external_sources": [externals[name] for name in sorted(externals)],
    }
    assembly_id = sha256(canonical(composition))
    return {
        "schema": MAP_SCHEMA, "kind": MAP_KIND, "edition": edition,
        "repository": base.get("repository", "woahwhattheheck/commons"),
        "source_ref": "assembly:" + assembly_id,
        "prefix": base.get("prefix", "opportunities/upstate_forever_2026"),
        "state": "source_stage_complete_application",
        "files": dict(sorted(files.items())), "file_metadata": dict(sorted(metadata.items())),
        "assembly": composition, "external_sources": composition["external_sources"],
    }


def source_receipt(document, payload):
    return {
        "schema": "upstate.application-source-receipt/v1",
        "source_ref": document["source_ref"], "repository": document["repository"],
        "payload_sha256": sha256(payload), "payload_bytes": len(payload),
        "files": len(document["files"]),
        "source_bytes": sum(item["bytes"] for item in document["file_metadata"].values()),
        "state": "application_source_received", "scientific_execution": "not_performed",
    }


def expected_files(document, receipt):
    result = {}
    for name, content in document["files"].items():
        metadata = document["file_metadata"][name]
        body = represented_body(content, metadata)
        check_identity(body, metadata["bytes"], metadata["sha256"], name)
        result[name] = body
    result[RECEIPT_NAME] = (json.dumps(receipt, indent=2) + "\n").encode("utf-8")
    return result


def _fsync_directory(path):
    if hasattr(os, "O_DIRECTORY"):
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def _plain_parent(path):
    # Resolve the parent only after rejecting aliases in the selected path.
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError("Receiving path contains a directory alias: " + str(part))
    path.mkdir(parents=True, exist_ok=True)


def publish_file(destination, data):
    """Publish one immutable file and reuse an identical retained copy."""
    destination = Path(destination).absolute()
    _plain_parent(destination.parent)
    if destination.exists() or destination.is_symlink():
        if destination.is_symlink() or not destination.is_file() or destination.read_bytes() != data:
            raise ValueError("A different file already exists: " + str(destination))
        return {"path": str(destination), "bytes": len(data), "sha256": sha256(data), "reused": True}
    fd, name = tempfile.mkstemp(prefix=".application-source-", dir=destination.parent)
    pending = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(pending, destination)
        except FileExistsError:
            if destination.is_symlink() or not destination.is_file() or destination.read_bytes() != data:
                raise ValueError("A different destination appeared during publication")
        _fsync_directory(destination.parent)
    finally:
        pending.unlink(missing_ok=True)
    return {"path": str(destination), "bytes": len(data), "sha256": sha256(data), "reused": False}


def verify_directory(destination, document, receipt):
    destination = Path(destination)
    if destination.is_symlink() or not destination.is_dir():
        raise ValueError("Receiving directory is not a retained application")
    expected = expected_files(document, receipt)
    for name, body in expected.items():
        path = destination.joinpath(*PurePosixPath(name).parts)
        for ancestor in (path, *path.parents):
            if ancestor == destination.parent:
                break
            if ancestor.is_symlink():
                raise ValueError("Received application contains a filesystem alias: " + name)
        if not path.is_file() or not stat.S_ISREG(path.stat().st_mode) or path.read_bytes() != body:
            raise ValueError("Received application source changed: " + name)
    return {"directory": str(destination), "files": len(document["files"])}


def receive_directory(destination, document, receipt):
    destination = Path(destination).absolute()
    _plain_parent(destination.parent)
    if destination.exists() or destination.is_symlink():
        return {**verify_directory(destination, document, receipt), "reused": True}
    # The kernel releases the lock on interruption. The retained lock filename
    # is deliberately not unlinked, so concurrent continuations share one inode.
    lock = destination.parent / ("." + destination.name + ".source-receive.lock")
    lock_fd = os.open(lock, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    pending = None
    try:
        if not stat.S_ISREG(os.fstat(lock_fd).st_mode):
            raise ValueError("Receiving lock must be a regular file")
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if destination.exists() or destination.is_symlink():
            return {**verify_directory(destination, document, receipt), "reused": True}
        pending = Path(tempfile.mkdtemp(prefix=".application-receive-", dir=destination.parent))
        for name, body in sorted(expected_files(document, receipt).items()):
            path = pending.joinpath(*PurePosixPath(name).parts)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("xb") as stream:
                stream.write(body)
                stream.flush()
                os.fsync(stream.fileno())
            mode = document["file_metadata"].get(name, {}).get("mode", "100644")
            path.chmod(0o755 if mode == "100755" else 0o644)
        for folder, _, _ in os.walk(pending, topdown=False):
            _fsync_directory(Path(folder))
        verify_directory(pending, document, receipt)
        if destination.exists() or destination.is_symlink():
            raise ValueError("A receiving destination appeared during assembly")
        _rename_directory_new(pending, destination)
        pending = None
        _fsync_directory(destination.parent)
    finally:
        os.close(lock_fd)
        if pending is not None:
            shutil.rmtree(pending)
    return {**verify_directory(destination, document, receipt), "reused": False}


def _rename_directory_new(source, destination):
    # The application already requires Linux/POSIX. RENAME_NOREPLACE prevents
    # even an empty directory created by another process from being replaced.
    libc = ctypes.CDLL(None, use_errno=True)
    rename = getattr(libc, "renameat2", None)
    if rename is None:
        raise OSError(errno.ENOSYS, "Linux renameat2 is required for atomic new-directory receiving")
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(source), -100, os.fsencode(destination), 1) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(destination))


def local_dependencies(document):
    """Inspect explicit local Python/JavaScript imports without executing source.

    Third-party scientific packages and runtime-selected HTTP routes are outside
    this file-closure report. Conditional imports remain visible.
    """
    files = document["files"]
    missing, syntax = [], []
    for name, content in sorted(files.items()):
        if document.get("file_metadata", {}).get(name, {}).get("encoding") == "base64":
            continue
        if name.endswith(".py"):
            try:
                tree = ast.parse(content, filename=name)
            except SyntaxError as error:
                syntax.append({"path": name, "line": error.lineno, "message": error.msg})
                continue
            package = list(PurePosixPath(name).parent.parts)
            for node in ast.walk(tree):
                if not isinstance(node, ast.ImportFrom) or not node.level or not node.module:
                    continue
                if node.level > len(package):
                    missing.append({"path": name, "line": node.lineno,
                                    "import": "." * node.level + node.module,
                                    "candidates": [], "reason": "relative import leaves the source root"})
                    continue
                prefix = package[:len(package) - node.level + 1]
                target = "/".join([*prefix, *node.module.split(".")])
                candidates = [target + ".py", target + "/__init__.py"]
                if not any(candidate in files for candidate in candidates):
                    # A namespace package can legitimately have no __init__.py.
                    if not any(member.startswith(target + "/") for member in files):
                        missing.append({"path": name, "line": node.lineno,
                                        "import": "." * node.level + node.module,
                                        "candidates": candidates})
        elif name.endswith((".js", ".mjs")):
            pattern = r"""(?:\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?|\bimport\s*\(\s*)["'](\.[^"']+)["']"""
            for match in re.finditer(pattern, content):
                specifier = match[1].split("?", 1)[0].split("#", 1)[0]
                target = posixpath.normpath(posixpath.join(posixpath.dirname(name), specifier))
                if target not in files:
                    missing.append({"path": name, "line": content.count("\n", 0, match.start()) + 1,
                                    "import": match[1], "candidates": [target]})
    distinct = {json.dumps(item, sort_keys=True): item for item in missing}
    return {"schema": "upstate.application-local-imports/v1",
            "missing": list(distinct.values()), "syntax_errors": syntax,
            "inspected_python_and_javascript": sum(
                name.endswith((".py", ".js", ".mjs"))
                and document.get("file_metadata", {}).get(name, {}).get("encoding") != "base64"
                for name in files)}

def write_archive(destination, document, receipt):
    expected = {"upper-savannah-application/" + name: body
                for name, body in expected_files(document, receipt).items()}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, body in sorted(expected.items()):
            relative = name.removeprefix("upper-savannah-application/")
            mode = document["file_metadata"].get(relative, {}).get("mode", "100644")
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 12, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | (0o755 if mode == "100755" else 0o644)) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, body)
    return publish_file(destination, buffer.getvalue())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", type=Path, help="Complete application JSON/gzip/Canvas, or the actual installed application directory")
    parser.add_argument("--overlay", action="append", type=Path, default=[],
                        help="Complete component carrier to apply; repeat in selected source order")
    parser.add_argument("--edition", required=True, help="Stable name of this cumulative application")
    parser.add_argument("--operation-id")
    parser.add_argument("--expect", action="append", default=[], metavar="INDEX:SHA256",
                        help="Pin a decoded carrier; base is index 0, overlays start at 1")
    parser.add_argument("--output", type=Path, help="Fresh application directory or identical retained receive")
    parser.add_argument("--source-map", type=Path, help="Write the full compatible JSON or .gz source map")
    parser.add_argument("--zip", dest="archive_path", type=Path, help="Write the portable application ZIP")
    parser.add_argument("--inspect", action="store_true", help="Read and compose without publishing files")
    args = parser.parse_args(argv)
    try:
        paths = [args.base, *args.overlay]
        pins = {}
        for value in args.expect:
            index, expected = value.split(":", 1)
            index = int(index)
            if index in pins or not 0 <= index < len(paths) or not re.fullmatch(r"[0-9a-f]{64}", expected):
                raise ValueError("Invalid or duplicate --expect INDEX:SHA256")
            pins[index] = expected
        layers = [read_layer(path, payload_sha256=pins.get(index)) for index, path in enumerate(paths)]
        document = compose(layers, edition=args.edition, operation_id=args.operation_id)
        payload = canonical(document)
        receipt = source_receipt(document, payload)
        result = {**receipt, "edition": args.edition,
                  "layers": document["assembly"]["layers"],
                  "added": sum(change["action"] == "added" for change in document["assembly"]["changes"]),
                  "replaced": [change for change in document["assembly"]["changes"]
                               if change["action"] == "replaced"],
                  "external_sources": document["external_sources"],
                  "local_dependencies": local_dependencies(document),
                  "component_integrations": [
                      {"layer": index, "installation": layer.document["installation"]}
                      for index, layer in enumerate(layers) if "installation" in layer.document]}
        if not args.inspect:
            if not (args.output or args.source_map or args.archive_path):
                parser.error("Choose --output, --source-map or --zip, or use --inspect")
            if args.source_map:
                data = gzip.compress(payload, mtime=0) if args.source_map.suffix == ".gz" else payload
                result["source_map"] = publish_file(args.source_map, data)
            if args.output:
                result["received"] = receive_directory(args.output, document, receipt)
            if args.archive_path:
                result["archive"] = write_archive(args.archive_path, document, receipt)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, EOFError) as error:
        print(json.dumps({"state": "error", "type": type(error).__name__, "message": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
