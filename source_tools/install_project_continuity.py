"""Carry the current application packages and entry files in native project archives.

This joins the observed cumulative application scope to the original portable
module. The native backup and restore implementations continue to own member
enumeration, original byte retention and semantic receiving.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import tempfile

CURRENT_DIRECTORIES = ("ecsa_runs", "integration", "receiving", "tools")
CURRENT_FILES = (
    "install_experiments.py", "install_extensions.py", "install_terrain.py",
    "receive_application_source.py", "requirements-terrain.txt", "RFP_RESPONSE_MAP.md",
    "START_HERE.md", "TERRAIN_STATIC.md", "terrain-source-manifest.json", "WORKSHARE.md",
)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def apply(application):
    application = Path(application).resolve(strict=True)
    path = application / "model" / "portable.py"
    if path.is_symlink() or not path.is_file():
        raise ValueError("Choose the current original application with model/portable.py")
    before = path.read_bytes()
    text = before.decode("utf-8")
    module = ast.parse(text, filename=str(path))
    server = application / "operator" / "server.py"
    if "from ecsa_runs.upstate import" in server.read_text(encoding="utf-8"):
        if not (application / "ecsa_runs" / "__init__.py").is_file():
            raise ValueError("Receive the original ecsa_runs application package before transferring this native run entry point")
    additions = {
        "APPLICATION_DIRECTORIES": tuple(name for name in CURRENT_DIRECTORIES
                                         if (application / name).is_dir() and not (application / name).is_symlink()),
        "APPLICATION_FILES": tuple(name for name in CURRENT_FILES
                                   if (application / name).is_file() and not (application / name).is_symlink()),
    }
    lines = before.splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))
    edits, changes = [], {}
    for name, available in additions.items():
        nodes = [node for node in module.body if isinstance(node, ast.Assign)
                 and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)
                 and node.targets[0].id == name]
        if len(nodes) != 1:
            raise ValueError("Preserve the current archive scope and locate its original " + name + " assignment")
        node = nodes[0].value
        current = ast.literal_eval(node)
        if not isinstance(current, tuple) or not all(isinstance(item, str) for item in current):
            raise ValueError("The original archive scope must retain its explicit tuple of application members")
        added = [item for item in available if item not in current]
        changes[name] = added
        if added:
            start = offsets[node.lineno - 1] + node.col_offset
            end = offsets[node.end_lineno - 1] + node.end_col_offset
            edits.append((start, end, repr(current + tuple(added)).encode("utf-8")))
    after = before
    for start, end, body in sorted(edits, reverse=True):
        after = after[:start] + body + after[end:]
    ast.parse(after.decode("utf-8"), filename=str(path))
    receipt = {"schema": "upstate.project-continuity-install/v1",
               "application": str(application), "path": str(path),
               "before_sha256": sha(before), "sha256": sha(after),
               "added_directories": changes["APPLICATION_DIRECTORIES"],
               "added_files": changes["APPLICATION_FILES"],
               "state": "already-applied" if after == before else "applied"}
    if after == before:
        return receipt
    history = application.parent / ".upstate-source-history"
    history.mkdir(exist_ok=True)
    backup = history / ("portable-before-continuity-" + sha(before) + ".py")
    try:
        with backup.open("xb") as stream:
            stream.write(before)
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError:
        if backup.is_symlink() or backup.read_bytes() != before:
            raise ValueError("The preserved original archive source differs")
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".continuity-", delete=False) as stream:
            pending = Path(stream.name)
            stream.write(after)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(pending, path.stat().st_mode & 0o777)
        if path.read_bytes() != before:
            raise ValueError("The archive source changed during integration; preserve and compose the newer source")
        os.replace(pending, path)
        pending = None
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)
    receipt["original"] = str(backup)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("application")
    args = parser.parse_args()
    print(json.dumps(apply(args.application), indent=2))


if __name__ == "__main__":
    main()
