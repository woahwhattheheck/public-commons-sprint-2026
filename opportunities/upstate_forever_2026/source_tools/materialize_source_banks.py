"""Materialize complete retained source banks or small verified gzip parts.

Fetch the transfer manifest and its part Git blobs through the existing managed
connection. Save each part JSON as <git_blob>.json in --parts. This command
reconstructs the exact original banks and a separate complete source directory.
Use --bank for one complete bank or its original gzip+base64 artifact envelope.
Existing differing files are preserved; installation into a working application
remains an explicit composition of the original source and current local edits.
"""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--manifest", type=Path, help="Original multipart source-transfer manifest")
    selection.add_argument("--bank", type=Path, help="Complete source bank or gzip+base64 artifact envelope")
    parser.add_argument("--parts", type=Path, help="Original part JSON directory; required with --manifest")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--operation", help="Existing receiving operation ID for --bank; defaults to the exact bank digest")
    parser.add_argument("--bank-bytes", type=int, help="Expected complete input-file byte count")
    parser.add_argument("--bank-sha256", help="Expected complete input-file SHA-256")
    args = parser.parse_args()
    if args.manifest is not None:
        if args.parts is None:
            parser.error("--manifest requires --parts")
        if any(value is not None for value in (args.operation, args.bank_bytes, args.bank_sha256)):
            parser.error("--operation, --bank-bytes and --bank-sha256 belong to --bank")
        result = receive(args.manifest, args.parts, args.output)
    else:
        if args.parts is not None:
            parser.error("--parts belongs to --manifest")
        result = receive_bank(args.bank, args.output, operation_id=args.operation,
                              expected_bytes=args.bank_bytes, expected_sha256=args.bank_sha256)
    print(json.dumps({key: value for key, value in result.items() if key != "files"},
                     ensure_ascii=False, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
