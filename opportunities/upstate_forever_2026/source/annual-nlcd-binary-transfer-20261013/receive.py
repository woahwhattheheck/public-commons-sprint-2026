"""Reconstruct exact published native TIFFs from ordinary UTF-8 Git parts."""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import tempfile


def checked_path(root, name):
    if not isinstance(name, str) or not name or "\\" in name:
        raise ValueError("Expected a relative POSIX member path")
    value = Path(name)
    if value.is_absolute() or ".." in value.parts:
        raise ValueError("Member escapes its receiving root: " + name)
    result = (root / value).resolve()
    if not result.is_relative_to(root):
        raise ValueError("Member resolves outside its receiving root: " + name)
    return result


def identity(path):
    sha = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
            size += len(block)
    return size, sha.hexdigest()


def matches(path, member):
    return path.is_file() and identity(path) == (member["bytes"], member["sha256"])


def validate_member(path, member):
    if not matches(path, member):
        raise ValueError("Received bytes differ for " + str(path))


def receive(manifest_path, application_root, years=None):
    manifest_path = Path(manifest_path).resolve(strict=True)
    transfer_root = manifest_path.parent
    application_root = Path(application_root).resolve()
    manifest = json.loads(manifest_path.read_text("utf-8"))
    if manifest.get("schema") != "upstate.native-landcover-byte-transfer/v1":
        raise ValueError("Select the native land-cover exact-byte transfer manifest")
    selected = [item for item in manifest["rasters"]
                if years is None or item["year"] in years]
    if not selected or (years is not None and set(years) != {x["year"] for x in selected}):
        raise ValueError("Requested year is absent from this source transfer")
    if len({x["year"] for x in selected}) != len(selected):
        raise ValueError("Duplicate annual source identities")
    # Validate all companion bodies and all part identities before publishing TIFFs.
    for member in manifest["source_members"]:
        if member["year"] in {item["year"] for item in selected}:
            validate_member(checked_path(application_root, member["path"]), member)
    for item in selected:
        seen = set()
        total = 0
        for part in item["parts"]:
            if part["path"] in seen:
                raise ValueError("Repeated binary part")
            seen.add(part["path"])
            raw = checked_path(transfer_root, part["path"]).read_bytes()
            if len(raw) != part["bytes"] or hashlib.sha256(raw).hexdigest() != part["sha256"]:
                raise ValueError("Transfer part bytes changed: " + part["path"])
            decoded = base64.b64decode(raw.strip(), validate=True)
            if len(decoded) != part["decoded_bytes"]:
                raise ValueError("Decoded part length differs: " + part["path"])
            total += len(decoded)
        if total != item["bytes"]:
            raise ValueError("Part lengths do not cover the whole original TIFF")
        destination = checked_path(application_root, item["path"])
        if destination.exists() and not matches(destination, item):
            raise ValueError("A different retained TIFF already occupies " + str(destination))
    results = []
    for item in selected:
        destination = checked_path(application_root, item["path"])
        if destination.exists():
            results.append({"year": item["year"], "path": str(destination),
                            "bytes": item["bytes"], "sha256": item["sha256"], "state": "retained"})
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        fd, pending_name = tempfile.mkstemp(prefix=destination.name + ".", suffix=".partial",
                                          dir=destination.parent)
        pending = Path(pending_name)
        try:
            with os.fdopen(fd, "wb") as stream:
                for part in item["parts"]:
                    raw = checked_path(transfer_root, part["path"]).read_bytes()
                    # Recheck immediately before consumption, including unchanged text.
                    if len(raw) != part["bytes"] or hashlib.sha256(raw).hexdigest() != part["sha256"]:
                        raise ValueError("Transfer part changed during receipt")
                    stream.write(base64.b64decode(raw.strip(), validate=True))
                stream.flush()
                os.fsync(stream.fileno())
            validate_member(pending, item)
            # Exclusive publication preserves a concurrently retained different file.
            try:
                os.link(pending, destination)
            except FileExistsError:
                validate_member(destination, item)
            directory_fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            pending.unlink(missing_ok=True)
        results.append({"year": item["year"], "path": str(destination),
                        "bytes": item["bytes"], "sha256": item["sha256"], "state": "complete"})
    return {"schema": "upstate.native-landcover-byte-receipt/v1",
            "operation_id": manifest["operation_id"],
            "transfer_manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
            "rasters": results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path(__file__).with_name("transfer.json"))
    parser.add_argument("--application-root", required=True, type=Path)
    parser.add_argument("--year", type=int, action="append", choices=(2023, 2025))
    args = parser.parse_args()
    print(json.dumps(receive(args.manifest, args.application_root, args.year),
                     ensure_ascii=False, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
