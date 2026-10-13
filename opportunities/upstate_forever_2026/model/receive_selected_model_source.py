#!/usr/bin/env python3
"""Receive the complete selected-model source into the maintained application."""
from __future__ import annotations
import argparse
import ast
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tempfile

FORMAT = "upstate.selected-model-source/v1"


def sha(value):
    return hashlib.sha256(value).hexdigest()


def target_path(root, name):
    part = PurePosixPath(name)
    if (not isinstance(name, str) or not part.parts or part.is_absolute()
            or str(part) != name or ".." in part.parts or "\\" in name or "\0" in name
            or part.parts[0] not in ("model", "operator")):
        raise ValueError("Use the declared application-relative source path")
    path = root.joinpath(*part.parts)
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError("Selected source path escapes the existing application: " + name)
    return path


def _edits(body, edits, name):
    for edit in edits:
        before, after = edit["before"], edit["after"]
        before_count, after_count = body.count(before), body.count(after)
        if after_count == 1 and (before_count == 0 or before in after):
            continue
        if before_count != 1:
            raise ValueError(name + ": join requires its current source context: " + edit["label"])
        body = body.replace(before, after, 1)
    return body


def prepare(root, packet):
    if packet.get("schema") != FORMAT or not isinstance(packet.get("files"), list):
        raise ValueError("Select the complete original selected-model source packet")
    prepared, seen = [], set()
    for file in packet["files"]:
        name = file["path"]
        if name in seen:
            raise ValueError("Source packet repeats an application path")
        seen.add(name)
        path = target_path(root, name)
        desired = base64.b64decode(file["content_base64"], validate=True)
        if len(desired) != file["bytes"] or sha(desired) != file["sha256"]:
            raise ValueError("Complete source content differs: " + name)
        before = path.read_bytes() if path.exists() else None
        current = sha(before) if before is not None else None
        if current == file["sha256"]:
            after, mode = before, "already_current"
        elif before is None:
            if file.get("base_sha256"):
                raise ValueError("Receive the original complete application first: " + name)
            after, mode = desired, "new_complete_source"
        elif current == file.get("base_sha256") or current in file.get("compatible_base_sha256", []):
            after, mode = desired, "complete_postimage"
        else:
            if not file.get("base_sha256"):
                raise ValueError("A current owner has a different new module: " + name)
            body = before.decode("utf-8")
            # A known predecessor's edits can be joined with unrelated current
            # source. Reversal is in memory; only the composed final file writes.
            candidates = [body]
            for predecessor in file.get("predecessor_replacements", []):
                older = body
                matched = True
                for edit in reversed(predecessor):
                    old, new = edit["before"], edit["after"]
                    if older.count(new) != 1:
                        matched = False
                        break
                    older = older.replace(new, old, 1)
                if matched:
                    candidates.append(older)
            results, errors = [], []
            for candidate in candidates:
                try:
                    if not file.get("joins"):
                        raise ValueError("Current source requires a composed file from its owner: " + name)
                    results.append(_edits(candidate, file["joins"], name))
                except ValueError as error:
                    errors.append(str(error))
            unique = list(dict.fromkeys(results))
            if not unique:
                raise ValueError("; ".join(errors))
            if len(unique) != 1:
                raise ValueError("Current source has ambiguous predecessor joins: " + name)
            after, mode = unique[0].encode("utf-8"), "composed_current_source"
        if name.endswith(".py"):
            ast.parse(after.decode("utf-8"), filename=name)
        prepared.append({"name": name, "path": path, "before": before,
                         "after": after, "mode": mode, "source_sha256": file["sha256"]})
    return prepared


def apply(root, packet):
    root = Path(root).resolve(strict=True)
    lock = root / ".selected-model-receiving.lock"
    with lock.open("a+b") as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        selected = prepare(root, packet)
        for file in selected:
            observed = file["path"].read_bytes() if file["path"].exists() else None
            if observed != file["before"]:
                raise ValueError("Application source changed during receiving: " + file["name"])
        report = []
        for file in selected:
            path, before, after = file["path"], file["before"], file["after"]
            if before != after:
                path.parent.mkdir(parents=True, exist_ok=True)
                pending = None
                try:
                    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".selected-model-", delete=False) as out:
                        pending = Path(out.name)
                        out.write(after)
                        out.flush()
                        os.fsync(out.fileno())
                    os.chmod(pending, path.stat().st_mode & 0o777 if path.exists() else 0o644)
                    observed = path.read_bytes() if path.exists() else None
                    if observed != before:
                        raise ValueError("Application source changed before publication: " + file["name"])
                    os.replace(pending, path)
                    pending = None
                finally:
                    if pending is not None:
                        pending.unlink(missing_ok=True)
            readback = path.read_bytes()
            if readback != after:
                raise ValueError("Published source differs: " + file["name"])
            report.append({"path": file["name"], "mode": file["mode"],
                           "before_sha256": sha(before) if before is not None else None,
                           "source_sha256": file["source_sha256"],
                           "after_sha256": sha(readback), "bytes": len(readback)})
        return {"schema": "upstate.selected-model-receiving/v1",
                "application": str(root), "operation_id": packet["operation_id"], "files": report}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--packet", type=Path, required=True)
    args = parser.parse_args()
    packet = json.loads(args.packet.read_text(encoding="utf-8"))
    print(json.dumps(apply(args.application, packet), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
