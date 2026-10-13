"""Reuse an installed Node dependency tree through the original native worker.

The selected lockfile still owns package layout. This module checks installed
manifests and command links; runtime_consumers owns their live use and retirement.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import stat
from types import SimpleNamespace

import node_lockfile_cache as cache

SCHEMA = "commons.node_dependency_borrow/v1"


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=True).encode()).hexdigest()


def absolute(path, project):
    value = Path(path).expanduser()
    return Path(os.path.abspath(value if value.is_absolute() else project / value))


def identity(path):
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode):
        raise ValueError("Borrow an installed node_modules directory: " + str(path))
    return {"path": str(path), "device": info.st_dev, "inode": info.st_ino}


def metadata_source(root):
    """Use a retained installation index when that installer supplied one."""
    candidates = [(root / ".package-lock.json", "npm"),
                  (root / cache.RECEIPT, "lockfile-recovery")]
    if root.name == "node_modules":
        candidates.extend((root.parent / name, "npm")
                          for name in ("npm-shrinkwrap.json", "package-lock.json"))
    for path, kind in candidates:
        if not path.exists():
            continue
        value, sha = cache.read_json(path)
        if not isinstance(value, dict):
            raise ValueError("Installed dependency metadata is not an object: " + str(path))
        if kind == "npm":
            if value.get("lockfileVersion") not in (2, 3) or not isinstance(value.get("packages"), dict):
                raise ValueError("Installed dependency index must use npm lockfile v2 or v3: " + str(path))
            entries = value["packages"]
        else:
            if value.get("schema") != cache.SCHEMA or value.get("outcome") != "materialized":
                raise ValueError("Installed recovery metadata is incomplete: " + str(path))
            rows = value.get("packages")
            if not isinstance(rows, list):
                raise ValueError("Installed recovery metadata has no package layout: " + str(path))
            if any(not isinstance(row, dict) or not isinstance(row.get("path"), str) for row in rows):
                raise ValueError("Installed recovery metadata has a malformed package location: " + str(path))
            entries = {row["path"]: row for row in rows}
            if len(entries) != len(rows):
                raise ValueError("Installed recovery metadata repeats a package location: " + str(path))
        return {"path": str(path), "sha256": sha, "kind": kind}, entries
    return None, {}


def source_identity(value):
    # SRI can contain several algorithms; use the original materializer's choice.
    _, algorithm, raw = cache.package_cache.integrity(value)
    return algorithm, raw.hex()


def destination_state(project, source):
    destination = project / "node_modules"
    if not os.path.lexists(destination):
        return "create_link"
    try:
        actual = destination.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise ValueError("Project node_modules is an existing unresolved link; retain it and select its original recovery.") from exc
    if actual != source:
        raise ValueError("Project node_modules already selects a different installation: " + str(destination))
    if not actual.is_dir():
        raise ValueError("Project node_modules is not an installed directory.")
    return "reuse"


def child_packages(directory):
    """Read only one Node resolution level, without traversing package bodies."""
    if not directory.exists():
        return []
    if not directory.is_dir():
        raise ValueError("Nested node_modules is not a directory: " + str(directory))
    values = []
    for entry in sorted(directory.iterdir(), key=lambda value: value.name):
        if entry.name.startswith("."):
            continue
        if entry.name.startswith("@"):
            if not entry.is_dir():
                raise ValueError("Installed package scope is not a directory: " + str(entry))
            values.extend(child for child in sorted(entry.iterdir(), key=lambda value: value.name)
                          if not child.name.startswith("."))
        else:
            values.append(entry)
    return values


def build_plan(args, lockfile, project, *, capture_materialization=False):
    # Reuse the original selection, platform, workspace and path interpretation.
    arguments = SimpleNamespace(lockfile=str(lockfile), cache_root=[], omit=args.omit,
        target_os=args.target_os, target_cpu=args.target_cpu, target_libc=args.target_libc)
    selected = cache.build_plan(arguments)
    plan = {**selected, "schema": SCHEMA, "method": "borrow",
            "missing": [], "source": None, "source_metadata": None,
            "destination": str(project / "node_modules"), "stage": None,
            "action": None, "inventory_sha256": None, "installed": [], "bins": []}
    errors = plan["errors"]
    # Missing npm archives do not affect an existing installed tree.
    plan["counts"] = {**plan["counts"], "missing": 0, "matched": 0,
                      "package_bytes_written": 0, "archive_bytes_read": 0}
    try:
        requested = absolute(args.borrow_node_modules, project)
        root = requested.resolve(strict=True)
        plan["source"] = {"selected_path": str(requested), **identity(root)}
        materialized = bool(getattr(args, "materialize_borrowed", False))
        if getattr(args, "reuse_node_modules", []) and not materialized:
            raise ValueError("--reuse-node-modules requires --materialize-borrowed.")
        if materialized:
            import node_dependency_materialize as storage
            plan["action"] = storage.destination_state(project)
        else:
            plan["action"] = destination_state(project, root)
        plan["source_metadata"], retained = metadata_source(root)
        paths = {item["path"] for item in plan["packages"]}
        for skipped in plan["skipped"]:
            path = root.joinpath(*cache.install_parts(skipped["path"])[1:])
            if os.path.lexists(path):
                errors.append(cache.issue("BORROW_OMITTED",
                    "The selected installation still contains this omitted or incompatible package.",
                    skipped["path"]))
        for item in plan["packages"]:
            location = item["path"]
            try:
                parts = cache.install_parts(location)
                package = root.joinpath(*parts[1:])
                resolved = package.resolve(strict=True)
                package_identity = identity(resolved)
                metadata, manifest_sha = cache.read_json(package / "package.json")
                if not isinstance(metadata, dict):
                    raise ValueError("Installed package manifest is not an object.")
                if metadata.get("name") != item["name"] or (item["version"] is not None
                        and metadata.get("version") != item["version"]):
                    raise ValueError("Installed package name or version differs from the original lockfile.")
                if item["kind"] == "workspace_link" and resolved != Path(item["source"]):
                    raise ValueError("Installed workspace link selects different project source.")
                original = retained.get(location)
                if original is not None:
                    if not isinstance(original, dict):
                        raise ValueError("Installed source index has a malformed package entry.")
                    if original.get("version") is not None and original["version"] != metadata.get("version"):
                        raise ValueError("Installed source index and manifest versions differ.")
                    if item.get("integrity") and original.get("integrity"):
                        if source_identity(item["integrity"]) != source_identity(original["integrity"]):
                            raise ValueError("Installed source index and original lockfile select different package archives.")
                # Extra top-level packages may be shared. An extra nested package
                # can shadow the dependency selected by this project's lockfile.
                for nested in child_packages(package / "node_modules"):
                    nested_location = location + "/node_modules/" + nested.relative_to(package / "node_modules").as_posix()
                    if nested_location not in paths:
                        errors.append(cache.issue("BORROW_SHADOW",
                            "An extra nested package changes the selected lockfile resolution.", nested_location))
                width = 2 if parts[-2].startswith("@") else 1
                modules = root.joinpath(*parts[1:-width])
                for name, relative in cache.bin_entries(item, metadata).items():
                    executable = package.joinpath(*cache.package_cache.member_path(relative)).resolve(strict=True)
                    if not executable.is_file() or not os.access(executable, os.X_OK):
                        raise ValueError("Installed package executable is absent or not executable: " + name)
                    link = modules / ".bin" / name
                    if link.resolve(strict=True) != executable:
                        raise ValueError("Installed command link selects a different package executable: " + name)
                    plan["bins"].append({"path": str(link), "resolved": str(executable)})
                plan["installed"].append({"path": location, "name": metadata["name"],
                    "version": metadata.get("version"), "manifest_sha256": manifest_sha,
                    "resolved": package_identity})
            except (OSError, ValueError, RuntimeError, cache.package_cache.SourceError) as exc:
                errors.append(cache.issue("BORROW_PACKAGE", str(exc), location))
        plan["counts"]["matched"] = len(plan["installed"])
        materialization_binding = {}
        if materialized and not errors:
            public, private = storage.build(root, project / "node_modules",
                reuse_roots=getattr(args, "reuse_node_modules", []),
                reference=getattr(args, "immutable_source_reference", None))
            plan["method"] = "materialize"
            plan["materialization"] = public
            materialization_binding = {"materialization_sha256": public["selection_sha256"]}
            if capture_materialization:
                plan["_materialization"] = private
        plan["inventory_sha256"] = digest({"lockfile_sha256": plan["lockfile"]["sha256"],
            "target": plan["target"], "omit": plan["omit"], "source": plan["source"],
            "installed": plan["installed"], "bins": plan["bins"], **materialization_binding})
    except (OSError, ValueError, RuntimeError, cache.package_cache.SourceError) as exc:
        errors.append(cache.issue("BORROW_SOURCE", str(exc)))
    plan["counts"]["errors"] = len(errors)
    plan["outcome"] = "error" if errors else "planned"
    return plan


def attach(plan, expected_sha256):
    """Publish one original dependency selection without replacing another entry."""
    materialization = plan.pop("_materialization", None)
    if plan["outcome"] != "planned":
        return
    if plan["inventory_sha256"] != expected_sha256:
        raise ValueError("Selected installed dependency identity changed before this operation ran; inspect the donor and select a new operation.")
    root = Path(plan["source"]["path"])
    selected = Path(plan["source"]["selected_path"])
    if selected.resolve(strict=True) != root or identity(root) != {
            name: plan["source"][name] for name in ("path", "device", "inode")}:
        raise ValueError("Selected installed dependency root changed before attachment.")
    lockfile = Path(plan["lockfile"]["path"])
    if hashlib.sha256(lockfile.read_bytes()).hexdigest() != plan["lockfile"]["sha256"]:
        raise ValueError("Original lockfile changed during dependency attachment.")
    destination = Path(plan["destination"])
    if plan.get("method") == "materialize":
        if materialization is None:
            raise ValueError("Use original node-deps prepare to capture the installed source selection.")
        import node_dependency_materialize as storage
        result = storage.materialize(plan["materialization"], materialization)
        plan["materialization"] = result
        plan["counts"]["package_bytes_written"] = result["file_bytes_written"]
        plan.update({"outcome": "materialized", "attachment": {
            "path": str(destination), "target": str(destination),
            "action": result["action"]}})
        return
    action = destination_state(destination.parent, root)
    if action == "create_link":
        try:
            # symlink creation itself is atomic and never replaces an existing
            # file, directory or dangling link created by another owner.
            destination.symlink_to(root, target_is_directory=True)
            action = "created"
        except FileExistsError:
            destination_state(destination.parent, root)
            action = "reused"
    else:
        action = "reused"
    if destination.resolve(strict=True) != root:
        raise ValueError("Project dependency link changed during attachment.")
    plan.update({"outcome": "borrowed", "attachment": {"path": str(destination),
        "target": str(root), "action": action}})
