#!/usr/bin/env python3
"""Join native-study Programme export into the current maintained application."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import tempfile

TARGETS = {"model/compute_programme.py", "operator/web/programmes.mjs"}

def install(application, source=None):
    root = Path(application).resolve(strict=True)
    source = Path(source or root).resolve(strict=True)
    packet = json.loads((source / "operator/programme_study_patch.json").read_text())
    if packet.get("schema") != "commons.guarded-source-edits/v1":
        raise ValueError("Select the complete native-study Programme source edits")
    edits = packet.get("edits")
    if not isinstance(edits, list) or not edits:
        raise ValueError("The Programme source edit set is empty")
    original, changed = {}, {}
    for edit in edits:
        name = edit.get("path")
        if name not in TARGETS:
            raise ValueError("The Programme source edit names an unexpected target")
        path = (root / name).resolve(strict=True)
        if not path.is_relative_to(root):
            raise ValueError("Programme source target leaves the application")
        if name not in original:
            original[name] = path.read_bytes()
            changed[name] = original[name].decode("utf-8")
        text = changed[name]
        before, after = edit.get("before"), edit.get("after")
        if not isinstance(before, str) or not before or not isinstance(after, str) or not after:
            raise ValueError("Retain the complete ordered source anchors")
        if text.count(after) == 1:
            continue
        if text.count(before) != 1:
            raise ValueError("Current Programme source needs reconciliation: " + name +
                             " / " + before[:100])
        changed[name] = text.replace(before, after, 1)
    if set(changed) != TARGETS:
        raise ValueError("Retain both the original Programme engine and browser edits")
    ast.parse(changed["model/compute_programme.py"])
    results = []
    for name, text in changed.items():
        body = text.encode("utf-8")
        path = root / name
        if body == original[name]:
            results.append({"path": name, "changed": False})
            continue
        previous = hashlib.sha256(original[name]).hexdigest()
        backup = root / ".component-preimages/programme-native-study" / previous / name
        backup.parent.mkdir(parents=True, exist_ok=True)
        if backup.exists() and backup.read_bytes() != original[name]:
            raise ValueError("The original Programme preimage differs")
        if not backup.exists():
            with backup.open("xb") as stream:
                stream.write(original[name])
        if path.read_bytes() != original[name]:
            raise ValueError("Programme source changed after the complete preflight: " + name)
        fd, temporary = tempfile.mkstemp(prefix=".programme-native-study-", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(body)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, path.stat().st_mode & 0o777)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        results.append({"path": name, "changed": True, "sha256": hashlib.sha256(body).hexdigest(),
                        "bytes": len(body), "previous_sha256": previous})
    return {"schema": "upstate.programme-native-study-install/v1",
            "application": str(root), "files": results}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source")
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source), sort_keys=True))

if __name__ == "__main__":
    main()
