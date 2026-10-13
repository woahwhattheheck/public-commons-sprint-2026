#!/usr/bin/env python3
"""Apply the Upper Savannah selected-model changes to the retained application."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import tempfile

ALLOWED = {"model/common.py", "model/profiles.py", "model/workspace.py", "model/native.py"}

def sha256(value):
    return hashlib.sha256(value).hexdigest()

def prepare(application, packet):
    if packet.get("schema") != "commons.selected-model-core-overlay/v1":
        raise ValueError("Choose the original selected-model source overlay")
    grouped = {}
    for edit in packet["replacements"]:
        name = edit["path"]
        if name not in ALLOWED:
            raise ValueError("Unexpected source path: " + name)
        grouped.setdefault(name, []).append(edit)
    prepared = []
    for name, edits in grouped.items():
        path = application / name
        if path.is_symlink() or not path.resolve(strict=True).is_relative_to(application):
            raise ValueError("Select a regular application source: " + name)
        before_bytes = path.read_bytes()
        body = before_bytes.decode("utf-8")
        for index, edit in enumerate(edits, 1):
            before, after = edit["before"], edit["after"]
            before_count, after_count = body.count(before), body.count(after)
            if before_count == 1 and not (before in after and after_count == 1):
                body = body.replace(before, after, 1)
            elif after_count == 1 and before_count <= 1:
                continue
            else:
                raise ValueError(name + " edit " + str(index) +
                                 " has newer overlapping source; merge this exact change with its owner")
        after_bytes = body.encode("utf-8")
        ast.parse(body, filename=str(path))
        base = packet["base_file_metadata"][name]["sha256"]
        expected = packet["file_metadata"][name]["sha256"]
        if sha256(before_bytes) == base and sha256(after_bytes) != expected:
            raise ValueError("The original-source postimage differs: " + name)
        prepared.append((name, path, before_bytes, after_bytes))
    return prepared

def apply(application, packet, check=False):
    prepared = prepare(application, packet)
    changed = [item for item in prepared if item[2] != item[3]]
    report = [{"path": name, "changed": before != after,
               "before_sha256": sha256(before), "after_sha256": sha256(after)}
              for name, path, before, after in prepared]
    if check:
        return {"mode": "check", "files": report}
    for name, path, before, after in changed:
        if path.read_bytes() != before:
            raise ValueError("Application source changed during preparation: " + name)
    for name, path, before, after in changed:
        backup = path.with_name(path.name + ".before-selected-model-" + sha256(before)[:12])
        if backup.exists() and backup.read_bytes() != before:
            raise ValueError("Existing source backup differs: " + str(backup))
        if not backup.exists():
            with backup.open("xb") as stream:
                stream.write(before)
                stream.flush()
                os.fsync(stream.fileno())
        pending = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix="selected-model-", delete=False) as stream:
                pending = Path(stream.name)
                stream.write(after)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(pending, path.stat().st_mode & 0o777)
            if path.read_bytes() != before:
                raise ValueError("Application source changed before replacement: " + name)
            os.replace(pending, path)
            pending = None
        finally:
            if pending is not None:
                pending.unlink(missing_ok=True)
    return {"mode": "applied", "files": report}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("application", type=Path, help="Existing complete Upper Savannah application")
    parser.add_argument("--packet", type=Path,
                        default=Path(__file__).with_name("selected-model-core-overlay.json"))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    packet = json.loads(args.packet.read_text(encoding="utf-8"))
    result = apply(args.application.resolve(strict=True), packet, check=args.check)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
