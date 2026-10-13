#!/usr/bin/env python3
"""Install the regional watershed desk into the current extension-enabled app."""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import tempfile
from datetime import datetime, timezone

FILES = (
    "model/watershed_context.py",
    "source_tools/prepare_watershed_context.py",
    "operator/watershed_context.py",
    "operator/web/watershed_context.mjs",
    "operator/web/watershed_context.css",
    "operator/extensions/watershed-context.json",
    "operator/receive_watershed_context.py",
    "operator/install_watershed_context.py",
    "operator/WATERSHED_CONTEXT.md",
)
OPTIONAL = ("model/watershed_context_cli.py", "model/WATERSHED_CONTEXT.md")


def digest(body):
    return hashlib.sha256(body).hexdigest()


def atomic_write(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install(application, source_root, *, dry_run=False):
    application = Path(application).resolve(strict=True)
    source_root = Path(source_root).resolve(strict=True)
    for required in ("operator/extension_registry.py", "operator/web/extension_host.mjs"):
        if not (application / required).is_file():
            raise ValueError("Install the current shared extension host first: missing " + required)
    originals = {}
    prepared = {}
    for name in FILES + tuple(name for name in OPTIONAL if (source_root / name).is_file()):
        source = source_root / name
        body = source.read_bytes()
        if name.endswith(".py"):
            ast.parse(body.decode("utf-8"), filename=name)
        if name.endswith(".json"):
            value = json.loads(body)
            if name.endswith("watershed-context.json") and (
                value.get("schema") != "upstate.operator-extension/v1"
                or value.get("id") != "watershed-context"
            ):
                raise ValueError("Choose the regional watershed extension manifest.")
        target = application / name
        old = target.read_bytes() if target.is_file() else None
        originals[name] = old
        if old != body:
            prepared[name] = body
    plan = {
        "schema": "upstate.watershed-context-install/v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "application": str(application),
        "files": [{
            "path": name, "before_sha256": digest(originals[name]) if originals[name] is not None else None,
            "after_sha256": digest(body), "bytes": len(body),
        } for name, body in sorted(prepared.items())],
    }
    if dry_run or not prepared:
        return {**plan, "dry_run": dry_run, "changed": False}
    # Compare the complete prepared set again before its first replacement.
    for name in prepared:
        target = application / name
        current = target.read_bytes() if target.is_file() else None
        if current != originals[name]:
            raise ValueError("Application source changed during preparation: " + name)
    identity = digest(json.dumps(plan, sort_keys=True).encode("utf-8"))[:16]
    backup = application / ".watershed-context-installs" / identity
    backup.mkdir(parents=True, exist_ok=False)
    atomic_write(backup / "plan.json", (json.dumps(plan, indent=2) + "\n").encode("utf-8"))
    for name in prepared:
        if originals[name] is not None:
            atomic_write(backup / "before" / name, originals[name])
    written = []
    try:
        for name, body in prepared.items():
            target = application / name
            current = target.read_bytes() if target.is_file() else None
            if current != originals[name]:
                raise ValueError("Application source changed before replacement: " + name)
            atomic_write(target, body)
            written.append(name)
        result = {**plan, "changed": True, "backup": str(backup)}
        atomic_write(backup / "result.json", (json.dumps(result, indent=2) + "\n").encode("utf-8"))
        return result
    except BaseException:
        # Restore only files still containing this installer's exact written bytes.
        for name in reversed(written):
            target = application / name
            if not target.is_file() or target.read_bytes() != prepared[name]:
                continue
            if originals[name] is None:
                target.unlink()
            else:
                atomic_write(target, originals[name])
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source_root, dry_run=args.dry_run),
                     indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
