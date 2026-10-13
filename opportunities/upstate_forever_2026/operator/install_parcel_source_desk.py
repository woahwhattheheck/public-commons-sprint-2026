#!/usr/bin/env python3
"""Install the original parcel-source desk into the current ECSA application."""
from __future__ import annotations

import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile

FILES = (
    "model/parcel_source_desk.py",
    "model/parcel_source_cli.py",
    "operator/parcel_source_desk.py",
    "operator/extensions/parcel-sources.json",
    "operator/web/parcel_source_desk.mjs",
    "operator/web/parcel_source_desk.css",
    "operator/install_parcel_source_desk.py",
    "operator/parcel_source_receiving.py",
    "operator/PARCEL_SOURCE_DESK.md",
)
# The first source edition adds distinct paths. Later authored editions can name
# their exact predecessor here after composing the current installed source.
PREVIOUS = {name: None for name in FILES}
DEPENDENCIES = (
    "model/workspace.py", "model/common.py", "model/conservation.py",
    "model/priorities.py", "source_tools/reporting_parcels.py",
    "source_tools/domain_overlays.py", "source_tools/SC_PARCEL_PROVIDERS.json",
    "source/capture_original_overlays.py",
    "operator/server.py", "operator/extension_registry.py",
    "operator/web/app.mjs", "operator/web/extension_host.mjs",
)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def run(application, source_root, *, dry_run=False):
    application = Path(application).expanduser().resolve(strict=True)
    source_root = Path(source_root).expanduser().resolve(strict=True)
    missing = [name for name in DEPENDENCIES if not (application / name).is_file()]
    if missing:
        raise ValueError("Compose the current full application and original parcel engine first: " + ", ".join(missing))
    server = (application / "operator/server.py").read_text(encoding="utf-8")
    browser = (application / "operator/web/app.mjs").read_text(encoding="utf-8")
    if "ExtensionRegistry" not in server or "extensions.render(" not in browser:
        raise ValueError("Apply the current original ECSA host installer to this application first")
    native = ast.parse((application / "source_tools/reporting_parcels.py").read_text(encoding="utf-8"))
    method = next((node.value.value for node in native.body
                   if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant)
                   and any(isinstance(target, ast.Name) and target.id == "PREPARATION_METHOD"
                           for target in node.targets)), None)
    if not isinstance(method, str) or not method.startswith("upstate.reporting-parcels/whole-original-polygons/"):
        raise ValueError("Compose the current whole-original parcel preparation source before installing this desk")
    lock_root = application / ".locks"
    lock_root.mkdir(exist_ok=True)
    with (lock_root / "parcel-source-install.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        pending, original = {}, {}
        for name in FILES:
            source = (source_root / name).resolve(strict=True)
            if not source.is_relative_to(source_root) or not source.is_file():
                raise ValueError("Receive the complete parcel desk source file: " + name)
            data = source.read_bytes()
            if name.endswith(".py"):
                ast.parse(data.decode("utf-8"), filename=name)
            if name.endswith(".json"):
                value = json.loads(data)
                if value.get("schema") != "upstate.operator-extension/v1" or value.get("id") != "parcel-sources":
                    raise ValueError("Receive the authored parcel-sources registration")
            target = application / name
            if target.is_symlink() or not target.parent.resolve().is_relative_to(application):
                raise ValueError("The installed source path must remain within the original application: " + name)
            before = target.read_bytes() if target.exists() else None
            if before is not None and before != data:
                if name.endswith(".json") and json.loads(before) == json.loads(data):
                    data = before
                elif sha(before) != PREVIOUS[name]:
                    raise ValueError("Compose the current authored parcel desk before replacing " + name)
            original[name], pending[name] = before, data
        changed = [name for name in FILES if original[name] != pending[name]]
        result = {
            "schema": "upstate.parcel-source-install/v1", "application": str(application),
            "dry_run": dry_run, "changed": changed, "entrypoint": "/#parcel-sources",
            "preparation_method": method, "extension_id": "parcel-sources",
            "files": [{"path": name, "bytes": len(pending[name]), "sha256": sha(pending[name]),
                       "previous_sha256": sha(original[name]) if original[name] is not None else None}
                      for name in FILES],
        }
        if dry_run:
            return result
        with tempfile.TemporaryDirectory(prefix=".parcel-source-install-", dir=application.parent) as temporary:
            staging = Path(temporary)
            for name in changed:
                target = staging / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(pending[name])
            for name in changed:
                target = application / name
                before = target.read_bytes() if target.exists() else None
                if before != original[name]:
                    raise RuntimeError("The current source changed during composition: " + name)
            for name in changed:
                target = application / name
                before = target.read_bytes() if target.exists() else None
                if before != original[name]:
                    raise RuntimeError("The current source changed during composition: " + name)
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(staging / name, target)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(run(args.application, args.source_root, dry_run=args.dry_run), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
