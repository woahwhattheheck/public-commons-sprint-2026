#!/usr/bin/env python3
"""MIT. Independently verify the scientific ZIP with the standard-library ZIP reader."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import stat
import zipfile

SCHEMA = "starforge.wqx-scientific-job-result.v1"
NAME = re.compile(r"^[A-Za-z0-9._/-]{1,240}$")
LIMIT = 512 * 1024 * 1024

def safe_name(name):
    return bool(NAME.fullmatch(name)) and all(p not in ("", ".", "..") for p in name.split("/"))

def digest_file(path):
    h = hashlib.sha256()
    count = 0
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(262144), b""):
            h.update(chunk)
            count += len(chunk)
    return {"bytes": count, "sha256": h.hexdigest()}

def write_json(path, value):
    data = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.exists():
        if path.is_symlink() or path.read_bytes() != data:
            raise ValueError("An existing archive verification differs: " + str(path))
        return
    temp = path.with_name("." + path.name + "-" + hashlib.sha256(data).hexdigest() + ".tmp")
    if temp.exists():
        if temp.is_symlink() or not temp.is_file():
            raise ValueError("Archive verification temporary path changed")
        temp.unlink()
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.link(temp, path, follow_symlinks=False)
    temp.unlink()

def verify(path, output, selected, extraction_directory=None):
    path = pathlib.Path(path).resolve(strict=True)
    output = pathlib.Path(output).absolute()
    extraction_root = pathlib.Path(extraction_directory).absolute() if extraction_directory else output.parent / "extracted"
    archive = digest_file(path)
    if archive["bytes"] > 64 * 1024 * 1024:
        raise ValueError("Scientific ZIP exceeds its declared result limit")
    with zipfile.ZipFile(path, "r") as reader:
        infos = reader.infolist()
        names = [item.filename for item in infos]
        if len(names) > 128 or len(set(names)) != len(names) or not all(map(safe_name, names)):
            raise ValueError("Scientific ZIP contains invalid or repeated member names")
        logical = sum(item.file_size for item in infos)
        if logical > LIMIT or any(item.file_size > 256 * 1024 * 1024 for item in infos):
            raise ValueError("Scientific ZIP exceeds its expanded size limits")
        for item in infos:
            mode = item.external_attr >> 16
            if item.flag_bits & 1 or item.is_dir() or (stat.S_IFMT(mode) and not stat.S_ISREG(mode)):
                raise ValueError("Scientific ZIP member must be an unencrypted regular file")
        if "manifest.json" not in names or reader.getinfo("manifest.json").file_size > 16 * 1024 * 1024:
            raise ValueError("Scientific ZIP needs its bounded native manifest")
        manifest = json.loads(reader.read("manifest.json").decode("utf-8"))
        if manifest.get("schema") != SCHEMA or not isinstance(manifest.get("members"), list):
            raise ValueError("Scientific ZIP manifest is invalid")
        expected = {item["path"]: item for item in manifest["members"]}
        if len(expected) != len(manifest["members"]) or set(expected) != set(names) - {"manifest.json"}:
            raise ValueError("Scientific ZIP and its manifest name different members")
        observed = []
        for item in infos:
            h = hashlib.sha256()
            count = 0
            with reader.open(item, "r") as stream:
                for chunk in iter(lambda: stream.read(262144), b""):
                    h.update(chunk)
                    count += len(chunk)
            row = {"path": item.filename, "bytes": count, "sha256": h.hexdigest()}
            if count != item.file_size:
                raise ValueError("Scientific ZIP member length differs")
            if item.filename != "manifest.json":
                reference = expected[item.filename]
                if count != reference["bytes"] or row["sha256"] != reference["sha256"]:
                    raise ValueError("Scientific ZIP member differs: " + item.filename)
            observed.append(row)
        for name in selected:
            if name not in ("review/complete-review.json", "open-waters/complete-open-waters.json"):
                raise ValueError("Select a native complete receiving bundle")
            if name not in expected:
                raise ValueError("Selected native receiving bundle is absent")
            destination = extraction_root / name
            destination.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
            reference = expected[name]
            if destination.exists():
                if destination.is_symlink() or digest_file(destination) != {"bytes": reference["bytes"], "sha256": reference["sha256"]}:
                    raise ValueError("A selected receiving bundle already differs")
                continue
            temp = destination.with_name("." + destination.name + "-" + reference["sha256"] + ".extracting")
            if temp.exists():
                if temp.is_symlink() or not temp.is_file():
                    raise ValueError("Receiving extraction temporary path changed")
                temp.unlink()
            fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as target, reader.open(name, "r") as source:
                for chunk in iter(lambda: source.read(262144), b""):
                    target.write(chunk)
                target.flush()
                os.fsync(target.fileno())
            os.link(temp, destination, follow_symlinks=False)
            temp.unlink()
        result = {"schema": "starforge.wqx-scientific-archive-verification.v1", "path": str(path),
                  **archive, "logicalBytes": logical, "members": observed, "manifest": manifest}
        write_json(output, result)
        return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("archive")
    parser.add_argument("--out", required=True)
    parser.add_argument("--extract", action="append", default=[])
    parser.add_argument("--extraction-directory")
    options = parser.parse_args()
    result = verify(options.archive, options.out, options.extract, options.extraction_directory)
    print(json.dumps(result, separators=(",", ":"), ensure_ascii=False))

if __name__ == "__main__":
    main()
