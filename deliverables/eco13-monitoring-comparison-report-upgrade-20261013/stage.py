#!/usr/bin/env python3
"""Stage the complete Monitoring upgrade using the application's original source reader."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--bank", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    application = args.application.expanduser().resolve()
    bank = args.bank.expanduser().resolve()
    destination = args.source_root.expanduser().resolve()
    if destination == application or destination.is_relative_to(application):
        raise ValueError("Stage the complete upgrade outside the running application.")
    if not (application / "model/workspace.py").is_file():
        raise ValueError("Choose the original installed Upper Savannah application.")
    sys.path.insert(0, str(application))
    manifest = json.loads((bank / "manifest.json").read_bytes())
    if manifest.get("schema") not in {"upstate.monitoring-source-upgrade/v1",
                                     "upstate.chemistry-source-upgrade/v1"}:
        raise ValueError("Choose the complete original component upgrade manifest.")
    original = manifest["bootstrap"]
    module_path = bank / original["path"]
    if module_path.is_symlink() or not module_path.resolve().is_relative_to(bank):
        raise ValueError("Keep the original source assembler inside this bank.")
    body = module_path.read_bytes()
    if len(body) != original["bytes"] or hashlib.sha256(body).hexdigest() != original["sha256"]:
        raise ValueError("The complete original source assembler differs from its declared identity.")
    spec = importlib.util.spec_from_file_location("_upstate_component_source_assembly", module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    read_layer, publish_file = module.read_layer, module.publish_file
    files = {}
    for part in manifest["parts"]:
        path = bank / part["path"]
        if path.parent != bank or path.is_symlink():
            raise ValueError("Choose an original regular source-bank part.")
        body = path.read_bytes()
        if len(body) != part["bytes"] or hashlib.sha256(body).hexdigest() != part["sha256"]:
            raise ValueError("Original source-bank part differs: " + part["path"])
        layer = read_layer(path)
        for name, content in layer.files.items():
            if name in files:
                raise ValueError("Duplicate original source path: " + name)
            files[name] = content.encode("utf-8")
    expected = {row["path"]: row for row in manifest["files"]}
    if len(expected) != len(manifest["files"]) or set(expected) != set(files):
        raise ValueError("The complete staged file inventory differs.")
    for name, body in files.items():
        row = expected[name]
        if len(body) != row["bytes"] or hashlib.sha256(body).hexdigest() != row["sha256"]:
            raise ValueError("Original source body differs: " + name)
        target = destination / name
        if target.is_symlink() or not target.resolve().is_relative_to(destination):
            raise ValueError("Staged original source leaves its receiving directory.")
        for parent in target.parents:
            if parent == destination.parent:
                break
            if parent.is_symlink():
                raise ValueError("Stage into ordinary directories without aliases.")
        if target.exists() and target.read_bytes() != body:
            raise ValueError("Choose a fresh stage; an existing file has another edition: " + name)
    for name, body in sorted(files.items()):
        publish_file(destination / name, body)
    result = {"schema": "upstate.monitoring-source-upgrade-stage/v1",
              "application": str(application), "source_root": str(destination),
              "source_commit": manifest["source_commit"],
              "files": len(files), "source_bytes": sum(map(len, files.values())),
              "manifest_sha256": hashlib.sha256((bank / "manifest.json").read_bytes()).hexdigest(),
              "installer": manifest["installer"]}
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
