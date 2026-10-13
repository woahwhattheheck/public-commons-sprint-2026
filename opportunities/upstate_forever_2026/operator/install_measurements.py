#!/usr/bin/env python3
"""Install the complete measured-observation component into its original registered host."""
from __future__ import annotations
import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile

INVENTORY = "integration/measurements/INSTALLATION.json"
LOCK = ".locks/extension-install.lock"


def sha(body):
    return hashlib.sha256(body).hexdigest()


def name(value):
    if not isinstance(value, str):
        raise ValueError("Choose an original application-relative source member.")
    path = Path(value)
    if (not value or path.is_absolute()
            or "\\" in value or str(path) != value
            or any(part in (".", "..") for part in path.parts)):
        raise ValueError("Choose an original application-relative source member.")
    return value


def body(root, relative, *, optional=False):
    path = root / name(relative)
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError("Keep original application members inside their directory: " + relative)
    for parent in path.parents:
        if parent == root.parent:
            break
        if parent.is_symlink():
            raise ValueError("Original component directories cannot be aliases: " + relative)
    if not path.exists() and optional:
        return None
    if not path.is_file():
        raise ValueError("Complete component source is missing: " + relative)
    return path.read_bytes()


def replace(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".measurement-install-", delete=False) as stream:
        pending = Path(stream.name)
        try:
            stream.write(data)
            os.fchmod(stream.fileno(), stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            pending.unlink(missing_ok=True)
            raise
    try:
        os.replace(pending, path)
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        pending.unlink(missing_ok=True)


def install(application, source_root, *, check=False):
    target = Path(application).expanduser().resolve(strict=True)
    source = Path(source_root).expanduser().resolve(strict=True)
    if source == target or source.is_relative_to(target):
        raise ValueError("Stage the complete measured source outside the running application.")
    raw = body(source, INVENTORY)
    inventory = json.loads(raw)
    if inventory.get("schema") != "upstate.measurements-installation/v1":
        raise ValueError("Choose the complete original Measurements installation inventory.")
    files = inventory["files"]
    if not isinstance(files, list) or len({row["path"] for row in files}) != len(files):
        raise ValueError("The measured source inventory repeats an original member.")
    prepared = {}
    for row in files:
        selected = body(source, row["path"])
        if len(selected) != row["bytes"] or sha(selected) != row["sha256"]:
            raise ValueError("Original source differs from its complete identity: " + row["path"])
        if row["path"].endswith(".py"):
            ast.parse(selected, filename=row["path"])
        elif row["path"].endswith(".json"):
            json.loads(selected)
        prepared[row["path"]] = selected
    # The bank's complete outer inventory verifies this self-contained manifest.
    prepared[INVENTORY] = raw
    instruction = body(source, "AGENTS.md")
    instruction_row = inventory["instruction"]
    if len(instruction) != instruction_row["bytes"] or sha(instruction) != instruction_row["sha256"]:
        raise ValueError("Retain the complete current producing-worker instruction.")
    if b"2026-10-13.1" not in instruction or b"14:00 UTC" not in instruction:
        raise ValueError("Retain the owner's current rendered-product instruction and sprint cutoff.")
    for relative in inventory["requires"]:
        body(target, relative)
    server = ast.parse(body(target, "operator/server.py"))
    registered = any(
        isinstance(item, ast.Assign)
        and isinstance(item.value, ast.Call)
        and isinstance(item.value.func, ast.Name)
        and item.value.func.id == "ExtensionRegistry"
        and any(isinstance(selected, ast.Attribute) and selected.attr == "extensions"
                and isinstance(selected.value, ast.Name) and selected.value.id == "self"
                for selected in item.targets)
        for item in ast.walk(server))
    if not registered:
        raise ValueError("Use the original installed extension registry before adding Measurements.")
    chemistry = ast.parse(body(target, "model/reach_chemistry/inference.py"))
    declared = {node.name for node in chemistry.body if isinstance(node, ast.FunctionDef)}
    if not {"observation_components", "observation_rows"} <= declared:
        raise ValueError("Install the complete maintained Chemistry compound/interval component first.")
    node = shutil.which("node")
    if not node:
        raise ValueError("Use the original Measurements Node 22.16 or newer runtime.")
    version = subprocess.run([node, "--version"], check=True, capture_output=True, text=True).stdout.strip()
    parts = version.removeprefix("v").split(".")
    if len(parts) < 2 or not all(part.isdigit() for part in parts[:2]) or tuple(map(int, parts[:2])) < (22, 16):
        raise ValueError("The original SQLite measurement engine needs Node 22.16 or newer.")
    descriptor = json.loads(prepared["operator/extensions/measured-observations.json"])
    if (descriptor.get("schema") != "upstate.operator-extension/v1"
            or descriptor.get("id") != "measured-observations"
            or descriptor["backend"].get("module") != "measurement_workspace.extension"):
        raise ValueError("Retain the original measured-observation extension owner.")
    assets = descriptor.get("assets", [])
    if any("operator/web/" + asset not in prepared for asset in assets):
        raise ValueError("The complete registered measurement assets are missing.")
    lock = target / LOCK
    if lock.is_symlink() or lock.parent.is_symlink() or not lock.resolve().is_relative_to(target):
        raise ValueError("Keep the original shared installation lock inside the application.")
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("a+") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        before, changes = {}, {}
        previous = inventory.get("predecessors", {})
        for relative, selected in prepared.items():
            current = body(target, relative, optional=True)
            before[relative] = current
            if current == selected:
                continue
            if current is not None and sha(current) not in previous.get(relative, []):
                raise ValueError("Compose the current independently changed measured source: " + relative)
            changes[relative] = selected
        # Propagate the current owner instruction while retaining any existing
        # application-specific rules. An installed newer copy already containing
        # this exact block remains untouched.
        original_instructions = body(target, "AGENTS.md", optional=True)
        if original_instructions is None:
            proposed_instructions = instruction
        elif instruction in original_instructions:
            proposed_instructions = original_instructions
        else:
            proposed_instructions = original_instructions.rstrip() + b"\n\n" + instruction
        before["AGENTS.md"] = original_instructions
        prepared["AGENTS.md"] = proposed_instructions
        if proposed_instructions != original_instructions:
            changes["AGENTS.md"] = proposed_instructions
        shared_before = {relative: body(target, relative) for relative in inventory["requires"]}
        result = {"schema": "upstate.measurements-installation-result/v1",
                  "application": str(target), "source_root": str(source), "check": check,
                  "inventory_sha256": sha(raw), "source_files": len(prepared),
                  "changed": sorted(changes), "node": version, "view": "measured-observations"}
        if check or not changes:
            return result
        saved = target / ".measurement-installations" / sha(raw)
        if saved.is_symlink() or saved.parent.is_symlink() or not saved.resolve().is_relative_to(target):
            raise ValueError("Keep the original installation backup inside the application.")
        saved.mkdir(parents=True, exist_ok=True)
        for relative, current in before.items():
            if current is not None:
                backup = saved / "before" / relative
                if backup.exists() and backup.read_bytes() != current:
                    # A matching postimage after interruption preserves its first original backup.
                    if current != prepared[relative]:
                        raise ValueError("The retained installation preimage differs: " + relative)
                elif not backup.exists():
                    replace(backup, current)
        for relative, current in shared_before.items():
            if body(target, relative) != current:
                raise RuntimeError("A shared application dependency changed: " + relative)
        for relative, current in before.items():
            if body(target, relative, optional=True) != current:
                raise RuntimeError("Concurrent measured source change: " + relative)
        committed = []
        try:
            for relative, selected in sorted(changes.items()):
                if body(target, relative, optional=True) != before[relative]:
                    raise RuntimeError("Concurrent measured source change: " + relative)
                committed.append(relative)
                replace(target / relative, selected)
            result["state"] = "installed"
            replace(saved / "installation.json", (json.dumps(result, indent=2) + "\n").encode("utf-8"))
            return result
        except BaseException as failure:
            conflicts = []
            for relative in reversed(committed):
                destination = target / relative
                try:
                    current = body(target, relative, optional=True)
                except (OSError, ValueError):
                    conflicts.append(relative)
                    continue
                if current == before[relative]:
                    continue
                if current != prepared[relative]:
                    conflicts.append(relative)
                    continue
                try:
                    if before[relative] is None:
                        destination.unlink()
                    else:
                        replace(destination, before[relative])
                except OSError:
                    conflicts.append(relative)
            if conflicts:
                raise RuntimeError("Preserved independently changed files during rollback: "
                                   + ", ".join(conflicts)) from failure
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source_root, check=args.check), indent=2))


if __name__ == "__main__":
    main()
