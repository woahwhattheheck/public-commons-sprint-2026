#!/usr/bin/env python3
"""Install the complete current Measurements source in its original host or CLI."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

VERSION = "1.2.6"
MANIFEST = "MEASUREMENT_LARGE_FILES_SOURCE.json"
COMBINED = "integration/measurements/INSTALLATION.json"
LOCK = ".locks/extension-install.lock"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def member(root, name):
    if (not isinstance(name, str) or not name or "\\" in name
            or ":" in name or name.startswith("/") or any(x in {"", ".", ".."} for x in name.split("/"))):
        raise ValueError("Expected an application-relative source member")
    target = root / name
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError("Source member escapes the application: " + name)
    current = target
    while current != root:
        if current.is_symlink():
            raise ValueError("Installation crosses a symlink: " + name)
        current = current.parent
    return target


def read(root, name, *, optional=False):
    target = member(root, name)
    if not target.exists() and optional:
        return None
    if not target.is_file():
        raise ValueError("Complete source member is missing: " + name)
    return target.read_bytes()


def rows_of(value, label):
    rows = value.get("files")
    if not isinstance(rows, list):
        raise ValueError("Expected complete source rows: " + label)
    result = {}
    for row in rows:
        if (not isinstance(row, dict) or not isinstance(row.get("path"), str)
                or row["path"] in result or not isinstance(row.get("bytes"), int)
                or isinstance(row["bytes"], bool) or row["bytes"] < 0
                or not isinstance(row.get("sha256"), str) or len(row["sha256"]) != 64
                or any(c not in "0123456789abcdef" for c in row["sha256"])):
            raise ValueError("Invalid or repeated complete source identity: " + label)
        # Path validation is shared with the actual reader before any mutation.
        result[row["path"]] = row
    return result


def select_sources(source):
    raw = read(source, MANIFEST)
    inventory = json.loads(raw)
    if inventory.get("format") != "upper-savannah-measurements-large-file-source/v1":
        raise ValueError("Select the original complete Measurements source inventory")
    rows = rows_of(inventory, MANIFEST)
    selection = inventory.get("standalone", {})
    names = selection.get("files")
    if (not isinstance(names, list) or not names or any(not isinstance(n, str) for n in names)
            or len(set(names)) != len(names) or any(n not in rows for n in names)):
        raise ValueError("Select a complete release with an explicit standalone source selection")
    approved = {n: list(v) for n, v in selection.get("predecessors", {}).items()}
    combined_raw = read(source, COMBINED, optional=True)
    authority = {"path": MANIFEST, "sha256": digest(raw)}
    if combined_raw is not None:
        combined = json.loads(combined_raw)
        if combined.get("schema") != "upstate.measurements-installation/v1":
            raise ValueError("Unexpected cumulative Measurements source inventory")
        current = rows_of(combined, COMBINED)
        selected_manifest = current.get(MANIFEST)
        if (selected_manifest is None or selected_manifest["bytes"] != len(raw)
                or selected_manifest["sha256"] != digest(raw)):
            raise ValueError("The cumulative source does not select this standalone inventory")
        # The cumulative source is authoritative for current native/API/browser
        # dependencies. Keep its later complete native modules and source tools.
        for name, row in current.items():
            if name.startswith(("measurement_workspace/", "source_tools/", "source_data/wqp_eight_20261013/")):
                if name not in names:
                    names.append(name)
            if name in names:
                rows[name] = {**rows.get(name, {}), **row}
        instruction = combined.get("instruction", {})
        if instruction.get("path") == "AGENTS.md" and "AGENTS.md" in names:
            rows["AGENTS.md"] = {**rows["AGENTS.md"], **instruction}
        for name, hashes in combined.get("predecessors", {}).items():
            if name in names:
                approved.setdefault(name, []).extend(hashes)
        authority = {"path": COMBINED, "sha256": digest(combined_raw)}
    if any(name in {MANIFEST, COMBINED, LOCK} for name in names):
        raise ValueError("Source selection cannot include its own state or lock")
    bodies = {}
    for name in sorted(names):
        row = rows[name]
        body = read(source, name)
        if len(body) != row["bytes"] or digest(body) != row["sha256"]:
            raise ValueError("Complete selected source differs: " + name)
        if name.endswith(".py"):
            ast.parse(body.decode("utf-8"), filename=name)
        elif name.endswith(".json"):
            json.loads(body)
        bodies[name] = body
    for name, hashes in approved.items():
        if not isinstance(hashes, list) or any(
                not isinstance(h, str) or len(h) != 64 or any(c not in "0123456789abcdef" for c in h)
                for h in hashes):
            raise ValueError("Invalid retained predecessor identities: " + name)
    return inventory, rows, bodies, approved, authority, raw


def atomic(path, data, *, platform=None):
    if platform is not None and platform.windows is not None:
        return platform.replace_windows(path, data)
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".measurement-install-", delete=False) as stream:
            pending = Path(stream.name)
            if path.exists():
                os.fchmod(stream.fileno(), stat.S_IMODE(path.stat().st_mode))
            else:
                os.fchmod(stream.fileno(), 0o644)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(pending, path)
        parent_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def install(application, source_root=None, *, standalone=False, dry_run=False):
    root = Path(application).expanduser().resolve(strict=True)
    source = Path(source_root or Path(__file__).parent).expanduser().resolve(strict=True)
    if not standalone:
        if read(source, COMBINED, optional=True) is None:
            raise ValueError("Select the complete registered-host release, or --standalone for the original CLI")
        import importlib.util
        implementation = member(source, "operator/install_measurements.py")
        spec = importlib.util.spec_from_file_location("_upstate_complete_measurements_installer", implementation)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.install(root, source, check=dry_run)
    if source == root or source.is_relative_to(root):
        raise ValueError("Stage the complete source outside the receiving application")
    inventory, rows, bodies, approved, authority, manifest_raw = select_sources(source)
    if "measurement_workspace/node_runtime.py" not in bodies:
        raise ValueError("Retain the complete Measurements runtime selection source.")
    import types
    runtime_path = member(source, "measurement_workspace/node_runtime.py")
    runtime_module = types.ModuleType("_upstate_measurements_node_runtime")
    runtime_module.__file__ = str(runtime_path)
    exec(compile(bodies["measurement_workspace/node_runtime.py"],
                 str(runtime_path), "exec"), runtime_module.__dict__)
    runtime = runtime_module.inspect_node()
    platform_relative = "measurement_workspace/install_platform.py"
    if platform_relative not in bodies:
        raise ValueError("Retain the complete Measurements installer platform source.")
    platform_module = types.ModuleType("_upstate_measurements_install_platform")
    platform_module.__file__ = str(member(source, platform_relative))
    exec(compile(bodies[platform_relative], platform_module.__file__, "exec"),
         platform_module.__dict__)
    install_files = platform_module.InstallerFiles(bodies, source)
    lockpath = member(root, LOCK)
    lockpath.parent.mkdir(parents=True, exist_ok=True)
    # Both installers retain the same original platform lease through rollback.
    with install_files.held(lockpath):
        previous_raw = read(root, MANIFEST, optional=True)
        previous = json.loads(previous_raw) if previous_raw is not None else {}
        if previous and previous.get("format") != inventory["format"]:
            raise ValueError("Retain the independently authored target inventory")
        previous_rows = rows_of(previous, "installed source") if previous else {}
        before, prepared, reused = {}, {}, []
        for name, selected in bodies.items():
            old = read(root, name, optional=True)
            before[name] = old
            if old == selected:
                reused.append(name)
                continue
            if name == "AGENTS.md" and old is not None:
                # Preserve local application instructions while carrying the exact
                # original owner-directed instruction block into this source.
                selected = old if selected in old else old.rstrip() + b"\n\n" + selected
                if selected == old:
                    reused.append(name)
                    continue
                prepared[name] = selected
                continue
            allowed = set(approved.get(name, []))
            if name in previous_rows:
                allowed.add(previous_rows[name]["sha256"])
            if old is not None and digest(old) not in allowed:
                raise ValueError("Compose the independently changed standalone source: " + name)
            prepared[name] = selected
        installed_rows = []
        for name in sorted(bodies):
            actual = prepared.get(name, before[name])
            installed_rows.append({**rows[name], "bytes": len(actual), "sha256": digest(actual)})
        installed_inventory = {
            **inventory, "files": installed_rows,
            "standalone": {**inventory["standalone"], "files": sorted(bodies)},
            "selected_source_inventory": authority,
            "selected_standalone_manifest_sha256": digest(manifest_raw),
        }
        manifest_body = (json.dumps(installed_inventory, indent=2) + "\n").encode("utf-8")
        before[MANIFEST] = previous_raw
        if previous_raw != manifest_body:
            prepared[MANIFEST] = manifest_body
        else:
            reused.append(MANIFEST)
        result = {
            "format": "upper-savannah-measurement-large-install/v1", "version": VERSION,
            "application": str(root), "standalone": True, "dry_run": dry_run,
            "source_inventory": authority, "source_files": len(bodies), "runtime": runtime,
            "created": sorted(n for n in prepared if before[n] is None),
            "upgraded": sorted(n for n in prepared if before[n] is not None),
            "reused": sorted(reused), "preserved": [],
            "changed_files": [{"path": n, "bytes": len(b), "sha256": digest(b)}
                              for n, b in sorted(prepared.items())],
        }
        if dry_run or not prepared:
            return result
        saved = member(root, ".measurement-installations/" + digest(manifest_body) + "-standalone")
        saved.mkdir(parents=True, exist_ok=True)
        # Retain the first complete preimages before publishing any selected file.
        for name, old in before.items():
            if old is None:
                continue
            backup = member(saved, "before/" + name)
            prior = read(saved, "before/" + name, optional=True)
            if prior is None:
                atomic(backup, old, platform=install_files)
            elif prior != old:
                selected = prepared.get(name, bodies.get(name, manifest_body))
                if old != selected:
                    raise ValueError("Retained installation preimage differs: " + name)
        for name, old in before.items():
            if read(root, name, optional=True) != old:
                raise ValueError("Source changed during installation: " + name)
        committed = []
        try:
            # The installed inventory is the last published member. An interrupted
            # retry admits identical postimages and exact retained predecessors.
            for name in sorted(prepared, key=lambda n: (n == MANIFEST, n)):
                target = member(root, name)
                if read(root, name, optional=True) != before[name]:
                    raise ValueError("Source changed during installation: " + name)
                committed.append(name)
                atomic(target, prepared[name], platform=install_files)
            result["state"] = "installed"
            atomic(member(saved, "installation.json"), (json.dumps(result, indent=2) + "\n").encode("utf-8"),
                   platform=install_files)
            return result
        except BaseException as failure:
            conflicts = []
            for name in reversed(committed):
                try:
                    target = member(root, name)
                    now = read(root, name, optional=True)
                    if now == before[name]:
                        continue
                    if now != prepared[name]:
                        conflicts.append(name)
                        continue
                    if before[name] is None:
                        target.unlink()
                    else:
                        atomic(target, before[name], platform=install_files)
                except (OSError, ValueError):
                    conflicts.append(name)
            if conflicts:
                raise RuntimeError("Preserved independently changed files during rollback: " + ", ".join(conflicts)) from failure
            raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--standalone", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    options = parser.parse_args()
    print(json.dumps(install(options.application, options.source_root,
                             standalone=options.standalone, dry_run=options.dry_run), indent=2))
