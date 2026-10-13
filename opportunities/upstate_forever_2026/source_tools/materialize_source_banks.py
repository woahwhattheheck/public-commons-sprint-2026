"""Materialize complete retained source banks or small verified gzip parts.

Fetch the transfer manifest and its part Git blobs through the existing managed
connection. Save each part JSON as <git_blob>.json in --parts. This command
reconstructs the exact original banks and a separate complete source directory.
Use --bank for one complete bank or its original gzip+base64 artifact envelope.
Existing differing files are preserved; installation into a working application
remains an explicit composition of the original source and current local edits.

--carrier receives one complete JSON/gzip/Canvas source bank into a separate
staging tree after every source hash, path and Python body passes preflight.
"""
from __future__ import annotations

import argparse
import base64
import ctypes
import errno
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked(data, size, checksum, label):
    if len(data) != size or sha(data) != checksum:
        raise ValueError("Original bytes differ: " + label)
    return data


def _json_whitespace(text):
    """Undo Canvas spacing outside JSON strings; keep every string byte intact."""
    output, quoted, escaped = [], False, False
    for character in text:
        if quoted:
            output.append(character)
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                quoted = False
        else:
            if character == '"':
                quoted = True
            output.append(" " if character == "\u00a0" else character)
    return "".join(output)


def _document_text(text, label, *, with_source=False):
    """Read original JSON or one explicitly labelled source-transfer JSON fence."""
    try:
        value = json.loads(_json_whitespace(text))
        return (value, text) if with_source else value
    except json.JSONDecodeError as error:
        # The published receiving Canvases have exactly one JSON fence each.
        # Bash/Python instructions remain inert text and are never evaluated.
        fences = re.findall(r"(?m)^" + chr(96) * 3 +
                            r"json[ \t]*\r?\n([\s\S]*?)^" + chr(96) * 3 +
                            r"[ \t]*\r?$", text)
        if len(fences) != 1:
            raise ValueError("Save one complete source JSON or receiving Canvas: " + label) from error
        value = json.loads(_json_whitespace(fences[0]))
        return (value, fences[0]) if with_source else value


def document(path, *, with_source=False, raw_bytes=None):
    label = str(path)
    original = Path(path).read_bytes() if raw_bytes is None else raw_bytes
    value, source_text = _document_text(original.decode("utf-8"), label, with_source=True)
    # Preserve the original saved wrapper; reject errors before unwrapping it.
    for _ in range(16):
        if not isinstance(value, dict):
            break
        if value.get("isError") is True or value.get("error"):
            raise ValueError("The saved provider response reports an error; inspect " + label)
        if isinstance(value.get("schema"), str):
            return (value, source_text) if with_source else value
        if isinstance(value.get("markdown_content"), str):
            value, source_text = _document_text(value["markdown_content"], label, with_source=True)
            continue
        if isinstance(value.get("structuredContent"), dict):
            value = value["structuredContent"]
            source_text = None
            continue
        if isinstance(value.get("content"), str):
            text = value["content"]
            if value.get("encoding") == "base64":
                text = base64.b64decode(text, validate=True).decode("utf-8")
            value, source_text = _document_text(text, label, with_source=True)
            continue
        if isinstance(value.get("content"), list):
            text = [item["text"] for item in value["content"]
                    if isinstance(item, dict) and item.get("type") == "text"]
            if len(text) == 1:
                value, source_text = _document_text(text[0], label, with_source=True)
                continue
        break
    raise ValueError("Save the complete original JSON tool body or receiving Canvas: " + label)


def target(root, name):
    if not isinstance(name, str) or re.search(r"[\\:\x00-\x1f\x7f]", name):
        raise ValueError("Source member needs an original relative POSIX path")
    relative = PurePosixPath(name)
    if relative.is_absolute() or not relative.parts or any(part in (".", "..", "") for part in name.split("/")):
        raise ValueError("Unsafe source member path: " + name)
    path = root.joinpath(*relative.parts)
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Keep source members inside the receiving directory")
    return path


def retain(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not path.is_file() or path.read_bytes() != data:
            raise ValueError("Preserving a different existing file: " + str(path))
        return
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    pending = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        # Publish without overwriting a file created by another operation.
        os.link(pending, path)
    finally:
        pending.unlink(missing_ok=True)



def source_inventory(source):
    """Read retained source contracts without changing their original JSON."""
    schemas = ("commons.source-bank/v1", "commons.source-text-bank/v1", "upstate.source-bank/v1")
    if not isinstance(source, dict) or source.get("schema") not in schemas or not isinstance(source.get("files"), list):
        raise ValueError("Unexpected original source bank")
    optional_inventory = source["schema"] == "upstate.source-bank/v1"
    for key in ("file_count", "source_bytes"):
        if not optional_inventory or key in source:
            if type(source.get(key)) is not int or source[key] < 0:
                raise ValueError("Invalid original source inventory: " + key)
    if "file_count" in source and len(source["files"]) != source["file_count"]:
        raise ValueError("Original source bank file count differs")
    rows, bank_bytes = [], 0
    for item in source["files"]:
        if not isinstance(item, dict):
            raise ValueError("Expected original source file metadata")
        has_text, has_base64 = "content" in item, "content_base64" in item
        if has_text == has_base64 or (has_base64 and source["schema"] != "commons.source-bank/v1"):
            raise ValueError("Source member needs one declared content representation")
        if has_text:
            if not isinstance(item["content"], str):
                raise ValueError("Expected original UTF-8 source text")
            data = item["content"].encode("utf-8")
        else:
            encoded = item["content_base64"]
            if not isinstance(encoded, str):
                raise ValueError("Expected original base64 source content")
            data = base64.b64decode(encoded, validate=True)
            if base64.b64encode(data).decode("ascii") != encoded:
                raise ValueError("Expected canonical base64 source content")
        name = item["path"]
        if type(item.get("bytes")) is not int or item["bytes"] < 0:
            raise ValueError("Invalid original source byte count")
        checked(data, item["bytes"], item["sha256"], str(name))
        git_blob = hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()
        if (has_base64 or "git_blob" in item) and item.get("git_blob") != git_blob:
            raise ValueError("Original Git source identity differs: " + str(name))
        rows.append((name, data, {"path": name, "bytes": len(data),
                                "sha256": item["sha256"], "git_blob": git_blob}))
        bank_bytes += len(data)
    if "source_bytes" in source and bank_bytes != source["source_bytes"]:
        raise ValueError("Original source bank byte count differs")
    return rows

def receive(manifest_path, parts_root, output):
    manifest = document(manifest_path)
    if manifest.get("schema") != "commons.source-bank-transfer/v1":
        raise ValueError("Select the complete source transfer manifest")
    output = Path(output).absolute()
    if output.is_symlink():
        raise ValueError("Use an ordinary owned receiving directory")
    output.mkdir(parents=True, exist_ok=True)
    for name in ("source", "banks"):
        root = output / name
        if root.is_symlink() or (root.exists() and not root.is_dir()):
            raise ValueError("Use an ordinary receiving subdirectory: " + str(root))
    banks, members, combined = [], [], {}
    for bank in manifest["banks"]:
        if not re.fullmatch(r"[a-z0-9-]+", bank["name"]):
            raise ValueError("Invalid source bank name")
        stream = bytearray()
        for index, part in enumerate(bank["parts"]):
            if part["index"] != index or part["offset"] != len(stream):
                raise ValueError("The original source parts are out of order")
            if not re.fullmatch(r"[a-f0-9]{40}", part["git_blob"]):
                raise ValueError("A source part needs its actual Git blob")
            body = document(Path(parts_root) / (part["git_blob"] + ".json"))
            if (body.get("schema") != "commons.source-bank-part/v1"
                    or body.get("encoding") != "base64"
                    or body.get("bank") != bank["name"]
                    or body.get("part_index") != index
                    or body.get("offset") != part["offset"]
                    or body.get("bytes") != part["bytes"]
                    or body.get("sha256") != part["sha256"]):
                raise ValueError("Source part metadata differs: " + part["git_blob"])
            data = checked(base64.b64decode(body["data"], validate=True),
                           part["bytes"], part["sha256"], part["git_blob"])
            stream.extend(data)
        checked(stream, bank["gzip_bytes"], bank["gzip_sha256"], bank["name"] + ".gz")
        original = checked(gzip.decompress(stream), bank["original_bytes"],
                           bank["original_sha256"], bank["name"] + ".json")
        original_git = hashlib.sha1(
            b"blob " + str(len(original)).encode("ascii") + b"\0" + original).hexdigest()
        if bank.get("original_git_blob") != original_git:
            raise ValueError("Original source bank Git identity differs")
        source = json.loads(original)
        inventory = source_inventory(source)
        for name, data, metadata in inventory:
            target(output / "source", name)
            if name in combined:
                raise ValueError("Source banks repeat a member: " + name)
            combined[name] = data
            members.append(metadata)
        banks.append({"name": bank["name"], "bytes": len(original),
                      "sha256": sha(original), "files": len(source["files"])})
        retain(output / "banks" / (bank["name"] + ".json"), original)
    if len(combined) != manifest["file_count"] or sum(map(len, combined.values())) != manifest["source_bytes"]:
        raise ValueError("Complete source inventory differs from the transfer manifest")
    for name in combined:
        parts = name.split("/")
        for index in range(1, len(parts)):
            if "/".join(parts[:index]) in combined:
                raise ValueError("Source file is also a directory: " + name)
    # Validate all overlapping existing source files before any source publish.
    for name, data in combined.items():
        path = target(output / "source", name)
        if path.exists() or path.is_symlink():
            if path.is_symlink() or not path.is_file() or path.read_bytes() != data:
                raise ValueError("Preserving a different existing source file: " + name)
    for name, data in combined.items():
        retain(target(output / "source", name), data)
    result = {"schema": "commons.source-bank-receiving/v1", "state": "complete",
              "operation_id": manifest["operation_id"], "directory": str(output),
              "source": str(output / "source"), "file_count": len(combined),
              "source_bytes": sum(map(len, combined.values())), "banks": banks,
              "files": sorted(members, key=lambda item: item["path"])}
    retain(output / "receiving.json",
           (json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8"))
    return result


def _declared_bytes(value, key, label):
    count = value.get(key)
    if type(count) is not int or count < 0:
        raise ValueError("Invalid original byte count: " + label + "." + key)
    return count


def _declared_sha(value, key, label):
    checksum = value.get(key)
    if not isinstance(checksum, str) or not re.fullmatch(r"[a-f0-9]{64}", checksum):
        raise ValueError("Invalid original SHA-256: " + label + "." + key)
    return checksum


def _original_identity(envelope):
    identities = []
    for prefix in ("original", "decoded"):
        count_key, sha_key = prefix + "_bytes", prefix + "_sha256"
        if count_key in envelope or sha_key in envelope:
            identities.append((_declared_bytes(envelope, count_key, "bank envelope"),
                               _declared_sha(envelope, sha_key, "bank envelope")))
    if not identities or any(item != identities[0] for item in identities[1:]):
        raise ValueError("Complete bank envelope needs agreeing original/decoded identities")
    return identities[0]


def _bank_bytes(value, source_text):
    if value.get("schema") != "commons.artifact-base64/v1":
        if source_text is None:
            raise ValueError("Save the original complete bank JSON body, not a parsed object without its source bytes")
        return source_text.encode("utf-8"), value, None
    if value.get("encoding") != "gzip+base64":
        raise ValueError("Complete bank envelope needs its declared gzip+base64 encoding")
    original_size, original_sha = _original_identity(value)
    compressed_size = _declared_bytes(value, "gzip_bytes", "bank envelope")
    compressed_sha = _declared_sha(value, "gzip_sha256", "bank envelope")
    encoded = value.get("content_base64")
    if not isinstance(encoded, str):
        raise ValueError("Complete bank envelope needs its original base64 body")
    compressed = base64.b64decode(encoded, validate=True)
    if base64.b64encode(compressed).decode("ascii") != encoded:
        raise ValueError("Expected canonical complete-bank base64")
    checked(compressed, compressed_size, compressed_sha, "complete bank gzip")
    # Read at most one byte beyond the declared original. Gzip verifies its
    # complete CRC/trailer; a short/long decode or any extra member must still
    # match the one complete declared original length and hash.
    with gzip.GzipFile(fileobj=io.BytesIO(compressed), mode="rb") as stream:
        original = stream.read(original_size + 1)
    checked(original, original_size, original_sha, "complete bank JSON")
    source = json.loads(original.decode("utf-8"))
    if not isinstance(source, dict) or value.get("decoded_schema") != source.get("schema"):
        raise ValueError("Decoded complete-bank schema differs from its envelope")
    if "original_git_blob" in value:
        git_blob = hashlib.sha1(b"blob " + str(len(original)).encode("ascii") + b"\0" + original).hexdigest()
        if value["original_git_blob"] != git_blob:
            raise ValueError("Decoded complete-bank Git identity differs")
    return original, source, {"bytes": len(compressed), "sha256": sha(compressed)}


def _check_receiving_path(output, path, data):
    # The existing receiver keeps differing files. Also reject directory
    # symlinks before publishing a direct complete bank, including aliases
    # which happen to resolve back inside the selected destination.
    for directory in (output, *output.parents):
        if directory.is_symlink() or directory.exists() and not directory.is_dir():
            raise ValueError("Use an ordinary owned receiving directory: " + str(directory))
    for directory in path.parents:
        if directory == output:
            break
        if directory.is_symlink() or directory.exists() and not directory.is_dir():
            raise ValueError("Source parent is not an ordinary directory: " + str(directory))
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not path.is_file() or path.read_bytes() != data:
            raise ValueError("Preserving a different existing file: " + str(path))


def receive_bank(bank_path, output, *, operation_id=None, expected_bytes=None, expected_sha256=None):
    """Materialize one full original bank/envelope through the existing source layout."""
    incoming = Path(bank_path).read_bytes()
    if expected_bytes is not None:
        if type(expected_bytes) is not int or expected_bytes < 0 or len(incoming) != expected_bytes:
            raise ValueError("Complete bank input byte count differs")
    if expected_sha256 is not None:
        if not re.fullmatch(r"[a-f0-9]{64}", expected_sha256) or sha(incoming) != expected_sha256:
            raise ValueError("Complete bank input SHA-256 differs")
    value, source_text = document(bank_path, with_source=True, raw_bytes=incoming)
    original, source, compressed = _bank_bytes(value, source_text)
    inventory = source_inventory(source)
    digest = sha(original)
    if operation_id is None:
        # This is the exact bank selection identity, not a new scientific
        # Workspace/run or a replacement for its original receiving operation.
        operation_id = "source-bank:" + digest
    if not isinstance(operation_id, str) or not operation_id.strip() or len(operation_id) > 256 or any(
            ord(character) < 32 or ord(character) == 127 for character in operation_id):
        raise ValueError("Use the existing receiving operation ID or the bank-derived default")
    output = Path(output).absolute()
    combined, members = {}, []
    for name, data, metadata in inventory:
        target(output / "source", name)
        if name in combined:
            raise ValueError("Complete source bank repeats a member: " + name)
        combined[name] = data
        members.append(metadata)
    total = sum(map(len, combined.values()))
    if value.get("schema") == "commons.artifact-base64/v1":
        for key, actual in (("file_count", len(combined)), ("source_bytes", total)):
            if key in value and (type(value[key]) is not int or value[key] != actual):
                raise ValueError("Complete bank envelope inventory differs: " + key)
    for name in combined:
        parts = name.split("/")
        if any("/".join(parts[:index]) in combined for index in range(1, len(parts))):
            raise ValueError("Source file is also a directory: " + name)
    result = {"schema": "commons.source-bank-receiving/v1", "state": "complete",
              "operation_id": operation_id, "directory": str(output), "source": str(output / "source"),
              "file_count": len(combined), "source_bytes": total,
              "banks": [{"name": digest, "bytes": len(original), "sha256": digest,
                         "files": len(combined)}],
              "input": {"bytes": len(incoming), "sha256": sha(incoming),
                        "schema": value.get("schema"), "gzip": compressed},
              "source_reference": source.get("source_reference"),
              "files": sorted(members, key=lambda item: item["path"])}
    pending = [(target(output / "source", name), data) for name, data in combined.items()]
    pending.extend([(output / "inputs" / (sha(incoming) + ".json"), incoming),
                    (output / "banks" / (digest + ".json"), original),
                    (output / "receiving.json",
                     (json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8"))])
    # Validate the complete scientific/source inventory and every existing
    # destination before the first source write. Interrupted publication can
    # be continued by repeating this identical selection; retain never replaces.
    for path, data in pending:
        _check_receiving_path(output, path, data)
    for path, data in pending:
        _check_receiving_path(output, path, data)
        retain(path, data)
    return result


# Complete local carrier intake. This path never installs or executes its sources.
CARRIER_LIMIT = 512 * 1024 * 1024
CARRIER_FILES = 10000
SOURCE_SCHEMAS = {
    "commons.source-bank/v1", "commons.source-text-bank/v1", "upstate.source-bank/v1",
    "commons.source-map/1", "upstate.source-files/v1", "commons.source-files.v1",
    "upstate.complete-application-transport/v1",
}


def _carrier_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate carrier JSON key: " + key)
        result[key] = value
    return result


def _carrier_json(text):
    return json.loads(_json_whitespace(text.lstrip("\ufeff")),
                      object_pairs_hook=_carrier_pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(
                          ValueError("Nonfinite carrier JSON number: " + value)))


def _carrier_size(value, label):
    if type(value) is not int or not 0 <= value <= CARRIER_LIMIT:
        raise ValueError("Invalid original byte length: " + label)
    return value


def _carrier_check(data, size, checksum, label):
    _carrier_size(size, label)
    if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise ValueError("Expected original SHA256: " + label)
    return checked(data, size, checksum, label)


def _carrier_base64(value):
    if not isinstance(value, str):
        raise ValueError("Expected complete base64 carrier text")
    value = re.sub(r"[ \t\r\n]", "", value)
    if len(value) > (CARRIER_LIMIT * 4 // 3) + 4:
        raise ValueError("Encoded carrier exceeds the source receiving limit")
    decoded = base64.b64decode(value, validate=True)
    if base64.b64encode(decoded).decode("ascii") != value:
        raise ValueError("Expected canonical base64 carrier text")
    return decoded


def _carrier_gzip(data):
    if data[:2] != b"\x1f\x8b":
        raise ValueError("Expected the original gzip carrier")
    with gzip.GzipFile(fileobj=io.BytesIO(data), mode="rb") as stream:
        decoded = stream.read(CARRIER_LIMIT + 1)
    if len(decoded) > CARRIER_LIMIT:
        raise ValueError("Decoded source bank exceeds the receiving limit")
    return decoded


def _carrier_envelope(value):
    schema = value.get("schema")
    if schema not in ("commons.compressed-source-carrier/v1", "commons.artifact-base64/v1"):
        raise ValueError("Unsupported encoded source carrier")
    if value.get("encoding") not in ("gzip+base64", "base64"):
        raise ValueError("Unsupported original carrier encoding")
    if schema == "commons.compressed-source-carrier/v1" and value["encoding"] != "gzip+base64":
        raise ValueError("The compressed source carrier needs its original gzip")
    fields = [key for key in ("data", "content_base64") if key in value]
    if len(fields) != 1:
        raise ValueError("Choose one complete encoded carrier body")
    encoded = _carrier_base64(value[fields[0]])
    if ("gzip_bytes" in value) != ("gzip_sha256" in value):
        raise ValueError("Retain both original gzip identity fields")
    if "gzip_bytes" in value:
        _carrier_check(encoded, value["gzip_bytes"], value["gzip_sha256"], "original gzip")
    identities = []
    for size_key, hash_key in (("bytes", "sha256"), ("original_bytes", "original_sha256"),
                               ("decoded_bytes", "decoded_sha256")):
        if (size_key in value) != (hash_key in value):
            raise ValueError("Retain both original bank identity fields: " + size_key)
        if size_key in value:
            identities.append((value[size_key], value[hash_key]))
    if not identities or any(pair != identities[0] for pair in identities[1:]):
        raise ValueError("Retain one consistent complete decoded bank identity")
    decoded = _carrier_gzip(encoded) if value["encoding"] == "gzip+base64" else encoded
    _carrier_check(decoded, identities[0][0], identities[0][1], "original source bank")
    if "decoded_schema" in value:
        original = _carrier_json(decoded.decode("utf-8-sig"))
        if not isinstance(original, dict) or value["decoded_schema"] != original.get("schema"):
            raise ValueError("Original decoded bank schema differs")
    for key in ("source_git_blob", "original_git_blob"):
        if key in value:
            actual = hashlib.sha1(b"blob " + str(len(decoded)).encode("ascii") + b"\0" + decoded).hexdigest()
            if not isinstance(value[key], str) or value[key] != actual:
                raise ValueError("Original source-bank Git identity differs")
    return decoded, value

def _carrier_parts(items):
    if not items or len(items) > CARRIER_FILES:
        raise ValueError("Choose every original source carrier part")
    first = items[0]
    if not isinstance(first, dict):
        raise ValueError("Expected original numbered source part objects")
    schema = first.get("schema")
    conventions = {"commons.compressed-source-part/v1": 1,
                   "commons.source-base64-part.v1": 0}
    if schema not in conventions:
        raise ValueError("Unsupported original source part schema")
    start = conventions[schema]
    total = first.get("total")
    if type(total) is not int or not 1 <= total <= CARRIER_FILES:
        raise ValueError("Invalid original source part total")
    common = {key: value for key, value in first.items() if key not in ("index", "data")}
    for item in items:
        if (not isinstance(item, dict)
                or item.get("schema") != schema
                or type(item.get("index")) is not int
                or not isinstance(item.get("data"), str)
                or {key: value for key, value in item.items()
                    if key not in ("index", "data")} != common):
            raise ValueError("Original source parts have different identities")
    ordered = sorted(items, key=lambda item: item["index"])
    if len(ordered) != total or [item["index"] for item in ordered] != list(range(start, start + total)):
        raise ValueError("Missing or duplicated original source carrier part")
    carrier = {key: value for key, value in common.items() if key not in ("schema", "total")}
    if schema == "commons.compressed-source-part/v1":
        carrier.update(schema="commons.compressed-source-carrier/v1", encoding="gzip+base64")
    else:
        carrier.update(schema="commons.artifact-base64/v1", encoding="base64",
                       bytes=first.get("decoded_bytes"), sha256=first.get("decoded_sha256"))
    carrier["data"] = "".join(item["data"] for item in ordered)
    return _carrier_envelope(carrier)


def _carrier_decode(data, depth=0, expected_sha256=None):
    """Return the exact inner JSON bytes, never a reserialized original bank."""
    if depth > 16 or len(data) > CARRIER_LIMIT:
        raise ValueError("Carrier nesting or bytes exceed the receiving limit")
    if data[:2] == b"\x1f\x8b":
        return _carrier_decode(_carrier_gzip(data), depth + 1, expected_sha256)
    body = data.decode("utf-8-sig")
    stripped = body.lstrip()
    if stripped.startswith(("{", "[")):
        value = _carrier_json(body)
        if isinstance(value, dict) and (value.get("isError") is True or value.get("error_code") or value.get("error")):
            raise ValueError("Saved provider response reports an error")
        if isinstance(value, dict) and value.get("schema") in SOURCE_SCHEMAS and "files" in value:
            if (expected_sha256 is not None and data.startswith(b"\xef\xbb\xbf")
                    and sha(data) != expected_sha256 and sha(data[3:]) == expected_sha256):
                return data[3:], {}
            return data, {}
        if isinstance(value, dict) and value.get("schema") in (
                "commons.compressed-source-carrier/v1", "commons.artifact-base64/v1"):
            raw, declaration = _carrier_envelope(value)
            nested, _ = _carrier_decode(raw, depth + 1)
            if nested != raw:
                raise ValueError("Encoded source carrier must contain the original JSON bank directly")
            return raw, declaration
        if isinstance(value, list):
            return _carrier_parts(value)
        if not isinstance(value, dict):
            raise ValueError("Expected a complete original source bank")
        if value.get("isError") is True or value.get("error") or value.get("error_code"):
            raise ValueError("Saved provider response reports an error")
        candidates = []
        for key in ("markdown_content", "text_content"):
            if isinstance(value.get(key), str):
                candidates.append(value[key].encode("utf-8"))
        if isinstance(value.get("structuredContent"), (dict, list)):
            candidates.append(json.dumps(value["structuredContent"], ensure_ascii=False,
                                         allow_nan=False).encode("utf-8"))
        content = value.get("content")
        looks_like_payload = lambda text: (
            text.lstrip("\ufeff \t\r\n\u00a0").startswith(("{", "["))
            or chr(96) * 3 + "json" in text)
        if isinstance(content, str):
            if value.get("encoding") == "base64":
                candidates.append(_carrier_base64(content))
            elif looks_like_payload(content):
                candidates.append(content.encode("utf-8"))
        elif isinstance(content, list):
            texts = [item["text"] for item in content if isinstance(item, dict)
                     and item.get("type") == "text" and isinstance(item.get("text"), str)]
            candidates.extend(text.encode("utf-8") for text in texts if looks_like_payload(text))
        if not candidates:
            raise ValueError("Saved provider response contains no complete source payload")
        recovered = [_carrier_decode(candidate, depth + 1, expected_sha256) for candidate in candidates]
        if any(item[0] != recovered[0][0] for item in recovered[1:]):
            raise ValueError("Saved provider response contains conflicting source payloads")
        return recovered[0]
    fences = re.findall(r"(?m)^[ \t]*" + chr(96) * 3 +
                        r"json[ \t]*\r?\n([\s\S]*?)^[ \t]*" + chr(96) * 3 +
                        r"[ \t]*\r?$", body)
    if not fences:
        raise ValueError("Save the complete JSON source bank or all JSON parts in its Canvas")
    items = [_carrier_json(fence) for fence in fences]
    if all(isinstance(item, dict) and item.get("schema") in (
            "commons.compressed-source-part/v1", "commons.source-base64-part.v1")
           for item in items):
        return _carrier_parts(items)
    if len(fences) == 1:
        fenced = fences[0].encode("utf-8")
        # A closing Markdown fence contributes one framing newline. Remove it
        # only when the supplied original bank hash proves that exact boundary.
        if (expected_sha256 is not None and isinstance(items[0], dict)
                and items[0].get("schema") in SOURCE_SCHEMAS
                and "files" in items[0] and sha(fenced) != expected_sha256):
            trim = 2 if fenced.endswith(b"\r\n") else 1 if fenced.endswith(b"\n") else 0
            candidates = [fenced[:-trim]] if trim else []
            if fenced.startswith(b"\xef\xbb\xbf"):
                candidates.append(fenced[3:])
                if trim:
                    candidates.append(fenced[3:-trim])
            matches = [candidate for candidate in candidates if sha(candidate) == expected_sha256]
            if matches:
                fenced = matches[0]
        return _carrier_decode(fenced, depth + 1, expected_sha256)
    raise ValueError("Choose one original bank or one complete numbered carrier per input")


def _carrier_inventory(source):
    if (not isinstance(source, dict) or source.get("schema") not in SOURCE_SCHEMAS
            or not isinstance(source.get("files"), (dict, list))):
        raise ValueError("Unexpected complete source-bank schema")
    raw, metadata = source["files"], source.get("file_metadata", {})
    if isinstance(raw, dict):
        if raw and all(isinstance(value, dict) for value in raw.values()):
            if metadata:
                raise ValueError("Choose one source member metadata representation")
            entries = [{**value, "path": name} for name, value in raw.items()]
        else:
            if not isinstance(metadata, dict) or set(raw) != set(metadata):
                raise ValueError("Complete source-map metadata differs")
            entries = [{**metadata[name], "path": name, "content": value}
                       for name, value in raw.items()]
    else:
        entries = raw
    binary = source.get("binary_files", [])
    if not isinstance(binary, list):
        raise ValueError("Original binary source members must be a list")
    entries = [*entries, *binary]
    if not 1 <= len(entries) <= CARRIER_FILES:
        raise ValueError("Invalid complete source member count")
    normalized, seen, modes, source_bytes = [], {}, {}, 0
    for item in entries:
        if not isinstance(item, dict):
            raise ValueError("Expected a complete original source member")
        name = item.get("path")
        target(Path("/"), name)
        folded = name.casefold()
        if folded in seen:
            raise ValueError("Repeated or aliased original source path: " + name)
        seen[folded] = name
        if (item.get("mode") is not None and item.get("git_mode") is not None
                and item["mode"] != item["git_mode"]):
            raise ValueError("Conflicting original source file modes: " + name)
        mode = next((item[field] for field in ("mode", "git_mode")
                     if item.get(field) is not None), "100644")
        if mode not in ("100644", "100755"):
            raise ValueError("Original source mode must be a regular file: " + name)
        if "content_base64" in item:
            data = _carrier_base64(item["content_base64"])
            if "content" in item and (not isinstance(item["content"], str)
                                      or item["content"].encode("utf-8") != data):
                raise ValueError("Conflicting original source body representations: " + name)
        elif item.get("encoding", "utf-8") == "base64":
            data = _carrier_base64(item.get("content"))
        elif item.get("encoding", "utf-8") in ("utf-8", "utf8") and isinstance(item.get("content"), str):
            data = item["content"].encode("utf-8")
        else:
            raise ValueError("Retain the complete original member body: " + name)
        _carrier_check(data, item.get("bytes"), item.get("sha256"), name)
        actual_git = hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()
        for field in ("git_blob", "git_blob_sha", "git_sha"):
            if item.get(field) is not None and item[field] != actual_git:
                raise ValueError("Declared original Git body differs: " + name)
        source_bytes += len(data)
        if source_bytes > CARRIER_LIMIT:
            raise ValueError("Source members exceed the receiving limit")
        normalized.append({**item, "path": name, "bytes": len(data), "sha256": sha(data),
                           "git_blob": actual_git, "mode": mode,
                           "content_base64": base64.b64encode(data).decode("ascii")})
        normalized[-1].pop("content", None)
        normalized[-1]["encoding"] = "base64"
        modes[name] = mode
    for name in seen.values():
        for parent in PurePosixPath(name).parents:
            if str(parent) != "." and str(parent).casefold() in seen:
                raise ValueError("A source file is also a parent directory: " + name)
    for field, actual in (("file_count", len(normalized)), ("source_file_count", len(normalized)),
                          ("source_bytes", source_bytes)):
        if field in source and (type(source[field]) is not int or source[field] != actual):
            raise ValueError("Original source-bank inventory differs: " + field)
    bank = {**source, "schema": "commons.source-bank/v1", "files": normalized,
            "file_count": len(normalized), "source_bytes": source_bytes}
    bank.pop("file_metadata", None)
    bank.pop("binary_files", None)
    inventory = source_inventory(bank)
    compiled = []
    for name, data, _ in inventory:
        if name.endswith(".py"):
            compile(data, name, "exec", dont_inherit=True)
            compiled.append(name)
    return bank, inventory, modes, compiled


def _carrier_plain_path(path):
    path = Path(path).absolute()
    for part in [path, *path.parents]:
        if part.is_symlink():
            raise ValueError("Carrier staging must not use a symlink: " + str(part))
    return path


def _carrier_roots(output, application, workspace):
    output = _carrier_plain_path(output)
    if not output.parent.is_dir():
        raise ValueError("Create the owned staging parent before receiving sources")
    for selected in (application, workspace):
        protected = _carrier_plain_path(selected).resolve(strict=False)
        if protected.exists() and not protected.is_dir():
            raise ValueError("An existing protected application or Workspace root must be a directory")
        resolved = output.resolve(strict=False)
        if resolved == protected or resolved.is_relative_to(protected) or protected.is_relative_to(resolved):
            raise ValueError("Source staging must be outside and separate from application and Workspace")
    return output


def _carrier_original(path):
    path = _carrier_plain_path(path)
    initial = path.lstat()
    if not stat.S_ISREG(initial.st_mode):
        raise ValueError("Choose a retained regular source carrier")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > CARRIER_LIMIT:
            raise ValueError("Choose a retained regular source carrier within the receiving limit")
        body = stream.read(CARRIER_LIMIT + 1)
        after = os.fstat(stream.fileno())
    signature = lambda value: (value.st_dev, value.st_ino, value.st_size,
                               value.st_mtime_ns, value.st_ctime_ns)
    if (len(body) > CARRIER_LIMIT or signature(initial) != signature(before)
            or signature(before) != signature(after)
            or signature(after) != signature(_carrier_plain_path(path).lstat())):
        raise ValueError("Original source carrier changed during reading")
    return body


def _carrier_verify(root, expected, modes):
    root = _carrier_plain_path(root)
    if not root.is_dir():
        raise ValueError("Expected the original complete staging directory")
    found = set()
    for parent, directories, files in os.walk(root, followlinks=False):
        for name in directories:
            if (Path(parent) / name).is_symlink():
                raise ValueError("A source staging directory became a symlink")
        for name in files:
            path = Path(parent) / name
            relative = path.relative_to(root).as_posix()
            if relative not in expected or _carrier_original(path) != expected[relative]:
                raise ValueError("Source staging differs from the original bank: " + relative)
            wanted = modes.get(relative, "100644")
            if stat.S_IMODE(path.stat().st_mode) != (0o755 if wanted == "100755" else 0o644):
                raise ValueError("Original source file mode differs: " + relative)
            found.add(relative)
    if found != set(expected):
        raise ValueError("Source staging is missing original members")


def _carrier_publish_directory(pending, output):
    # Same Linux no-replace operation used by application_assembly.py.
    libc = ctypes.CDLL(None, use_errno=True)
    rename = getattr(libc, "renameat2", None)
    if rename is None:
        raise OSError(errno.ENOSYS, "Linux renameat2 is required for atomic source staging")
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(pending), -100, os.fsencode(output), 1) != 0:
        failure = ctypes.get_errno()
        raise OSError(failure, os.strerror(failure), str(output))


def receive_carrier(carrier_path, output, *, application, workspace, expected_sha256=None):
    raw_carrier = _carrier_original(carrier_path)
    original, declaration = _carrier_decode(raw_carrier, expected_sha256=expected_sha256)
    if expected_sha256 is not None:
        _carrier_check(original, len(original), expected_sha256, "selected original source bank")
    source = _carrier_json(original.decode("utf-8"))
    normalized, inventory, modes, compiled = _carrier_inventory(source)
    for field, actual in (("file_count", len(inventory)),
                          ("source_bytes", sum(len(data) for _, data, _ in inventory))):
        if field in declaration and (type(declaration[field]) is not int or declaration[field] != actual):
            raise ValueError("Original carrier inventory differs: " + field)
    output = _carrier_roots(output, application, workspace)
    normalized["original_bank"] = {"bytes": len(original), "sha256": sha(original),
                                   "schema": source["schema"]}
    encoded = (json.dumps(normalized, ensure_ascii=False, sort_keys=True, indent=2,
                          allow_nan=False) + "\n").encode("utf-8")
    if len(encoded) > CARRIER_LIMIT:
        raise ValueError("Normalized complete source bank exceeds the receiving limit")
    result = {"schema": "commons.source-bank-receiving/v1", "state": "complete",
              "operation_id": source.get("operation_id") or "source-" + sha(original),
              "directory": str(output), "source": str(output / "source"),
              "file_count": len(inventory),
              "source_bytes": sum(len(data) for _, data, _ in inventory),
              "banks": [{"name": "original", "bytes": len(original),
                         "sha256": sha(original), "files": len(inventory)}],
              "files": [{**metadata, "mode": modes[name]} for name, _, metadata in inventory],
              "original_bank": "banks/original.json", "source_bank": "source-bank.json",
              "carrier": {"bytes": len(raw_carrier), "sha256": sha(raw_carrier)},
              "python_compiled": compiled, "installation_requested": False}
    expected = {"source/" + name: data for name, data, _ in inventory}
    expected["banks/original.json"] = original
    expected["source-bank.json"] = encoded
    expected["receiving.json"] = (json.dumps(result, ensure_ascii=False, sort_keys=True,
                                           indent=2) + "\n").encode("utf-8")
    expected_modes = {"source/" + name: mode for name, mode in modes.items()}
    if output.exists():
        _carrier_verify(output, expected, expected_modes)
        return {**result, "reused": True}
    pending = Path(tempfile.mkdtemp(prefix=".source-carrier-", dir=output.parent))
    try:
        for name, data in expected.items():
            path = target(pending, name)
            retain(path, data)
            path.chmod(0o755 if expected_modes.get(name) == "100755" else 0o644)
        _carrier_verify(pending, expected, expected_modes)
        for directory, _, _ in os.walk(pending, topdown=False):
            descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        _carrier_publish_directory(pending, output)
        pending = None
        descriptor = os.open(output.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if pending is not None:
            shutil.rmtree(pending)
    return {**result, "reused": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--manifest", type=Path, help="Original multipart source-transfer manifest")
    selection.add_argument("--bank", type=Path, help="Complete source bank or gzip+base64 artifact envelope")
    selection.add_argument("--carrier", type=Path, help="Complete local JSON/gzip bank or Canvas Markdown/provider export")
    parser.add_argument("--parts", type=Path, help="Original part JSON directory; required with --manifest")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--operation", help="Existing receiving operation ID for --bank; defaults to the exact bank digest")
    parser.add_argument("--bank-bytes", type=int, help="Expected complete input-file byte count")
    parser.add_argument("--bank-sha256", help="Expected complete input-file SHA-256")
    parser.add_argument("--application", type=Path, help="Protected existing or intended application root for --carrier")
    parser.add_argument("--workspace", type=Path, help="Protected existing or intended Workspace root for --carrier")
    parser.add_argument("--expect-source-sha256", help="Exact decoded original-bank SHA256 for --carrier")
    args = parser.parse_args()
    bank_options = (args.operation, args.bank_bytes, args.bank_sha256)
    carrier_options = (args.application, args.workspace, args.expect_source_sha256)
    if args.manifest is not None:
        if args.parts is None:
            parser.error("--manifest requires --parts")
        if any(value is not None for value in bank_options):
            parser.error("--operation, --bank-bytes and --bank-sha256 belong to --bank")
        if any(value is not None for value in carrier_options):
            parser.error("--application, --workspace and --expect-source-sha256 belong to --carrier")
        result = receive(args.manifest, args.parts, args.output)
    elif args.bank is not None:
        if args.parts is not None:
            parser.error("--parts belongs to --manifest")
        if any(value is not None for value in carrier_options):
            parser.error("--application, --workspace and --expect-source-sha256 belong to --carrier")
        result = receive_bank(args.bank, args.output, operation_id=args.operation,
                              expected_bytes=args.bank_bytes, expected_sha256=args.bank_sha256)
    else:
        if args.parts is not None or any(value is not None for value in bank_options):
            parser.error("--carrier does not use --parts or the --bank options")
        if args.application is None or args.workspace is None:
            parser.error("--carrier requires --application and --workspace protected roots")
        try:
            result = receive_carrier(args.carrier, args.output, application=args.application,
                                     workspace=args.workspace, expected_sha256=args.expect_source_sha256)
        except (OSError, ValueError, TypeError, KeyError, SyntaxError, UnicodeError, EOFError) as error:
            print(json.dumps({"state": "error", "type": type(error).__name__,
                              "message": str(error)}, ensure_ascii=False), file=sys.stderr)
            return 1
    print(json.dumps({key: value for key, value in result.items() if key != "files"},
                     ensure_ascii=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
