"""Materialize complete retained source banks from small verified gzip parts.

Fetch the transfer manifest and its part Git blobs through the existing managed
connection. Save each part JSON as <git_blob>.json in --parts. This command
reconstructs the exact original banks and a separate complete source directory.
Existing differing files are preserved; installation into a working application
remains an explicit composition of the original source and current local edits.
"""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
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


def document(path):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    # Accept a saved native structured tool result as well as its direct body.
    for _ in range(12):
        if isinstance(value, dict) and isinstance(value.get("schema"), str):
            return value
        if isinstance(value, dict) and isinstance(value.get("structuredContent"), dict):
            value = value["structuredContent"]
            continue
        if isinstance(value, dict) and isinstance(value.get("content"), str):
            text = value["content"]
            if value.get("encoding") == "base64":
                text = base64.b64decode(text).decode("utf-8")
            value = json.loads(text)
            continue
        if isinstance(value, dict) and isinstance(value.get("content"), list):
            text = [item["text"] for item in value["content"]
                    if isinstance(item, dict) and item.get("type") == "text"]
            if len(text) == 1:
                value = json.loads(text[0])
                continue
        break
    raise ValueError("Save the complete original JSON tool body: " + str(path))


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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--parts", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = receive(args.manifest, args.parts, args.output)
    print(json.dumps({key: value for key, value in result.items() if key != "files"},
                     ensure_ascii=False, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
