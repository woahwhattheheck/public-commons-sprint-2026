#!/usr/bin/env python3
"""Install the complete reviewer reconciliation desk into an existing operator.

Usage:
  python source_tools/install_review_reconciliation.py --application /path/to/upstate_forever_2026

The current shared extension host is the integration point. The application,
other desks, original review system and queue are composed in place.
"""
from __future__ import annotations

import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

IMPLEMENTATION = (
    "model/review_reconciliation.py",
    "operator/review_reconciliation.py",
    "operator/web/review_reconciliation.mjs",
)
DESCRIPTOR = "operator/extensions/review-reconciliation.json"
OPTIONAL = ("operator/REVIEW_RECONCILIATION.md",)
MANIFEST = "source_tools/review_reconciliation.source.json"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def regular(root, relative, *, missing=False):
    current = root
    parts = Path(relative).parts
    if Path(relative).is_absolute() or ".." in parts:
        raise ValueError("Expected a relative application path: " + relative)
    for index, part in enumerate(parts):
        current = current / part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            if missing:
                return current if index == len(parts) - 1 else root / relative
            raise
        if stat.S_ISLNK(mode):
            raise ValueError("Application source path contains a symbolic link: " + relative)
        wanted = stat.S_ISREG if index == len(parts) - 1 else stat.S_ISDIR
        if not wanted(mode):
            raise ValueError("Application source path has an incompatible type: " + relative)
    return current


def validate_host(application):
    required = (
        "model/workspace.py", "model/reviews.py", "operator/server.py",
        "operator/extension_registry.py", "operator/web/app.mjs",
        "operator/web/extension_host.mjs",
    )
    bodies = {name: regular(application, name).read_bytes() for name in required}
    review_module = ast.parse(bodies["model/reviews.py"], filename="model/reviews.py")
    functions = {node.name for node in review_module.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
    needed = {"history", "import_response", "show_review", "_checked_response"}
    if needed - functions:
        raise ValueError("Current original review API is missing: " + ", ".join(sorted(needed - functions)))
    server = bodies["operator/server.py"].decode("utf-8")
    browser = bodies["operator/web/app.mjs"].decode("utf-8")
    if "ExtensionRegistry" not in server or "createExtensionHost" not in browser:
        raise ValueError("Install the current shared operator extension host, then rerun this desk installer.")
    return {name: sha(data) for name, data in bodies.items()}


def install(application, source_root, *, dry_run=False):
    application = Path(application).resolve(strict=True)
    source_root = Path(source_root).resolve(strict=True)
    if not application.is_dir() or not source_root.is_dir():
        raise ValueError("Application and source root must be directories.")
    names = list(IMPLEMENTATION) + [name for name in OPTIONAL if (source_root / name).is_file()] + [DESCRIPTOR]
    pending = {name: regular(source_root, name).read_bytes() for name in names}
    for name, data in pending.items():
        if name.endswith(".py"):
            ast.parse(data, filename=name)
    descriptor = json.loads(pending[DESCRIPTOR])
    if descriptor.get("schema") != "upstate.operator-extension/v1" or descriptor.get("id") != "review-reconciliation":
        raise ValueError("Expected the reviewer reconciliation extension descriptor.")
    if set(descriptor.get("assets", ())) - {"review_reconciliation.mjs"}:
        raise ValueError("Unexpected reconciliation desk asset registration.")
    manifest_path = source_root / MANIFEST
    if manifest_path.exists():
        manifest = json.loads(regular(source_root, MANIFEST).read_bytes())
        if manifest.get("schema") != "upstate.review-reconciliation-source/v1":
            raise ValueError("Unexpected reconciliation source manifest.")
        expected = {item["path"]: item for item in manifest["files"]}
        for name, data in pending.items():
            item = expected.get(name)
            if item is None or item.get("bytes") != len(data) or item.get("sha256") != sha(data):
                raise ValueError("Source bytes differ from the complete package manifest: " + name)
    lock_root = application / ".locks"
    if lock_root.exists() and (lock_root.is_symlink() or not lock_root.is_dir()):
        raise ValueError("Application lock directory must be a real directory.")
    lock_root.mkdir(exist_ok=True)
    lock_path = lock_root / "extension-install.lock"
    if lock_path.is_symlink():
        raise ValueError("Application installation lock cannot be a symbolic link.")
    with lock_path.open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        host = validate_host(application)
        original = {}
        for name in names:
            target = regular(application, name, missing=True)
            original[name] = target.read_bytes() if target.exists() else None
        changed = [name for name in names if pending[name] != original[name]]
        result = {
            "schema": "upstate.review-reconciliation-install/v1",
            "application": str(application),
            "dry_run": dry_run,
            "extension_id": "review-reconciliation",
            "changed": changed,
            "host_sha256": host,
            "files": [
                {"path": name, "bytes": len(pending[name]), "sha256": sha(pending[name]),
                 "previous_sha256": sha(original[name]) if original[name] is not None else None}
                for name in names
            ],
            "open_view": "#review-reconciliation",
        }
        if dry_run or not changed:
            return result
        with tempfile.TemporaryDirectory(prefix=".review-reconciliation-", dir=application.parent) as temporary:
            staging = Path(temporary)
            for name in changed:
                target = staging / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(pending[name])
            for name in changed:
                target = regular(application, name, missing=True)
                current = target.read_bytes() if target.exists() else None
                if current != original[name]:
                    raise RuntimeError("Application source changed while preparing installation: " + name)
            # Register the descriptor last; a fresh install is only visible after
            # every implementation file has reached the receiving application.
            for name in changed:
                target = regular(application, name, missing=True)
                current = target.read_bytes() if target.exists() else None
                if current != original[name]:
                    raise RuntimeError("Concurrent source changed during installation: " + name + ". Rerun to compose from current files.")
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(staging / name, target)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(install(args.application, args.source_root, dry_run=args.dry_run), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
