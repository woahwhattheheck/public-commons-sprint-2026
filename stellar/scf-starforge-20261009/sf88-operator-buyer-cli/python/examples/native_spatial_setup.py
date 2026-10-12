#!/usr/bin/env python3
"""Receive an exact copy of the original controller for this application's handoff."""
from pathlib import Path, PurePosixPath
import argparse
import json
import tarfile

from native_spatial_receive import OPERATION, identity, private, publish

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--root", required=True)
parser.add_argument("--original-controller-archive", required=True)
arguments = parser.parse_args()
root = private(Path(arguments.root).absolute())
archive = Path(arguments.original_controller_archive)
record = identity(archive)
if record["bytes"] > 1048576 or record["sha256"] != "9ab83b543b260efc13ebabb7e0a6c1474373e3af79ef00a194d6da84d41a55cb":
    raise RuntimeError("The retained original controller archive is required")
for name in ("controller", "control/records", "control/worker", "control/tmp"):
    private(root / name)
files, size = 0, 0
with tarfile.open(archive, "r:gz") as source:
    for item in source:
        name = PurePosixPath(item.name)
        if name.is_absolute() or ".." in name.parts or not name.parts:
            raise RuntimeError("Original controller path differs")
        if name.parts[0] not in {"host", "source-manifest.json", "carrier-manifest.json"}:
            raise RuntimeError("Original controller member differs")
        target = root / "controller" / str(name)
        if item.isdir():
            private(target)
            continue
        if not item.isfile() or item.size > 2 * 1024 * 1024:
            raise RuntimeError("Original controller requires regular source members")
        size += item.size
        if size > 16 * 1024 * 1024:
            raise RuntimeError("Original controller source exceeds its bound")
        with source.extractfile(item) as member:
            raw = member.read(item.size + 1)
        if len(raw) != item.size:
            raise RuntimeError("Incomplete original controller member")
        publish(target, raw)
        files += 1
print(json.dumps({"operation": OPERATION, "state": "SOURCE_READY", "controller": str(root / "controller" / "host"),
                  "original_archive": record, "files": files, "source_bytes": size}), flush=True)
