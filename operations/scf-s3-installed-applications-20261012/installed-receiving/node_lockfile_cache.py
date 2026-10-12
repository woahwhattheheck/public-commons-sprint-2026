#!/usr/bin/env python3
"""Recover an npm lockfile's exact archive-backed layout from retained caches."""
from __future__ import annotations

import argparse
import ctypes
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import stat
import sys
import tempfile
from types import SimpleNamespace

import node_package_cache as package_cache

SCHEMA = "commons.node_lockfile_cache/v1"
RECEIPT = ".commons-lockfile-recovery.json"


def issue(code, message, path=None):
    return {"code": code, "message": message, **({"path": path} if path else {})}


def read_json(path):
    with path.open("rb") as stream:
        body = stream.read(64 * 1024 * 1024 + 1)
    if len(body) > 64 * 1024 * 1024:
        raise ValueError("lockfile exceeds 64 MiB")
    return json.loads(body), hashlib.sha256(body).hexdigest()


def install_parts(value):
    """Validate the concrete npm layout, including nested and scoped packages."""
    parts = package_cache.member_path(value)
    index = 0
    while index < len(parts):
        if parts[index] != "node_modules" or index + 1 >= len(parts):
            raise ValueError("expected an exact node_modules package location")
        index += 1
        if parts[index].startswith("@"):
            if len(parts[index]) == 1 or index + 1 >= len(parts):
                raise ValueError("incomplete scoped package location")
            index += 1
        if parts[index] in ("node_modules", ".bin") or parts[index].startswith("."):
            raise ValueError("invalid package directory")
        index += 1
    return parts


def package_name(parts):
    return "/".join(parts[-2:]) if len(parts) > 1 and parts[-2].startswith("@") else parts[-1]


def target_default():
    architecture = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64",
                    "i386": "ia32", "i686": "ia32", "armv7l": "arm"}
    machine = platform.machine().lower()
    libc = platform.libc_ver()[0] or None
    return {"os": "win32" if sys.platform == "win32" else sys.platform,
            "cpu": architecture.get(machine, machine),
            "libc": "glibc" if libc == "glibc" else libc}


def matches_target(values, target):
    if not values:
        return True
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, list) or any(not isinstance(x, str) for x in values):
        raise ValueError("platform restriction must be text or an array of text")
    if target is None:
        return None
    if "!" + target in values or "!any" in values:
        return False
    positive = [x for x in values if not x.startswith("!")]
    return not positive or target in positive or "any" in positive


def cache_object(root, value):
    _, algorithm, digest = package_cache.integrity(value)
    key = digest.hex()
    return root / "content-v2" / algorithm / key[:2] / key[2:4] / key[4:]


def build_plan(args):
    lockfile = Path(args.lockfile).expanduser().resolve(strict=True)
    lock, digest = read_json(lockfile)
    if not isinstance(lock, dict) or lock.get("lockfileVersion") not in (2, 3):
        raise ValueError("use an existing package-lock.json or npm-shrinkwrap.json with lockfileVersion 2 or 3")
    packages = lock.get("packages")
    if not isinstance(packages, dict) or "" not in packages:
        raise ValueError("lockfile must contain the complete packages map and root entry")
    target = target_default()
    for field in target:
        selected = getattr(args, "target_" + field)
        if selected:
            target[field] = selected
    roots, errors = [], []
    for value in args.cache_root:
        try:
            root = Path(value).expanduser().resolve(strict=True)
            if not root.is_dir():
                raise ValueError("cache root is not a directory")
            if root not in roots:
                roots.append(root)
        except (OSError, ValueError) as exc:
            errors.append(issue("CACHE_ROOT", str(exc), value))
    result = {"schema": SCHEMA, "observed_at": datetime.now(timezone.utc).isoformat(),
              "lockfile": {"path": str(lockfile), "sha256": digest,
                           "version": lock["lockfileVersion"]},
              "target": target, "omit": sorted(set(args.omit)),
              "cache_roots": [str(x) for x in roots], "packages": [],
              "skipped": [], "missing": [], "errors": errors,
              "install_scripts": [], "destination": None, "stage": None,
              "outcome": "error"}
    excluded = set()
    for location, entry in sorted(packages.items(), key=lambda item: (item[0].count("/"), item[0])):
        if not location:
            continue
        if not isinstance(entry, dict):
            errors.append(issue("LOCK_ENTRY", "package entry is not an object", location))
            continue
        if not location.startswith("node_modules/"):
            if "/node_modules/" in location:
                errors.append(issue("WORKSPACE_LAYOUT", "workspace-local dependency layout needs its original npm workspace installer", location))
            continue  # workspace source metadata is inspected through its link below
        try:
            parts = install_parts(location)
        except (ValueError, package_cache.SourceError) as exc:
            errors.append(issue("LOCK_PATH", str(exc), location))
            continue
        reason = None
        if any(location.startswith(parent + "/") for parent in excluded):
            reason = "excluded parent"
        elif ("dev" in args.omit and entry.get("dev")) or ("optional" in args.omit and entry.get("optional")):
            reason = "omitted dependency class"
        elif entry.get("devOptional") and {"dev", "optional"}.issubset(args.omit):
            reason = "omitted dev and optional dependency classes"
        else:
            for field, current in target.items():
                try:
                    match = matches_target(entry.get(field), current)
                except ValueError as exc:
                    errors.append(issue("PLATFORM", str(exc), location))
                    match = None
                if match is None and entry.get(field):
                    errors.append(issue("PLATFORM", f"supply --target-{field} to evaluate this entry", location))
                elif match is False:
                    if entry.get("optional"):
                        reason = f"optional package excludes target {field}={current}"
                    else:
                        errors.append(issue("PLATFORM", f"required package excludes target {field}={current}", location))
        if reason:
            excluded.add(location)
            result["skipped"].append({"path": location, "reason": reason})
            continue
        item = {"path": location, "name": entry.get("name") or package_name(parts),
                "version": entry.get("version"), "kind": "archive", "candidates": []}
        if entry.get("link"):
            item["kind"] = "workspace_link"
            try:
                resolved = entry.get("resolved")
                if not isinstance(resolved, str):
                    raise ValueError("workspace link has no relative resolved path")
                package_cache.member_path(resolved)
                source = (lockfile.parent / resolved).resolve(strict=True)
                if lockfile.parent not in source.parents or not source.is_dir():
                    raise ValueError("workspace link must resolve to existing source below the lockfile directory")
                metadata, manifest_sha = read_json(source / "package.json")
                if not isinstance(metadata, dict):
                    raise ValueError("workspace manifest is not a JSON object")
                locked_source = packages.get(resolved, {})
                for field in ("name", "version"):
                    if field in locked_source and metadata.get(field) != locked_source[field]:
                        raise ValueError(f"workspace {field} differs from its locked source entry")
                item.update({"source": str(source), "name": metadata.get("name"),
                             "version": metadata.get("version"), "manifest_sha256": manifest_sha,
                             "bin": metadata.get("bin")})
            except (OSError, ValueError, package_cache.SourceError) as exc:
                errors.append(issue("WORKSPACE_LINK", str(exc), location))
        elif entry.get("inBundle"):
            item["kind"] = "bundled"
        else:
            try:
                if not isinstance(item["name"], str) or not isinstance(item["version"], str):
                    raise ValueError("archive package requires exact manifest name and version")
                value = entry.get("integrity")
                if not isinstance(value, str):
                    raise ValueError("archive package has no pinned integrity; use its original source road")
                package_cache.integrity(value)
                item["integrity"] = value
                for root in roots:
                    path = cache_object(root, value)
                    try:
                        observed = path.stat()
                    except FileNotFoundError:
                        continue
                    if not stat.S_ISREG(observed.st_mode):
                        errors.append(issue("CACHE_OBJECT", "cache object is not a regular file", str(path)))
                        continue
                    item["candidates"].append({"cache_root": str(root), "path": str(path), "bytes": observed.st_size})
                if not item["candidates"]:
                    result["missing"].append({key: item[key] for key in ("path", "name", "version", "integrity")})
            except (OSError, ValueError, argparse.ArgumentTypeError) as exc:
                errors.append(issue("LOCK_SOURCE", str(exc), location))
        if entry.get("hasInstallScript"):
            result["install_scripts"].append({"path": location, "source": "lockfile"})
        result["packages"].append(item)
    for item in result["packages"]:
        if item["kind"] == "workspace_link" and any(
            other["path"].startswith(item["path"] + "/") for other in result["packages"]
        ):
            errors.append(issue("WORKSPACE_LAYOUT", "linked workspace has nested dependencies; use its original workspace installer", item["path"]))
        if item["kind"] == "bundled" and not any(
            parent["kind"] == "archive" and item["path"].startswith(parent["path"] + "/node_modules/")
            for parent in result["packages"]
        ):
            errors.append(issue("BUNDLED_SOURCE", "bundled dependency has no selected parent archive", item["path"]))
    result["counts"] = {"selected": len(result["packages"]), "skipped": len(result["skipped"]),
                        "missing": len(result["missing"]), "errors": len(errors),
                        "unique_archives": len({x.get("integrity") for x in result["packages"] if x["kind"] == "archive"})}
    result["outcome"] = "error" if errors else "missing" if result["missing"] else "planned"
    return result


def write_json(path, data):
    with path.open("x", encoding="utf-8") as output:
        os.chmod(path, 0o600)
        json.dump(data, output, indent=2, ensure_ascii=True)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())


def bin_entries(item, metadata):
    bins = metadata.get("bin")
    if isinstance(bins, str):
        bins = {package_name(install_parts(item["path"])).rsplit("/", 1)[-1]: bins}
    if bins is None:
        return {}
    if not isinstance(bins, dict):
        raise ValueError(f"invalid bin map in {item['path']}")
    for name, value in bins.items():
        if not isinstance(name, str) or name in ("", ".", "..") or "/" in name or "\\" in name:
            raise ValueError(f"invalid executable name in {item['path']}")
        if not isinstance(value, str):
            raise ValueError(f"invalid executable target in {item['path']}")
        package_cache.member_path(value)
    return bins


def create_bins(stage, item, metadata):
    parts = install_parts(item["path"])
    package = stage.joinpath(*parts[1:])
    width = 2 if parts[-2].startswith("@") else 1
    modules = stage.joinpath(*parts[1:-width])
    created = []
    for name, value in bin_entries(item, metadata).items():
        relative = package_cache.member_path(value)
        executable = package.joinpath(*relative)
        if not executable.is_file() or package.resolve() not in executable.resolve().parents:
            raise ValueError(f"bin target is absent or outside package: {item['path']}:{name}")
        directory = modules / ".bin"
        directory.mkdir(exist_ok=True)
        link = directory / name
        target = os.path.relpath(executable, directory)
        if os.path.lexists(link):
            if not link.is_symlink() or os.readlink(link) != target:
                raise ValueError(f"conflicting bin entry: {link.relative_to(stage)}")
        else:
            link.symlink_to(target)
        if item["kind"] != "workspace_link":
            executable.chmod(executable.stat().st_mode | 0o111)
        created.append(str(link.relative_to(stage)))
    return created


def restore(args, plan):
    if plan["outcome"] != "planned":
        return
    requested = Path(args.destination).expanduser()
    parent = requested.parent.resolve(strict=True)
    destination = parent / requested.name
    if not requested.name or os.path.lexists(destination):
        raise ValueError("destination already exists or has no name; choose a new node_modules directory")
    for root in plan["cache_roots"]:
        cache = Path(root)
        if destination == cache or cache in destination.parents:
            raise ValueError("destination must be outside every source cache")
    for item in plan["packages"]:
        if item["kind"] == "workspace_link" and destination != Path(plan["lockfile"]["path"]).parent / "node_modules":
            raise ValueError("workspace links require the original project's new node_modules destination")
    stage = Path(tempfile.mkdtemp(prefix=f".{destination.name}-recovery-", dir=parent))
    plan.update({"destination": str(destination), "stage": str(stage), "restored": [], "bins": []})
    recovered = {}
    try:
        for item in plan["packages"]:
            if item["kind"] != "archive":
                continue
            package = stage.joinpath(*install_parts(item["path"])[1:])
            package.parent.mkdir(parents=True, exist_ok=True)
            identity = (item["name"], item["version"], item["integrity"])
            if identity in recovered:
                original, inventory, directories, source_result = recovered[identity]
                package.mkdir()
                for relative in directories:
                    (package / relative).mkdir(parents=True, exist_ok=True)
                for record in inventory:
                    target = package / record["path"]
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(original / record["path"], target)
                    target.chmod(record["mode"])
                    if target.stat().st_size != record["bytes"]:
                        raise ValueError(f"copied package file changed size: {item['path']}")
                plan["restored"].append({"path": item["path"], "source": source_result["source"],
                    "archive": source_result["archive"], "package": source_result["package"],
                    "reused_from": str(original.relative_to(stage))})
                continue
            attempt_errors = []
            for candidate in item["candidates"]:
                arguments = SimpleNamespace(cache_root=candidate["cache_root"], package=item["name"],
                    version=item["version"], integrity=package_cache.integrity(item["integrity"]),
                    destination=str(package), max_archive_bytes=args.max_archive_bytes,
                    max_tar_bytes=args.max_tar_bytes, max_members=args.max_members,
                    scratch_root=args.scratch_root, capture_paths=True)
                result = {"outcome": "error", "source": None, "archive": None, "package": None,
                          "destination": {"path": str(package), "created": False, "complete": False,
                                          "files_written": 0, "bytes_written": 0}}
                try:
                    code = package_cache.run(arguments, result)
                    if code:
                        raise ValueError("archive disappeared from this retained cache")
                    break
                except (package_cache.SourceError, ValueError) as exc:
                    attempt_errors.append({"cache_root": candidate["cache_root"], "message": str(exc)})
                    if result["destination"]["created"]:
                        raise ValueError(f"package write failed at {item['path']}: {exc}") from exc
            else:
                raise ValueError(f"no valid retained archive for {item['path']}: {attempt_errors}")
            recovered[identity] = (package, result.pop("recovery_paths"), result.pop("recovery_directories"), result)
            plan["restored"].append({"path": item["path"], "source": result["source"],
                                     "archive": result["archive"], "package": result["package"]})
            if result["package"]["install_scripts"]:
                plan["install_scripts"].append({"path": item["path"], "source": "archive",
                                                "names": list(result["package"]["install_scripts"])})
        for item in plan["packages"]:
            package = stage.joinpath(*install_parts(item["path"])[1:])
            if item["kind"] == "workspace_link":
                metadata, digest = read_json(Path(item["source"]) / "package.json")
                if digest != item["manifest_sha256"]:
                    raise ValueError(f"workspace manifest changed: {item['path']}")
                package.parent.mkdir(parents=True, exist_ok=True)
                # An absolute source link has the same target before and after atomic rename.
                package.symlink_to(item["source"], target_is_directory=True)
            else:
                metadata, digest = read_json(package / "package.json")
            if not isinstance(metadata, dict):
                raise ValueError(f"restored manifest is not an object: {item['path']}")
            if metadata.get("name") != item["name"] or (item["version"] is not None and metadata.get("version") != item["version"]):
                raise ValueError(f"restored manifest differs from lockfile at {item['path']}")
            plan["bins"].extend(create_bins(stage, item, metadata))
        current = hashlib.sha256(Path(plan["lockfile"]["path"]).read_bytes()).hexdigest()
        if current != plan["lockfile"]["sha256"]:
            raise ValueError("original lockfile changed during recovery")
        plan["outcome"] = "materialized"
        plan["stage"] = None
        plan["counts"]["archive_bytes_read"] = sum(x["archive"]["bytes"] for x in plan["restored"] if "reused_from" not in x)
        plan["counts"]["package_bytes_written"] = sum(x["archive"]["file_bytes"] for x in plan["restored"])
        write_json(stage / RECEIPT, plan)
        # Linux RENAME_NOREPLACE protects even an independently created empty directory.
        libc = ctypes.CDLL(None, use_errno=True)
        rename = getattr(libc, "renameat2", None)
        if rename is None:
            raise ValueError("atomic no-replace directory publication needs Linux renameat2")
        rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        if rename(-100, os.fsencode(stage), -100, os.fsencode(destination), 1) != 0:
            error = ctypes.get_errno()
            raise OSError(error, os.strerror(error), str(destination))
    except Exception:
        plan["outcome"] = "error"
        plan["stage"] = str(stage)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lockfile", required=True)
    parser.add_argument("--cache-root", action="append", required=True)
    parser.add_argument("--destination", help="new node_modules directory; omitted means inspect only")
    parser.add_argument("--omit", action="append", choices=("dev", "optional"), default=[])
    parser.add_argument("--target-os")
    parser.add_argument("--target-cpu")
    parser.add_argument("--target-libc")
    parser.add_argument("--scratch-root", help="existing directory for one compressed archive snapshot at a time")
    parser.add_argument("--max-archive-bytes", type=package_cache.positive_int, default=32 * 1024 * 1024)
    parser.add_argument("--max-tar-bytes", type=package_cache.positive_int, default=128 * 1024 * 1024)
    parser.add_argument("--max-members", type=package_cache.positive_int, default=20000)
    parser.add_argument("--out", help="save complete private JSON to a new file and print a compact summary")
    args = parser.parse_args(argv)
    plan = {"schema": SCHEMA, "outcome": "error", "errors": []}
    try:
        plan = build_plan(args)
        if args.destination:
            restore(args, plan)
    except (OSError, ValueError, RuntimeError, package_cache.SourceError) as exc:
        plan["outcome"] = "error"
        plan["errors"].append(issue(getattr(exc, "code", "RECOVERY"), str(exc)))
    if "counts" in plan:
        plan["counts"]["errors"] = len(plan["errors"])
    code = 0 if plan["outcome"] in ("planned", "materialized") else 1 if plan["outcome"] == "missing" else 2
    try:
        if args.out:
            write_json(Path(args.out).expanduser(), plan)
            print(json.dumps({key: plan.get(key) for key in
                              ("schema", "outcome", "counts", "destination", "stage", "errors")} | {"report": args.out}))
        else:
            print(json.dumps(plan, indent=2, ensure_ascii=True))
    except OSError as exc:
        print(json.dumps({"outcome": "error", "message": str(exc), "recovery_outcome": plan["outcome"],
                          "destination": plan.get("destination"), "stage": plan.get("stage")}), file=sys.stderr)
        return 2
    return code


if __name__ == "__main__":
    raise SystemExit(main())
