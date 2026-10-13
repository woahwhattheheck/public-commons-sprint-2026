#!/usr/bin/env python3
"""Stage a complete component upgrade using the unchanged original source reader."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
import types
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
    manifest = json.loads((bank / "manifest.json").read_bytes())
    if manifest.get("schema") not in {"upstate.monitoring-source-upgrade/v1",
                                     "upstate.chemistry-source-upgrade/v1",
                                     "upstate.measurements-source-upgrade/v1"}:
        raise ValueError("Choose the complete original component upgrade manifest.")
    def verified_body(record):
        name = record["path"]
        path = bank / name
        if (not isinstance(name, str) or Path(name).is_absolute()
                or "\\" in name or Path(name).as_posix() != name
                or any(part in (".", "..") for part in name.split("/"))
                or path.is_symlink() or not path.resolve().is_relative_to(bank)):
            raise ValueError("Keep each original bootstrap source inside this bank.")
        body = path.read_bytes()
        if len(body) != record["bytes"] or hashlib.sha256(body).hexdigest() != record["sha256"]:
            raise ValueError("An original bootstrap source differs: " + name)
        return path, body

    original = manifest["bootstrap"]
    module_path, _ = verified_body(original)
    companion_records = original.get("companions", [])
    expected_companions = {"bootstrap/source_tools/application_components.py",
                           "bootstrap/source_tools/component_fragments.py"}
    if (len(companion_records) != len(expected_companions)
            or {record["path"] for record in companion_records} != expected_companions
            or original["path"] != "bootstrap/source_tools/application_assembly.py"):
        raise ValueError("Receive the complete matching assembler, component reader and fragment helper.")
    companion_paths = {Path(record["path"]).stem: verified_body(record)[0]
                       for record in companion_records}
    instruction_path, instruction_body = verified_body(manifest["owner_instruction"])
    if manifest["owner_instruction"]["path"] != "AGENTS.md":
        raise ValueError("Retain the current owner instruction at the bank root.")

    # Load the unchanged matching originals as a private package. Their relative
    # imports must not depend on the installed application's assembler edition.
    package_name = "_upstate_monitoring_source_bootstrap"
    package = types.ModuleType(package_name)
    package.__path__ = [str(module_path.parent)]
    package.__package__ = package_name
    sys.modules[package_name] = package
    for leaf, path in (("component_fragments", companion_paths["component_fragments"]),
                       ("application_components", companion_paths["application_components"]),
                       ("application_assembly", module_path)):
        spec = importlib.util.spec_from_file_location(package_name + "." + leaf, path)
        loaded = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = loaded
        spec.loader.exec_module(loaded)
    module = sys.modules[package_name + ".application_assembly"]
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
    instruction_target = destination / "AGENTS.md"
    if (instruction_target.is_symlink()
            or (instruction_target.exists() and instruction_target.read_bytes() != instruction_body)):
        raise ValueError("The existing staged owner instruction has another edition.")
    for name, body in sorted(files.items()):
        publish_file(destination / name, body)
    publish_file(instruction_target, instruction_body)
    result = {"schema": manifest["schema"].replace("-upgrade/v1", "-upgrade-stage/v1"),
              "application": str(application), "source_root": str(destination),
              "source_commit": manifest["source_commit"],
              "files": len(files), "source_bytes": sum(map(len, files.values())),
              "manifest_sha256": hashlib.sha256((bank / "manifest.json").read_bytes()).hexdigest(),
              "installer": manifest["installer"],
              "bootstrap_companions": companion_records,
              "owner_instruction": {**manifest["owner_instruction"],
                                    "staged_path": str(instruction_target)}}
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
