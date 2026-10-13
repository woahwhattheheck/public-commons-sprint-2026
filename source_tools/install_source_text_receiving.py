#!/usr/bin/env python3
"""Install the guarded original-source text repair into the current assembler."""
from __future__ import annotations
import argparse
import ast
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

TARGETS = {
    "source_tools/application_assembly.py",
    "source_tools/APPLICATION_SOURCE_TEXT_RECEIVING.md",
}
SELF = "source_tools/install_source_text_receiving.py"


def digest(body):
    return hashlib.sha256(body).hexdigest()


def write_atomic(path, body, mode):
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def prepare(application, packet):
    if packet.get("schema") != "upstate.selected-model-source/v1":
        raise ValueError("Select the original complete source-text repair packet")
    files = packet.get("files")
    if not isinstance(files, list):
        raise ValueError("Source packet requires its complete file inventory")
    paths = [entry.get("path") for entry in files]
    if len(paths) != len(set(paths)) or set(paths) != TARGETS | {SELF}:
        raise ValueError("The exact assembler, guide and installer are required")
    prepared = []
    for entry in files:
        name = entry["path"]
        desired = base64.b64decode(entry["content_base64"], validate=True)
        if len(desired) != entry.get("bytes") or digest(desired) != entry.get("sha256"):
            raise ValueError("Published complete source differs: " + name)
        if name == SELF:
            if Path(__file__).read_bytes() != desired:
                raise ValueError("Run the installer from this exact retained packet")
            continue
        target = application / name
        if (target.is_symlink() or any(p.is_symlink() for p in target.parents
                                       if p != application.parent)
                or not target.resolve().is_relative_to(application)):
            raise ValueError("Receiving path aliases another directory: " + name)
        before = target.read_bytes() if target.exists() else None
        current = digest(before) if before is not None else None
        if current == entry["sha256"]:
            after, method = before, "already_current"
        elif name.endswith(".md"):
            known = {entry.get("base_sha256"), *entry.get("compatible_base_sha256", [])}
            if before is not None and current not in known:
                raise ValueError("Retained receiving guide has another edition")
            after, method = desired, "complete_guide"
        elif current == entry.get("base_sha256"):
            after, method = desired, "exact_current_postimage"
        elif before is None:
            raise ValueError("Receive the current complete application assembler first")
        else:
            source = before.decode("utf-8")
            for join in entry["joins"]:
                old, new = join["before"], join["after"]
                if source.count(new) == 1 and (source.count(old) == 0 or old in new):
                    continue
                if source.count(old) != 1:
                    raise ValueError("Current assembler join differs: " + join["label"])
                source = source.replace(old, new, 1)
            after, method = source.encode("utf-8"), "composed_current_source"
        if name.endswith(".py"):
            ast.parse(after.decode("utf-8"), filename=name)
        prepared.append((target, before, after, method))
    return prepared


def install(application, packet_path):
    application = application.resolve(strict=True)
    if not (application / "model/workspace.py").is_file():
        raise ValueError("Choose the complete original application directory")
    packet_body = packet_path.read_bytes()
    packet = json.loads(packet_body.decode("utf-8"))
    marker = application / ".source-text-receiving.lock"
    if marker.is_symlink():
        raise ValueError("Receiving lock is an alias")
    with marker.open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        prepared = prepare(application, packet)
        outputs = []
        for path, before, after, method in prepared:
            name = path.relative_to(application).as_posix()
            if before != after:
                observed = path.read_bytes() if path.exists() else None
                if observed != before:
                    raise ValueError("Current source changed during receiving: " + name)
                if before is not None:
                    backup = path.with_name(path.name + ".before-text-repair-" + digest(before))
                    if backup.exists():
                        if backup.is_symlink() or backup.read_bytes() != before:
                            raise ValueError("Original receiving backup differs: " + name)
                    else:
                        with backup.open("xb") as stream:
                            stream.write(before)
                            stream.flush()
                            os.fsync(stream.fileno())
                mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644
                write_atomic(path, after, mode)
            if path.read_bytes() != after:
                raise ValueError("Installed source readback differs: " + name)
            outputs.append({"path": name, "bytes": len(after), "sha256": digest(after),
                            "method": method, "previous_sha256": digest(before) if before else None})
        return {"schema": "upstate.source-text-receiving/v1", "application": str(application),
                "packet_sha256": digest(packet_body), "files": outputs}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--packet", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.packet), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
