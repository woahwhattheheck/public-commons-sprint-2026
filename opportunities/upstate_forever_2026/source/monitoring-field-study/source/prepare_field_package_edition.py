#!/usr/bin/env python3
"""Prepare the corrected complete field-source edition from the retained package.

Copy the original package independently and replace only its root source manifest.
Every original body and nested source manifest remains byte-identical.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile

ORIGINAL = "e4fddfb4837676f96e8722f05b582b8cdc7f186cb20dd5fe050636aff090f7db"
CORRECTED = "b74f7c459ce08508d500970bba7196831c48cb5529e9ad01e007856b6d43fd5d"
MISSING = {
    "original/b795ec76a4a2b67b21415baedaf0bc0629eb8acb323bb9ff5b16659e40cd9dc7/utility-ecoli-observations/source-manifest.json",
    "original/5c1835b235f6508c282efe64684da5aaffbfadb18803939020732ef0af118e64/utility-ecoli-native-wgs84/original/source-manifest.json",
    "original/5c1835b235f6508c282efe64684da5aaffbfadb18803939020732ef0af118e64/utility-ecoli-native-nad83/original/source-manifest.json",
}


def fingerprint(path):
    checksum, count = hashlib.sha256(), 0
    before = path.stat()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
            count += len(block)
    after = path.stat()
    fields = lambda value: (value.st_dev, value.st_ino, value.st_size,
                            value.st_mtime_ns, value.st_ctime_ns)
    if fields(before) != fields(after) or count != before.st_size:
        raise ValueError("Original file changed while reading: " + str(path))
    return {"bytes": count, "sha256": checksum.hexdigest()}


def member(root, relative):
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise ValueError("Choose an ordinary package-relative file")
    parts = PurePosixPath(relative)
    if parts.is_absolute() or any(x in {"", ".", ".."} for x in relative.split("/")):
        raise ValueError("The package member leaves its original directory")
    target = root
    for part in parts.parts:
        target = target / part
        mode = target.lstat().st_mode
        if stat.S_ISLNK(mode):
            raise ValueError("Original package members must not be symbolic links")
    if not stat.S_ISREG(target.stat().st_mode):
        raise ValueError("Original package member is not a regular file")
    return target


def inventory(root):
    records = {}
    for path in sorted(root.rglob("*")):
        mode = path.lstat().st_mode
        if stat.S_ISDIR(mode):
            continue
        relative = path.relative_to(root).as_posix()
        records[relative] = fingerprint(member(root, relative))
    return records


def verify_manifest(root, document):
    entries = document.get("entries")
    if not isinstance(entries, list) or len(entries) != 2:
        raise ValueError("Choose the original two-entry field-source manifest")
    checked = {}
    for entry in entries:
        references = [{"path": entry["path"], "sha256": entry["sha256"]},
                      *entry["companions"]]
        for selected in references:
            name = selected["path"]
            if name == "source-manifest.json":
                raise ValueError("Only the package-root self-manifest is excluded")
            actual = checked.setdefault(name, None)
            if actual is None:
                actual = fingerprint(member(root, name))
                checked[name] = actual
            if actual["sha256"] != selected["sha256"]:
                raise ValueError("Original source bytes differ: " + name)
    return checked


def prepare(source, manifest, output):
    source = source.resolve(strict=True)
    manifest = manifest.resolve(strict=True)
    output = output.absolute()
    if output.exists():
        output = output.resolve(strict=True)
    else:
        output = output.parent.resolve(strict=True) / output.name
    if source == output or source.is_relative_to(output) or output.is_relative_to(source):
        raise ValueError("Keep the new field edition outside the original package")
    if manifest == output or manifest.is_relative_to(output):
        raise ValueError("Keep the selected manifest outside the new edition")
    original_path = member(source, "source-manifest.json")
    if fingerprint(original_path)["sha256"] != ORIGINAL:
        raise ValueError("Choose the exact retained original field package")
    if fingerprint(manifest)["sha256"] != CORRECTED:
        raise ValueError("Choose the exact corrected 226-companion source manifest")
    original = json.loads(original_path.read_text("utf-8"))
    corrected = json.loads(manifest.read_text("utf-8"))
    if {k: v for k, v in original.items() if k != "entries"} != {
            k: v for k, v in corrected.items() if k != "entries"}:
        raise ValueError("The correction changes original package metadata")
    if len(original["entries"]) != len(corrected["entries"]):
        raise ValueError("The correction changes the original source entries")
    for old, new in zip(original["entries"], corrected["entries"]):
        if {k: v for k, v in old.items() if k != "companions"} != {
                k: v for k, v in new.items() if k != "companions"}:
            raise ValueError("The correction changes an original source body")
        before, after = old["companions"], new["companions"]
        if len(before) != 223 or len(after) != 226 or after[:223] != before:
            raise ValueError("The correction must retain every original companion")
        if {row["path"] for row in after[223:]} != MISSING:
            raise ValueError("The correction must add the three original nested manifests")
    verify_manifest(source, corrected)
    expected = inventory(source)
    expected["source-manifest.json"] = fingerprint(manifest)
    if output.exists():
        if not output.is_dir() or inventory(output) != expected:
            raise ValueError("The receiving directory contains a different edition")
        verify_manifest(output, corrected)
        return {"directory": str(output), "files": len(expected),
                "manifest_sha256": CORRECTED, "reused": True}
    # The pending directory is an owned temporary copy. It is never the original.
    stage = Path(tempfile.mkdtemp(prefix=".field-edition-", dir=output.parent))
    try:
        for name, identity in expected.items():
            selected = manifest if name == "source-manifest.json" else member(source, name)
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with selected.open("rb") as src, target.open("xb") as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
                dst.flush()
                os.fsync(dst.fileno())
            if fingerprint(target) != identity:
                raise ValueError("Source changed during independent copy: " + name)
        if inventory(stage) != expected:
            raise ValueError("The complete new edition differs from its selected source")
        verify_manifest(stage, corrected)
        if output.exists():
            raise ValueError("The receiving destination appeared during preparation")
        os.rename(stage, output)
        stage = None
        return {"directory": str(output), "files": len(expected),
                "manifest_sha256": CORRECTED, "reused": False}
    finally:
        if stage is not None:
            shutil.rmtree(stage)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", required=True, type=Path,
                        help="Complete unchanged extracted original field package")
    parser.add_argument("--manifest", type=Path,
                        default=Path(__file__).resolve().parents[1] / "source-manifest.json")
    parser.add_argument("--output", required=True, type=Path,
                        help="Independent new package directory; parent must exist")
    args = parser.parse_args()
    print(json.dumps(prepare(args.package, args.manifest, args.output), indent=2))


if __name__ == "__main__":
    main()
