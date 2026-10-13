"""Stage the exact original calibration source edition without editing the application."""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tempfile

MANIFEST = "calibration_station_geography.sources.json"
MANIFEST_SHA256 = "b88243132759a1737c68d06dd93a5e046e13738ac060de91ba5c06f44e4b1fc9"
SNAPSHOT = "observations/observed_report_regional_20261013/source/hydrology-huc05-07-20261013/"
FROZEN = {SNAPSHOT + name for name in
          ("calibration_context.mjs", "calibration-inputs.json", "model-sources.json", "README.md")}


def member(root, name):
    relative = PurePosixPath(name)
    if (not name or "\\" in name or relative.is_absolute()
            or relative.as_posix() != name or ".." in relative.parts):
        raise ValueError("Invalid original source member: " + name)
    target = root.joinpath(*relative.parts)
    if not target.resolve().is_relative_to(root) or target.is_symlink():
        raise ValueError("Original source member leaves its directory: " + name)
    return target


def state(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def verified_copy(source, target, definition):
    source = Path(source)
    descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    temporary = None
    try:
        with os.fdopen(descriptor, "rb") as incoming:
            before = os.fstat(incoming.fileno())
            if not stat.S_ISREG(before.st_mode):
                raise ValueError("Original source is not a regular file: " + str(source))
            target.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".source-", delete=False) as out:
                temporary = Path(out.name)
                checksum, count = hashlib.sha256(), 0
                for block in iter(lambda: incoming.read(1024 * 1024), b""):
                    out.write(block)
                    checksum.update(block)
                    count += len(block)
                out.flush()
                os.fsync(out.fileno())
            if (state(os.fstat(incoming.fileno())) != state(before)
                    or state(source.lstat()) != state(before)
                    or checksum.hexdigest() != definition["sha256"]
                    or count != before.st_size
                    or (definition.get("bytes") is not None and count != definition["bytes"])):
                raise ValueError("Original source identity differs: " + str(source))
        # The operation lock serializes this owned staging directory. An existing
        # differing member is never replaced; source and application are read-only.
        if target.exists():
            if target.is_symlink() or not target.is_file():
                raise ValueError("Existing staged source is not an ordinary file")
            actual = hashlib.sha256()
            with target.open("rb") as retained:
                for block in iter(lambda: retained.read(1024 * 1024), b""):
                    actual.update(block)
            if target.stat().st_size != count or actual.hexdigest() != definition["sha256"]:
                raise ValueError("Preserve the differing staged source: " + str(target))
            return
        os.link(temporary, target)
        sync_directory(target.parent)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
            sync_directory(temporary.parent)


def prepare(application, output):
    application = Path(application).resolve(strict=True)
    bank = Path(__file__).resolve().parent
    output = Path(output).absolute()
    if output.is_symlink():
        raise ValueError("Choose an owned ordinary staging directory")
    output.mkdir(parents=True, exist_ok=True)
    output = output.resolve()
    if output == application or output.is_relative_to(application) or application.is_relative_to(output):
        raise ValueError("Stage original sources outside the running application")
    manifest_path = bank / MANIFEST
    raw = manifest_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != MANIFEST_SHA256:
        raise ValueError("The canonical original calibration manifest differs")
    manifest = json.loads(raw)
    if manifest.get("schema") != "upstate.sources/v1" or len(manifest.get("entries", [])) != 4:
        raise ValueError("Choose the original four-entry calibration source edition")
    definitions = {}
    for entry in manifest["entries"]:
        for definition in [entry, *entry.get("companions", [])]:
            name = definition["path"]
            member(output, name)
            previous = definitions.get(name)
            if previous and (previous["sha256"] != definition["sha256"]
                             or previous.get("bytes") != definition.get("bytes")):
                raise ValueError("Conflicting original source member: " + name)
            definitions[name] = definition
    if len(definitions) != 59 or not FROZEN.issubset(definitions):
        raise ValueError("The original 59-member calibration source inventory differs")
    # The existing prepared-study resolver binds the exact original manifest.
    # This guard reports an older code/spec prerequisite without editing it.
    recipe_path = application / "model/observed_station_studies.json"
    recipe = json.loads(recipe_path.read_bytes())
    for entry in manifest["entries"]:
        matches = [item for item in recipe.get("sources", {}).values()
                   if item.get("sha256") == entry["sha256"]]
        if not matches or any(item.get("source_manifest_sha256") != MANIFEST_SHA256 for item in matches):
            raise ValueError("Receive the existing 3571 study recipe before intake: " + entry["id"])
    lock = output / ".calibration-source.lock"
    if lock.is_symlink():
        raise ValueError("Staging lock is not an ordinary file")
    with lock.open("a+b") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        for name, definition in sorted(definitions.items()):
            root = bank if name in FROZEN else application
            verified_copy(member(root, name), member(output, name), definition)
        # Publish the unchanged original manifest only after all original members.
        verified_copy(manifest_path, output / MANIFEST,
                      {"sha256": MANIFEST_SHA256, "bytes": len(raw)})
    return {"stage": "CALIBRATION_SOURCE_READY", "application": str(application),
            "source_root": str(output), "manifest": str(output / MANIFEST),
            "manifest_sha256": MANIFEST_SHA256, "original_members": len(definitions),
            "frozen_companions": sorted(FROZEN), "application_modified": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.application, args.output), sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
