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

try:
    from .application_components import (CATALOG_PATH, MODULE_PATH,
        inspect as inspect_components, require_complete as require_components,
        validate_catalog, source_manifest_members, read_directory,
        compose_catalog, read_directory_fragments, fragment_paths)
except ImportError:
    from application_components import (CATALOG_PATH, MODULE_PATH,
        inspect as inspect_components, require_complete as require_components,
        validate_catalog, source_manifest_members, read_directory,
        compose_catalog, read_directory_fragments, fragment_paths)

MAX_BYTES = 512 * 1024 * 1024
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
    """Decode the complete conservation transport with its declared identity."""
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
            if name in joined:
                previous = joined[name]
                if any(previous.get(key) != entry.get(key)
                       for key in ("bytes", "sha256", "mode")):
                    raise ValueError("Source-bank blocks contain different bodies: " + name)
                before, incoming = previous.get("base_sha256"), entry.get("base_sha256")
                if before is not None and incoming is not None and before != incoming:
                    raise ValueError("Source-bank blocks select different predecessors: " + name)
                if before is not None:
                    entry["base_sha256"] = before
                declarations = list(previous.get("predecessor_declarations", []))
                for declared in entry.get("predecessor_declarations", []):
                    if declared not in declarations:
                        declarations.append(declared)
                if declarations:
                    entry["predecessor_declarations"] = declarations
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
        return value if (FENCE in value or re.search(
            r"(?m)^SOURCE_TRANSPORT_METADATA=", value)) else None
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



def decode_complete_transport(text):
    """Read the complete application exported as one or ordered text parts."""
    marker = r"(?m)^SOURCE_TRANSPORT_METADATA=(.+)\r?$"
    headers = list(re.finditer(marker, text))
    if not headers:
        return None
    received = []
    for index, header in enumerate(headers):
        metadata = transport_json(header.group(1))
        if (not isinstance(metadata, dict)
                or metadata.get("schema") != "upstate.complete-application-transport/v1"):
            raise ValueError("Unsupported complete application transport")
        stop = headers[index + 1].start() if index + 1 < len(headers) else len(text)
        section = text[header.end():stop]
        starts = list(re.finditer(
            r"(?m)^BEGIN_UPSTATE_SOURCE_GZIP_BASE64[ \t]*\r?$", section))
        ends = list(re.finditer(
            r"(?m)^END_UPSTATE_SOURCE_GZIP_BASE64[ \t]*\r?$", section))
        if len(starts) != 1 or len(ends) != 1 or starts[0].end() >= ends[0].start():
            raise ValueError("A complete source text part needs its original begin/end markers")
        encoded = "".join(section[starts[0].end():ends[0].start()].split())
        part_lines = re.findall(
            r"(?m)^SOURCE_TRANSPORT_PART=(.+)\r?$", section[:starts[0].start()])
        if len(part_lines) > 1:
            raise ValueError("A complete source text part has duplicated metadata")
        part = transport_json(part_lines[0]) if part_lines else None
        if part is not None:
            if (not isinstance(part, dict)
                    or type(part.get("part")) is not int
                    or type(part.get("parts")) is not int
                    or part["parts"] < 1
                    or not 1 <= part["part"] <= part["parts"]):
                raise ValueError("Invalid complete source text part identity")
            check_identity(encoded.encode("ascii"), part.get("base64_chars"),
                           part.get("base64_sha256"), "complete source text part")
        received.append((metadata, part, encoded))
    metadata = received[0][0]
    if any(item[0] != metadata for item in received):
        raise ValueError("Complete source text parts belong to different application editions")
    if all(item[1] is None for item in received):
        if len(received) != 1:
            raise ValueError("Multiple complete source text parts need numbered identities")
        encoded = received[0][2]
    else:
        if any(item[1] is None for item in received):
            raise ValueError("A complete source text part is missing its numbered identity")
        total = received[0][1]["parts"]
        if (len(received) != total
                or any(item[1]["parts"] != total for item in received)
                or sorted(item[1]["part"] for item in received) != list(range(1, total + 1))):
            raise ValueError("Receive every complete source text part exactly once")
        encoded = "".join(item[2] for item in sorted(
            received, key=lambda item: item[1]["part"]))
    compressed = decode_base64(encoded)
    check_identity(compressed, metadata.get("gzip_bytes"),
                   metadata.get("gzip_sha256"), "complete application gzip")
    decoded = uncompress(compressed)
    check_identity(decoded, metadata.get("json_bytes"),
                   metadata.get("json_sha256"), "complete application JSON")
    document = transport_json(decoded.decode("utf-8"))
    if (not is_source_document(document)
            or document.get("schema") != metadata["schema"]):
        raise ValueError("The complete application differs from its transport schema")
    return decoded


def decode_application_transport(parts, transports):
    """Join lean source parts to their separately retained transport identity."""
    if len(transports) != 1:
        raise ValueError("Choose one complete application transport identity")
    transport = transports[0]
    if (transport.get("encoding") != "gzip+base64"
            or type(transport.get("parts")) is not int
            or not 0 < transport["parts"] <= MAX_FILES):
        raise ValueError("Invalid application source transport")
    fields = {
        "schema": PART_SCHEMA,
        "parts": transport["parts"],
        "encoding": transport["encoding"],
        "payload_bytes": transport.get("decoded_bytes"),
        "payload_sha256": transport.get("decoded_sha256"),
        "compressed_bytes": transport.get("compressed_bytes"),
        "compressed_sha256": transport.get("compressed_sha256"),
    }
    for key in ("edition", "operation_id"):
        if key in transport:
            fields[key] = transport[key]
    normalized = []
    for part in parts:
        for key, expected in fields.items():
            if key in part and part[key] != expected:
                raise ValueError("Application source part differs from its transport: " + key)
        data = part.get("data", part.get("data_base64"))
        if "data" in part and "data_base64" in part and part["data"] != part["data_base64"]:
            raise ValueError("Application source part has conflicting encoded bodies")
        if not isinstance(data, str):
            raise ValueError("Application source part requires its complete encoded body")
        normalized.append({**part, **fields, "data": data})
    return decode_parts(normalized)


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
    complete = decode_complete_transport(text)
    if complete is not None:
        return complete
    blocks = re.findall(FENCE + r"([a-zA-Z0-9_-]*)[ \t]*\r?\n(.*?)\r?\n" + FENCE,
                        text, re.S)
    parts, addon_parts, plain_parts, documents, encoded = [], [], [], [], []
    original_transports = []
    application_transports = []
    for language, body in blocks:
        if language.lower() == "base64":
            encoded.append(body)
        elif language.lower() in ("json", "") and body.lstrip().startswith("{"):
            item = transport_json(body)
            if isinstance(item, dict) and item.get("schema") == "upstate.original-source-transport/v1":
                original_transports.append(item)
            elif isinstance(item, dict) and item.get("schema") == "upstate.application-source-transport/v1":
                application_transports.append(item)
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
    if application_transports and not parts:
        raise ValueError("Application source transport has no complete parts")
    if parts:
        return (decode_application_transport(parts, application_transports)
                if application_transports else decode_parts(parts))
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


def _installed_source_directories(root):
    """Read the installed portable inventory as data, without importing the application."""
    defaults = ("model", "operator", "source_tools", "source", "ecsa_runs",
                "integration", "integrations", "tools", "receiving", "eco_intelligence",
                "observations")
    portable = root / "model" / "portable.py"
    if (root / "model").is_symlink() or portable.is_symlink():
        raise ValueError("Installed portable inventory contains a file alias")
    if not portable.exists():
        return defaults
    fd = os.open(portable, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) |
                 getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_BYTES:
            raise ValueError("Installed portable inventory is not a regular source file")
        body = stream.read(MAX_BYTES + 1)
        if (len(body) != before.st_size or
                _source_fingerprint(before) != _source_fingerprint(os.fstat(stream.fileno()))):
            raise ValueError("Installed portable inventory changed during receiving")
    tree = ast.parse(body, filename=str(portable))
    declared = []

    def sequence(node):
        if isinstance(node, ast.Name) and node.id == "APPLICATION_DIRECTORIES":
            return list(declared)
        if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
            result = []
            for item in node.elts:
                if isinstance(item, ast.Starred):
                    result.extend(sequence(item.value))
                elif isinstance(item, ast.Constant) and isinstance(item.value, str):
                    result.append(item.value)
                else:
                    raise ValueError("Portable source directories must contain literal names")
            return result
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            return sequence(node.left) + sequence(node.right)
        if isinstance(node, ast.Call) and len(node.args) == 1 and not node.keywords:
            constructor = (isinstance(node.func, ast.Name)
                           and node.func.id in {"tuple", "list", "set"})
            deduplicate = (isinstance(node.func, ast.Attribute)
                           and node.func.attr == "fromkeys"
                           and isinstance(node.func.value, ast.Name)
                           and node.func.value.id == "dict")
            if constructor or deduplicate:
                return sequence(node.args[0])
        raise ValueError("Cannot read the installed portable source-directory declaration")

    for statement in tree.body:
        if isinstance(statement, ast.Assign):
            targets, value = statement.targets, statement.value
        elif isinstance(statement, ast.AnnAssign):
            targets, value = [statement.target], statement.value
        elif (isinstance(statement, ast.AugAssign)
              and isinstance(statement.target, ast.Name)
              and statement.target.id == "APPLICATION_DIRECTORIES"
              and isinstance(statement.op, ast.Add)):
            declared += sequence(statement.value)
            continue
        else:
            continue
        if any(isinstance(target, ast.Name) and target.id == "APPLICATION_DIRECTORIES"
               for target in targets):
            if value is not None:
                declared = sequence(value)
    roots = tuple(dict.fromkeys((*defaults, *declared)))
    for name in roots:
        member_name(name)
    return roots


def _declared_source_members(root):
    """Retain catalogue paths even outside the ordinary installed source roots."""
    catalog_path = root / CATALOG_PATH
    if not catalog_path.exists():
        return set()
    for path in (catalog_path, *catalog_path.parents):
        if path == root:
            break
        if path.is_symlink():
            raise ValueError("Selected catalogue contains a source alias")
    catalog, fragment_records = compose_catalog(
        transport_json(catalog_path.read_text("utf-8")), read_directory_fragments(root))
    catalog = validate_catalog(catalog)
    selected = set()

    def select(name):
        if name in selected:
            return
        selected.add(name)
        for dependency in catalog["components"][name].get("requires", []):
            select(dependency)

    for name in catalog["required_components"]:
        select(name)
    members = {path for name in selected for path in catalog["components"][name]["paths"]}
    manifests = {path for name in selected
                 for path in catalog["components"][name].get("source_manifests", [])}
    members.update(manifests)
    members.update(fragment["path"] for fragment in fragment_records)
    for name in sorted(manifests):
        path = root.joinpath(*member_name(name).parts)
        for ancestor in (path, *path.parents):
            if ancestor == root:
                break
            if ancestor.is_symlink():
                raise ValueError("Native source manifest contains an alias: " + name)
        if not path.is_file():
            continue
        value = transport_json(path.read_text("utf-8"))
        members.update(row["path"] for row in source_manifest_members(name, value))
    return members


def _source_inventory(root):
    roots = _installed_source_directories(root)
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
        relative = member_name(name)
        if any(part.startswith(".") or part in skip for part in relative.parts):
            continue
        folder = root.joinpath(*relative.parts)
        for ancestor in (folder, *folder.parents):
            if ancestor == root:
                break
            if ancestor.is_symlink():
                raise ValueError("Current source directory is an alias: " + name)
        if not folder.exists():
            continue
        if not folder.is_dir():
            raise ValueError("Current source directory is not a directory: " + name)
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
    for name in sorted(_declared_source_members(root)):
        relative = member_name(name)
        path = root.joinpath(*relative.parts)
        for ancestor in (path, *path.parents):
            if ancestor == root:
                break
            if ancestor.is_symlink():
                raise ValueError("Selected source contains an alias: " + name)
        if path.exists():
            add(path)
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
    declared = _declared_source_members(root)
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
                      (name in declared or path.suffix.lower() not in binary_suffixes
                       or status.st_size <= INLINE_ASSET_BYTES))
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
            if data is None or (name not in declared and status.st_size > INLINE_ASSET_BYTES):
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


def _family_member(root, name, expected=None):
    """Capture one retained member without following aliases or changing source."""
    path = root.joinpath(*member_name(name).parts)
    for ancestor in (path, *path.parents):
        if ancestor == root:
            break
        if ancestor.is_symlink():
            raise ValueError("Selected family member contains an alias: " + name)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_BYTES:
            raise ValueError("Selected family member is not a bounded regular file: " + name)
        body = stream.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES or _source_fingerprint(os.fstat(stream.fileno())) != _source_fingerprint(before):
            raise ValueError("Selected family member changed during capture: " + name)
    identity = {"bytes": len(body), "sha256": sha256(body)}
    if expected is not None and any(expected[key] != identity[key] for key in identity):
        raise ValueError("Selected family member changed after closure inspection: " + name)
    try:
        content = body.decode("utf-8")
        encoding = "utf-8"
    except UnicodeError:
        content, encoding = base64.b64encode(body).decode("ascii"), "base64"
    if encoding == "utf-8" and "\0" in content:
        content, encoding = base64.b64encode(body).decode("ascii"), "base64"
    return {"path": name, "content": content, "encoding": encoding, **identity,
            "mode": "100755" if before.st_mode & 0o111 else "100644"}


def export_family(root, components, *, edition, operation_id=None, against=None, inspect_only=False):
    """Export an explicit family as an ordinary source overlay, preserving its host.

    The complete catalogue and fragments remain the maintained authority. Their
    original bodies travel as selection provenance, rather than overwriting the
    receiving application's catalogue with a second partial catalogue.
    """
    root = Path(root).absolute()
    for ancestor in (root, *root.parents):
        if ancestor.is_symlink():
            raise ValueError("Selected family root contains a directory alias")
    if not root.is_dir() or not isinstance(edition, str) or not edition.strip():
        raise ValueError("Choose an original application directory and family edition")
    components = list(components)
    document = read_directory(root, selected_components=components, allow_embedded=False)
    options = {"selected_components": components, "allow_embedded": False}
    report = (inspect_components(document, **options) if inspect_only
              else require_components(document, **options))
    controls = {CATALOG_PATH, *fragment_paths(document["files"])}
    declarations = [_family_member(root, name, document["file_metadata"][name])
                    for name in sorted(controls)]
    catalog, records = compose_catalog(
        transport_json(next(row["content"] for row in declarations if row["path"] == CATALOG_PATH)),
        [(row["path"], row["content"]) for row in declarations if row["path"] != CATALOG_PATH])
    catalog = validate_catalog(catalog)
    selection = {
        "schema": "upstate.application-family-selection/v1",
        "requested_components": components,
        "selected_components": report["selected_components"],
        "catalog": catalog,
        "declaration_sources": declarations,
        "component_inventory": report,
    }
    destination = Path(against).absolute() if against is not None else None
    if destination is not None:
        for ancestor in (destination, *destination.parents):
            if ancestor.is_symlink():
                raise ValueError("Receiving family root contains a directory alias")
        if not destination.is_dir():
            raise ValueError("--family-against needs the retained receiving application directory")
    members = []
    for name, expected in sorted(report["members"].items()):
        if name in controls:
            continue
        member = _family_member(root, name, expected)
        if destination is not None:
            target = destination.joinpath(*member_name(name).parts)
            if target.exists() or target.is_symlink():
                member["base_sha256"] = _family_member(destination, name)["sha256"]
        members.append(member)
    # A fragment added during inspection changes effective membership even if
    # none of the already selected original bodies changed.
    if read_directory_fragments(root) != [
            (row["path"], row["content"]) for row in declarations if row["path"] != CATALOG_PATH]:
        raise ValueError("Application component fragments changed during family capture")
    _family_member(root, CATALOG_PATH, document["file_metadata"][CATALOG_PATH])
    if len(members) > MAX_FILES or sum(row["bytes"] for row in members) > MAX_BYTES:
        raise ValueError("Selected family exceeds the source receiving limit")
    return {
        "schema": "commons.source-bank/v1",
        "kind": "upstate.selected-application-family/v1",
        "edition": edition, "operation_id": operation_id,
        "repository": "woahwhattheheck/public-commons-sprint-2026",
        "source_root": "opportunities/upstate_forever_2026",
        "source_ref": "family:" + sha256(canonical({
            "selection": selection,
            "members": {row["path"]: {key: row[key] for key in ("bytes", "sha256", "mode")}
                        for row in members}})),
        "state": "selected_family_complete" if report["ready"] else "selected_family_incomplete",
        "family_selection": selection, "files": members,
    }


def inspect_family_layers(document, layers):
    """Validate selected overlays against the original receiving declarations."""
    selected = []
    files, metadata = document["files"], document.get("file_metadata", {})
    for index, layer in enumerate(layers):
        selection = layer.document.get("family_selection")
        if selection is None:
            continue
        if not isinstance(selection, dict) or selection.get("schema") != "upstate.application-family-selection/v1":
            raise ValueError("Unsupported selected family declaration")
        declarations = selection.get("declaration_sources")
        if not isinstance(declarations, list):
            raise ValueError("Selected family needs its original catalogue and fragment bodies")
        declaration_files = {}
        for row in declarations:
            if not isinstance(row, dict):
                raise ValueError("Invalid selected family declaration body")
            name = row.get("path")
            member_name(name)
            if name in declaration_files or (name != CATALOG_PATH and name not in fragment_paths([name])):
                raise ValueError("Selected family declaration identity is invalid: " + name)
            body = represented_body(row.get("content"), row)
            check_identity(body, row.get("bytes"), row.get("sha256"), name)
            declaration_files[name] = body.decode("utf-8")
        if CATALOG_PATH not in declaration_files:
            raise ValueError("Selected family needs the original complete catalogue")
        catalog, _ = compose_catalog(
            transport_json(declaration_files[CATALOG_PATH]),
            [(name, declaration_files[name]) for name in fragment_paths(declaration_files)])
        catalog = validate_catalog(catalog)
        if canonical(catalog) != canonical(selection.get("catalog")):
            raise ValueError("Selected family catalogue differs from its original declarations")
        requested = selection.get("requested_components")
        if not isinstance(requested, list) or not requested:
            raise ValueError("Selected family needs its explicit component entry points")
        if CATALOG_PATH not in files:
            raise ValueError("Receive the family's maintained application catalogue before its source overlay")
        current, _ = compose_catalog(
            transport_json(represented_body(files[CATALOG_PATH], metadata.get(CATALOG_PATH, {})).decode("utf-8")),
            [(name, represented_body(files[name], metadata.get(name, {})).decode("utf-8"))
             for name in fragment_paths(files)])
        current = validate_catalog(current)
        expected = inspect_components(document, catalog=catalog, selected_components=requested,
                                      allow_embedded=True)
        # This source overlay carries its complete selected runtime/data closure.
        # Declaration publication stays with the existing catalogue/fragment
        # author, so a stale host must receive those original declarations first.
        fields = ("paths", "requires", "source_manifests", "import_roots",
                  "python_contexts", "retained_only", "html_templates")
        for name in expected["selected_components"]:
            original, received = catalog["components"][name], current["components"].get(name)
            if received is None or any(original.get(key, []) != received.get(key, []) for key in fields):
                raise ValueError("Receive the original selected component declaration before its family: " + name)
        selected.append({"layer": index, "edition": layer.document.get("edition"),
                         "source_ref": layer.document.get("source_ref"),
                         "component_inventory": expected})
    return selected


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


def predecessor_sha256(entry, name):
    """Normalize published predecessor spellings without treating refs as hashes."""
    declarations = entry.get("predecessor_declarations", [])
    if not isinstance(declarations, list) or any(not isinstance(item, dict)
                                                  for item in declarations):
        raise ValueError("Invalid predecessor declarations: " + name)
    identities = []
    for declared in (entry, *declarations):
        for key in ("base_sha256", "replaces_sha256", "before_sha256"):
            value = declared.get(key)
            if value is not None:
                identities.append((key, value))
        for key in ("before", "base"):
            value = declared.get(key)
            # Existing banks use base="commit-ref"; only objects declare identities.
            if isinstance(value, dict) and value.get("sha256") is not None:
                identities.append((key + ".sha256", value["sha256"]))
    for key, value in identities:
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
            raise ValueError("Invalid predecessor identity " + key + ": " + name)
    if len({value for _, value in identities}) > 1:
        raise ValueError("Conflicting predecessor identities: " + name)
    return identities[0][1] if identities else None


def layer_from_document(document, receipt=None):
    """Validate a source-map, current customer component or base64 source bank."""
    if not is_source_document(document):
        raise ValueError("Source document needs a declared schema and a complete files inventory")
    raw = document.get("files")
    metadata = document.get("file_metadata", {})
    files, checked = {}, {}
    text_repairs = []
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
            if (len(body) != entry.get("bytes") or sha256(body) != entry.get("sha256")):
                # Canvas can replace indentation inside a JSON source string.
                # Recover only the exact source already identified by its publisher.
                restored = content.replace("\u00a0", " ")
                restored_body = restored.encode("utf-8")
                if (restored != content and len(restored_body) == entry.get("bytes")
                        and sha256(restored_body) == entry.get("sha256")):
                    text_repairs.append({
                        "path": name, "operation": "restore_published_ascii_spaces",
                        "incoming_bytes": len(body), "incoming_sha256": sha256(body),
                        "source_bytes": len(restored_body),
                        "source_sha256": sha256(restored_body),
                        "replaced_characters": content.count("\u00a0"),
                    })
                    content, body = restored, restored_body
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
        expected_base = predecessor_sha256(entry, name)
        if expected_base is not None:
            record["base_sha256"] = expected_base
        declarations = list(entry.get("predecessor_declarations", []))
        declared = {key: entry[key] for key in (
            "base_sha256", "replaces_sha256", "before_sha256", "before_bytes",
            "before", "base_ref", "base_git_blob", "base") if key in entry}
        if declared and declared not in declarations:
            declarations.append(declared)
        if declarations:
            record["predecessor_declarations"] = declarations
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
    if text_repairs:
        receipt["source_text_repairs"] = [*receipt.get("source_text_repairs", []), *text_repairs]
    for key in ("edition", "source_ref", "merge_ref", "repository", "operation_id",
                "installation", "native_consumers", "component"):
        if key in document:
            receipt[key] = document[key]
    return Layer(document, files, checked, receipt)


def compose(layers, *, edition, operation_id=None, include_receiver=True, inspect_only=False):
    """Apply caller-selected complete layers in order; never edit an input tree."""
    if not layers:
        raise ValueError("Choose a complete application base")
    base = layers[0].document
    complete_map = base.get("schema") == MAP_SCHEMA and base.get("kind") == MAP_KIND
    recovered_map = (document_schema(base) == "upstate.source-map/v1"
                     and {"model/workspace.py", "operator/server.py"} <= set(layers[0].files))
    native_map = (document_schema(base) == "upstate.complete-application-transport/v1"
                  and {"model/workspace.py", "operator/server.py"} <= set(layers[0].files))
    if not (complete_map or recovered_map or native_map):
        raise ValueError("First layer must be a complete application map, native transport, "
                         "or recovered application source")
    if not isinstance(edition, str) or not edition.strip():
        raise ValueError("Choose an application edition")
    files, metadata, changes, externals, references = {}, {}, [], {}, {}
    for index, layer in enumerate(layers):
        origin = layer.receipt["payload_sha256"]
        for name, content in sorted(layer.files.items()):
            item = dict(layer.metadata[name])
            previous = metadata.get(name)
            expected = item.pop("base_sha256", None)
            declarations = item.pop("predecessor_declarations", [])
            item["mode"] = item["mode"] or (previous or {}).get("mode") or "100644"
            if previous is None:
                action = "added"
            elif previous["sha256"] == item["sha256"] and previous["mode"] == item["mode"]:
                action = "identical"
            else:
                action = "replaced"
            # Complete snapshots belong at layer zero. A changed overlay must
            # identify the actual member it joins; later arrival is not recency.
            if ((action == "added" and expected is not None)
                    or (action == "replaced"
                        and (expected is None or expected != previous["sha256"]))):
                current = previous["sha256"] if previous else "<absent>"
                raise ValueError(
                    "Source join differs for layer " + str(index) + ": " + name
                    + "; current_sha256=" + current
                    + "; incoming_sha256=" + item["sha256"]
                    + "; expected_predecessor_sha256=" + (expected or "<undeclared>")
                    + ". Join this member against the current source and publish its "
                    + "before_sha256; unchanged bodies and new members compose directly.")
            if previous and previous["sha256"] == item["sha256"] and item["git_blob"] is None:
                item["git_blob"] = previous.get("git_blob")
            prior_origins = list((previous or {}).get("origins", []))
            item["origins"] = prior_origins + ([origin] if origin not in prior_origins else [])
            if index or action != "identical":
                change = {"layer": index, "path": name, "action": action,
                          "previous_sha256": previous["sha256"] if previous else None,
                          "sha256": item["sha256"]}
                if expected is not None:
                    change["base_sha256"] = expected
                if declarations:
                    change["predecessor_declarations"] = declarations
                changes.append(change)
            files[name], metadata[name] = content, item
        def keep_reference(original):
            if (not isinstance(original, dict) or not isinstance(original.get("reference"), str)
                    or not original["reference"]):
                raise ValueError("Invalid original external-reference declaration")
            references[canonical(original)] = dict(original)
        for original in layer.document.get("external_references", []):
            keep_reference(original)
        for original in layer.document.get("external_sources", []):
            if not isinstance(original, dict):
                raise ValueError("Invalid original external-source declaration")
            if "path" not in original and isinstance(original.get("reference"), str):
                keep_reference(original)
                continue
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
    if include_receiver:
        receiver_root = Path(__file__).resolve().parents[1]
        for name in (SELF_NAME, MODULE_PATH):
            if name in files:
                continue
            body = receiver_root.joinpath(*PurePosixPath(name).parts).read_bytes()
            files[name] = body.decode("utf-8")
            metadata[name] = {"bytes": len(body), "sha256": sha256(body), "git_blob": None,
                              "mode": "100755" if name == SELF_NAME else "100644",
                              "origins": ["assembly-receiver"]}
    if CATALOG_PATH not in files:
        # A receiving tool's later catalogue is not the selected source edition.
        # Preserve this complete bank's actual members and inspect their native
        # dependencies through the same component-closure implementation.
        original_edition = base.get("edition")
        if not isinstance(original_edition, str) or not original_edition.strip():
            original_edition = edition
        selected_catalog = {
            "schema": "upstate.application-components/v1",
            "edition": original_edition,
            "source_reference": (base.get("source_ref") or base.get("operation_id")
                                 or "sha256:" + layers[0].receipt["payload_sha256"]),
            "source_payloads": [layer.receipt["payload_sha256"] for layer in layers],
            "selection_basis": "Original complete source and caller-selected overlays",
            "required_components": ["retained-source"],
            "components": {"retained-source": {
                "title": "Retained complete application source",
                "paths": sorted([*files, CATALOG_PATH]),
                "requires": [],
            }},
        }
        body = canonical(selected_catalog)
        files[CATALOG_PATH] = body.decode("utf-8")
        metadata[CATALOG_PATH] = {
            "bytes": len(body), "sha256": sha256(body), "git_blob": None,
            "mode": "100644", "origins": ["retained-source-selection"],
        }
    check_layout(files)
    if len(files) > MAX_FILES or sum(item["bytes"] for item in metadata.values()) > MAX_BYTES:
        raise ValueError("Combined source exceeds the receiving limit")
    for name, original in list(externals.items()):
        if name in metadata:
            if any(metadata[name][key] != original[key] for key in ("bytes", "sha256")):
                raise ValueError("Embedded source conflicts with declared original: " + name)
            del externals[name]
    combined = {"files": files, "file_metadata": metadata}
    component_inventory = inspect_components(combined)
    family_inventories = inspect_family_layers(combined, layers)
    if not inspect_only:
        require_components(combined)
        for family in family_inventories:
            if not family["component_inventory"]["ready"]:
                error = ValueError("Selected family has unresolved original source dependencies")
                error.component_closure = family["component_inventory"]
                raise error
    composition = {
        "schema": "upstate.application-assembly/v1",
        "component_inventory": component_inventory,
        "family_inventories": family_inventories,
        "edition": edition, "operation_id": operation_id,
        "layers": [layer.receipt for layer in layers],
        "changes": changes,
        "members": {name: {key: item[key] for key in ("bytes", "sha256", "mode")}
                    for name, item in sorted(metadata.items())},
        "external_sources": [externals[name] for name in sorted(externals)],
        "external_references": [references[key] for key in sorted(references)],
    }
    assembly_id = sha256(canonical(composition))
    return {
        "schema": MAP_SCHEMA, "kind": MAP_KIND, "edition": edition,
        "repository": base.get("repository", "woahwhattheheck/public-commons-sprint-2026"),
        "source_ref": "assembly:" + assembly_id,
        "prefix": base.get("prefix", "opportunities/upstate_forever_2026"),
        "state": ("source_stage_complete_application" if component_inventory["ready"]
                  else "source_stage_incomplete_application"),
        "files": dict(sorted(files.items())), "file_metadata": dict(sorted(metadata.items())),
        "assembly": composition, "external_sources": composition["external_sources"],
        "external_references": composition["external_references"],
        "component_inventory": component_inventory,
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
    require_components(document)
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
        declared_mode = document["file_metadata"].get(name, {}).get("mode", "100644")
        expected_mode = 0o755 if declared_mode == "100755" else 0o644
        if stat.S_IMODE(path.stat().st_mode) != expected_mode:
            raise ValueError("Received application permissions changed: " + name)
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
    parser.add_argument("--family-component", action="append", default=[],
                        help="Export this exact component family and transitive closure; repeat to combine entry points")
    parser.add_argument("--family-against", type=Path,
                        help="Retained receiving application for exact overlay predecessor hashes")
    parser.add_argument("--expect", action="append", default=[], metavar="INDEX:SHA256",
                        help="Pin a decoded carrier; base is index 0, overlays start at 1")
    parser.add_argument("--output", type=Path, help="Fresh application directory or identical retained receive")
    parser.add_argument("--source-map", type=Path, help="Write the full compatible JSON or .gz source map")
    parser.add_argument("--zip", dest="archive_path", type=Path, help="Write the portable application ZIP")
    parser.add_argument("--inspect", action="store_true", help="Read and compose without publishing files")
    args = parser.parse_args(argv)
    try:
        if args.family_component:
            if args.overlay or args.output or args.archive_path or args.expect:
                raise ValueError("Family export uses one retained application directory and --source-map or --inspect")
            if not args.base.is_dir() or (not args.inspect and not args.source_map):
                raise ValueError("Choose the original application directory and --source-map, or --inspect")
            document = export_family(args.base, args.family_component, edition=args.edition,
                                     operation_id=args.operation_id, against=args.family_against,
                                     inspect_only=args.inspect)
            payload = canonical(document)
            result = {"state": document["state"], "edition": args.edition,
                      "source_ref": document["source_ref"],
                      "payload_bytes": len(payload), "payload_sha256": sha256(payload),
                      "files": len(document["files"]),
                      "source_bytes": sum(row["bytes"] for row in document["files"]),
                      "component_inventory": document["family_selection"]["component_inventory"]}
            if not args.inspect:
                data = gzip.compress(payload, mtime=0) if args.source_map.suffix == ".gz" else payload
                result["source_map"] = publish_file(args.source_map, data)
            print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
            return 0
        if args.family_against:
            raise ValueError("--family-against requires an explicit --family-component")
        paths = [args.base, *args.overlay]
        pins = {}
        for value in args.expect:
            index, expected = value.split(":", 1)
            index = int(index)
            if index in pins or not 0 <= index < len(paths) or not re.fullmatch(r"[0-9a-f]{64}", expected):
                raise ValueError("Invalid or duplicate --expect INDEX:SHA256")
            pins[index] = expected
        layers = [read_layer(path, payload_sha256=pins.get(index)) for index, path in enumerate(paths)]
        document = compose(layers, edition=args.edition, operation_id=args.operation_id,
                           inspect_only=args.inspect)
        payload = canonical(document)
        receipt = source_receipt(document, payload)
        result = {**receipt, "edition": args.edition,
                  "layers": document["assembly"]["layers"],
                  "added": sum(change["action"] == "added" for change in document["assembly"]["changes"]),
                  "replaced": [change for change in document["assembly"]["changes"]
                               if change["action"] == "replaced"],
                  "external_sources": document["external_sources"],
                  "local_dependencies": local_dependencies(document),
                  "component_inventory": document["component_inventory"],
                  "component_integrations": [
                      {"layer": index, "installation": layer.document["installation"]}
                      for index, layer in enumerate(layers) if "installation" in layer.document]}
        if not args.inspect:
            require_components(document)
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
        failure = {"state": "error", "type": type(error).__name__, "message": str(error)}
        if getattr(error, "component_closure", None) is not None:
            failure["component_inventory"] = error.component_closure
        print(json.dumps(failure, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
