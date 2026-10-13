#!/usr/bin/env python3
"""Materialize a published-study source bank from its raw JSON or Slack Canvas Markdown."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bank")
    parser.add_argument("destination")
    args = parser.parse_args()
    raw = Path(args.bank).read_text(encoding="utf-8-sig").replace("\u00a0", " ")
    try:
        bank = json.loads(raw)
    except json.JSONDecodeError:
        blocks = re.findall(r"(?ms)^\x60{3}json[ \t]*\n(.*?)^\x60{3}", raw)
        banks = [json.loads(block) for block in blocks]
        bank = next(item for item in banks if item.get("schema") == "commons.source-bank/v1")
    if bank.get("schema") != "commons.source-bank/v1":
        raise SystemExit("Expected commons.source-bank/v1.")
    root = Path(args.destination).resolve()
    files, paths = [], set()
    for entry in bank["files"]:
        relative = entry["path"]
        path = PurePosixPath(relative)
        if not relative or "\\" in relative or "\x00" in relative or path.is_absolute() or ".." in path.parts or str(path) != relative:
            raise SystemExit("Unsafe source path: " + relative)
        if relative in paths:
            raise SystemExit("Duplicate source path: " + relative)
        paths.add(relative)
        data = base64.b64decode(entry["content_base64"], validate=True)
        if len(data) != entry["bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise SystemExit("Source checksum mismatch: " + relative)
        target = (root / relative).resolve()
        if not target.is_relative_to(root):
            raise SystemExit("Source path leaves destination: " + relative)
        files.append((relative, target, data))
    for relative, target, data in files:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_file() and target.read_bytes() == data:
            continue
        fd, temporary = tempfile.mkstemp(prefix="." + target.name + "-", dir=target.parent)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(data)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    print(json.dumps({
        "operation_id": bank.get("operation_id"), "destination": str(root),
        "files": len(files), "source_bytes": sum(len(data) for _, _, data in files),
    }, indent=2))


if __name__ == "__main__":
    main()
