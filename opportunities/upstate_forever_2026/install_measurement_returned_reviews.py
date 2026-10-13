#!/usr/bin/env python3
"""Add returned-review receiving without replacing the original native application."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile

MANIFEST = "MEASUREMENT_RETURNED_REVIEWS_SOURCE.json"
PREFIXES = ("measurement_workspace/engine/returned_review", "checks/returned_review", "source_tools/print_measurement_return.py")
EXACT = {"install_measurement_returned_reviews.py", "MEASUREMENT_RETURNED_REVIEWS.md", "integration/component_fragments/measurement-returned-reviews.json"}


def sha(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def member(root: Path, name: str) -> Path:
    if not isinstance(name, str) or not name or "\\" in name or name.startswith("/") or any(x in {"", ".", ".."} or ":" in x for x in name.split("/")):
        raise ValueError("Choose an ordinary relative source path")
    target = root / name
    current = target
    while current != root:
        if current.is_symlink():
            raise ValueError("Installation cannot cross a symbolic link: " + name)
        current = current.parent
    return target


def install(application: Path, source_root: Path, check: bool = False) -> dict:
    root, source = application.resolve(strict=True), source_root.resolve(strict=True)
    metadata = json.loads((source / MANIFEST).read_text("utf-8"))
    if metadata.get("format") != "upper-savannah-measurement-returned-source/v1":
        raise ValueError("Unknown complete source inventory")
    bodies: dict[str, bytes] = {}
    for record in metadata["files"]:
        name = record["path"]
        if name in bodies or not (name in EXACT or name.startswith(PREFIXES)):
            raise ValueError("Unexpected or duplicate component source: " + name)
        body = member(source, name).read_bytes()
        if len(body) != record["bytes"] or sha(body) != record["sha256"]:
            raise ValueError("Complete source differs: " + name)
        if name.endswith(".py"):
            ast.parse(body.decode("utf-8"), filename=name)
        elif name.endswith(".json"):
            json.loads(body)
        bodies[name] = body
    required = ["workspace.mjs", "large_delivery.mjs", "large_io.mjs", "normalise.mjs", "parse.mjs"]
    for name in required:
        if not member(root, "measurement_workspace/engine/" + name).is_file():
            raise ValueError("The original Measurements 1.2 engine is required: " + name)
    version = subprocess.run(["node", "--version"], capture_output=True, text=True, check=True).stdout.strip()
    numbers = tuple(int(x) for x in version.removeprefix("v").split(".")[:2])
    if numbers < (22, 16):
        raise ValueError("Use Node 22.16 or newer with the original native engine")
    prepared, reused = {}, []
    bodies[MANIFEST] = (source / MANIFEST).read_bytes()
    for name, body in bodies.items():
        target = member(root, name)
        if target.exists():
            if target.read_bytes() != body:
                raise ValueError("Retained different component source; compose it explicitly: " + name)
            reused.append(name)
        else:
            prepared[name] = body
    result = {"format": "upper-savannah-measurement-returned-install/v1", "version": metadata["version"],
              "application": str(root), "node": version, "check": check,
              "created": sorted(prepared), "reused": sorted(reused), "nativeSource": "preserved unchanged"}
    if check:
        return result
    lockroot = member(root, ".locks")
    lockroot.mkdir(exist_ok=True)
    lock = sqlite3.connect(lockroot / "measurement-returned-reviews.sqlite", timeout=5)
    lock.execute("BEGIN IMMEDIATE")
    changed: list[str] = []
    try:
        with tempfile.TemporaryDirectory(prefix=".measurement-returned-install-", dir=root) as temporary:
            stage = Path(temporary)
            try:
                for name, body in prepared.items():
                    target = member(stage, name)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with target.open("xb") as stream:
                        stream.write(body)
                        stream.flush()
                        os.fsync(stream.fileno())
                    if name.endswith(".mjs"):
                        subprocess.run(["node", "--check", str(target)], check=True, capture_output=True)
                # Inventory is published last; partial identical installs converge.
                for name in sorted(prepared, key=lambda n: (n == MANIFEST, n)):
                    target = member(root, name)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        os.link(member(stage, name), target)
                        changed.append(name)
                    except FileExistsError:
                        if target.is_symlink() or target.read_bytes() != prepared[name]:
                            raise ValueError("Concurrent source change was preserved: " + name)
                entry = member(root, "measurement_workspace/engine/returned_reviews.mjs").as_uri()
                subprocess.run(["node", "--input-type=module", "-e", "await import(" + json.dumps(entry) + ");"], check=True, capture_output=True)
            except Exception:
                for name in reversed(changed):
                    target = member(root, name)
                    if target.is_file() and not target.is_symlink() and target.read_bytes() == prepared[name]:
                        target.unlink()
                raise
        return result
    finally:
        lock.rollback()
        lock.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, default=Path(__file__).parent)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source_root, args.check), indent=2))
