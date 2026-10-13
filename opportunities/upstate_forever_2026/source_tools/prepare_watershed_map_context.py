#!/usr/bin/env python3
"""Prepare the retained original watershed map beside the existing application."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tempfile

DIRECTORY = "observations/watershed_profile_overlay_20261013"
MANIFEST = DIRECTORY + "/model-sources.json"
MANIFEST_SHA256 = "8865591376980d904f245b92f847367d2fa7ef4bc9e0194c53ce3df87b1147e3"
PROFILE_DIRECTORY = "observations/landcover_observation_profiles_20261013"
PARSER = PROFILE_DIRECTORY + "/profiles_core.mjs"


def digest(body):
    return hashlib.sha256(body).hexdigest()


def relative(name):
    if (not isinstance(name, str) or not name or "\\" in name
            or any(ord(c) < 32 for c in name)
            or PurePosixPath(name).is_absolute()
            or any(p in ("", ".", "..") for p in name.split("/"))
            or PurePosixPath(name).as_posix() != name):
        raise ValueError("Choose an original canonical source member")
    return name


def identity(body, declared):
    return len(body) == declared["bytes"] and digest(body) == declared["sha256"]


def owned_file(root, name):
    candidate = root / relative(name)
    if not candidate.exists():
        return None
    resolved = candidate.resolve(strict=True)
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise ValueError("Source member leaves its declared application: " + name)
    return resolved


def original_member(roots, names, declared):
    changed = []
    for root in roots:
        for name in names:
            path = owned_file(root, name)
            if path is None:
                continue
            if path.stat().st_size != declared["bytes"]:
                changed.append(str(path))
                continue
            body = path.read_bytes()
            if identity(body, declared):
                return body, str(path)
            changed.append(str(path))
    suffix = "; different retained bodies: " + ", ".join(changed) if changed else ""
    raise ValueError("The prepared source needs the complete original " + names[0] + suffix)


def domain_body(path, expected, *, explicit=False):
    path = Path(path).resolve(strict=True)
    if not path.is_file():
        raise ValueError("Choose a retained original domain file")
    if path.stat().st_size > expected["bytes"]:
        if explicit:
            raise ValueError("Original domain exceeds its retained byte count")
        return None
    with path.open("rb") as stream:
        magic = stream.read(2)
    try:
        opener = gzip.open if magic == b"\x1f\x8b" else open
        with opener(path, "rb") as stream:
            body = stream.read(expected["bytes"] + 1)
    except (OSError, EOFError):
        if explicit:
            raise
        return None
    if identity(body, expected):
        return body
    if explicit:
        raise ValueError("The selected domain differs from the retained original source: " + str(path))
    return None



def workspace_domain(root, expected):
    """Resolve immutable source objects without requiring lazy source views."""
    direct = owned_file(root, "objects/" + expected["sha256"])
    if direct is not None:
        body = domain_body(direct, expected)
        if body is not None:
            return body, str(direct)
    directory = root / "sources"
    if not directory.is_dir() or directory.is_symlink():
        return None
    for record in sorted(directory.glob("*.json")):
        if record.is_symlink() or not record.resolve(strict=True).is_relative_to(root):
            continue
        value = json.loads(record.read_bytes())
        if not isinstance(value, dict) or value.get("schema") != "upstate.sources/v1":
            continue
        for entry in value.get("entries", []):
            if not isinstance(entry, dict):
                continue
            for item in [entry.get("body")] + entry.get("companions", []):
                if not isinstance(item, dict) or not isinstance(item.get("object"), str):
                    continue
                size, checksum = item.get("bytes"), item.get("sha256")
                source_name = str(item.get("source_path") or item.get("filename") or "").lower()
                if (not isinstance(size, int) or isinstance(size, bool) or size <= 0
                        or size > expected["bytes"] or not isinstance(checksum, str)
                        or len(checksum) != 64
                        or any(c not in "0123456789abcdef" for c in checksum)):
                    continue
                if size != expected["bytes"] and not source_name.endswith(".gz"):
                    continue
                path = owned_file(root, item["object"])
                if path is None or path.stat().st_size != size:
                    continue
                if digest(path.read_bytes()) != checksum:
                    continue
                body = domain_body(path, expected)
                if body is not None:
                    return body, str(path)
    return None


def find_domain(roots, explicit, expected):
    if explicit:
        path = Path(explicit).resolve(strict=True)
        return domain_body(path, expected, explicit=True), str(path)
    seen = set()
    for root in roots:
        retained = workspace_domain(root, expected)
        if retained is not None:
            return retained
        direct = owned_file(root, DIRECTORY + "/original-domain.esri.json")
        if direct is not None:
            body = domain_body(direct, expected)
            if body is not None:
                return body, str(direct)
        # Search only the supplied source roots. Ignore symlinks and non-JSON/gzip
        # files; file size and the original full-body hash determine acceptance.
        for parent, directories, filenames in os.walk(root, followlinks=False):
            if "workspace.json" in filenames and Path(parent) != root:
                retained = workspace_domain(Path(parent), expected)
                if retained is not None:
                    return retained
            directories[:] = sorted(name for name in directories
                                    if not name.startswith(".")
                                    and not (Path(parent) / name).is_symlink())
            for name in sorted(filenames):
                path = Path(parent) / name
                if path.is_symlink() or not name.lower().endswith((".json", ".geojson", ".gz")):
                    continue
                resolved = path.resolve(strict=True)
                if not resolved.is_relative_to(root) or resolved in seen:
                    continue
                seen.add(resolved)
                size = resolved.stat().st_size
                if size != expected["bytes"] and not (name.lower().endswith(".gz") and size < expected["bytes"]):
                    continue
                body = domain_body(resolved, expected)
                if body is not None:
                    return body, str(resolved)
    raise ValueError("Original domain was not found in the supplied retained roots. "
                     "Pass --original-domain with its unchanged JSON or gzip source.")


def retain_exact(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("Prepared source target is a symlink: " + str(path))
    if path.exists():
        if not path.is_file() or path.read_bytes() != body:
            raise ValueError("Different source already occupies " + str(path))
        return
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if not path.is_file() or path.is_symlink() or path.read_bytes() != body:
                raise ValueError("Different source appeared at " + str(path))
    finally:
        os.unlink(temporary)


def prepare(application, source_root, *, original_domain=None, search_roots=(), node="node"):
    application = Path(application).resolve(strict=True)
    source_root = Path(source_root).resolve(strict=True)
    if not application.is_dir() or not source_root.is_dir():
        raise ValueError("Choose the existing application and prepared source directories")
    roots = list(dict.fromkeys([source_root, application]))
    search = list(dict.fromkeys(roots + [Path(p).resolve(strict=True) for p in search_roots]))
    if any(not root.is_dir() for root in search):
        raise ValueError("Each original-domain search root must be an existing directory")
    manifest_body = None
    for root in roots:
        path = owned_file(root, MANIFEST)
        if path is not None and digest(path.read_bytes()) == MANIFEST_SHA256:
            manifest_body = path.read_bytes()
            break
    if manifest_body is None:
        raise ValueError("The prepared source needs the original map manifest " + MANIFEST_SHA256)
    manifest = json.loads(manifest_body)
    entries = manifest.get("entries")
    if manifest.get("schema") != "upstate.sources/v1" or not isinstance(entries, list) or len(entries) != 1:
        raise ValueError("Choose the retained original watershed map manifest")
    entry = entries[0]
    declarations = {relative(row["path"]): row for row in [entry] + entry["companions"]}
    if len(declarations) != 8:
        raise ValueError("The original map manifest must retain all eight physical members")
    geometry_name = relative(entry["path"])
    domain_name = "original-domain.esri.json"
    bodies = {MANIFEST: manifest_body}
    origins = {MANIFEST: "original retained manifest"}
    for name, declared in declarations.items():
        if name in (geometry_name, domain_name):
            continue
        candidates = [DIRECTORY + "/" + name]
        if name == "watershed-profiles.csv":
            candidates.append(PROFILE_DIRECTORY + "/" + name)
        body, origin = original_member(roots, candidates, declared)
        bodies[DIRECTORY + "/" + name] = body
        origins[DIRECTORY + "/" + name] = origin
    binding = json.loads(bodies[DIRECTORY + "/overlay-binding.json"])
    parser_body = None
    for root in roots:
        path = owned_file(root, PARSER)
        if path is not None:
            candidate = path.read_bytes()
            if digest(candidate) == binding["source_methods"]["profiles_core_sha256"]:
                parser_body = candidate
                origins[PARSER] = str(path)
                break
    if parser_body is None:
        raise ValueError("Retain the original profile parser alongside the overlay builder")
    bodies[PARSER] = parser_body
    original, original_path = find_domain(search, original_domain, declarations[domain_name])
    bodies[DIRECTORY + "/" + domain_name] = original
    origins[DIRECTORY + "/" + domain_name] = original_path
    rebuilt = False
    try:
        geometry, origin = original_member(roots, [DIRECTORY + "/" + geometry_name], entry)
    except ValueError:
        executable = shutil.which(node)
        if executable is None:
            raise ValueError("The unchanged original overlay builder requires the existing Node executable")
        with tempfile.TemporaryDirectory(prefix=".watershed-map-prepare-", dir=source_root) as temporary:
            stage = Path(temporary)
            for name, body in bodies.items():
                target = stage / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(body)
            output = stage / DIRECTORY / geometry_name
            command = [executable, str(stage / DIRECTORY / "rebuild.mjs"),
                       "--source-dir", str(stage / DIRECTORY),
                       "--original-domain", str(stage / DIRECTORY / domain_name),
                       "--output", str(output)]
            subprocess.run(command, check=True)
            geometry = output.read_bytes()
            if not identity(geometry, entry):
                raise ValueError("The maintained builder did not produce the exact original overlay")
        origin = "unchanged retained overlay builder"
        rebuilt = True
    bodies[DIRECTORY + "/" + geometry_name] = geometry
    origins[DIRECTORY + "/" + geometry_name] = origin
    # Preflight every destination before retaining any prepared source.
    for name, body in bodies.items():
        path = source_root / relative(name)
        parent = path.parent
        while not parent.exists():
            parent = parent.parent
        if not parent.resolve(strict=True).is_relative_to(source_root) or path.is_symlink():
            raise ValueError("Prepared map destination leaves its source root")
        if path.exists() and (not path.is_file() or path.read_bytes() != body):
            raise ValueError("Different prepared source already occupies " + str(path))
    for name, body in bodies.items():
        retain_exact(source_root / name, body)
    return {
        "schema": "upstate.watershed-map-preparation/v1",
        "application": str(application), "source_root": str(source_root),
        "manifest_sha256": MANIFEST_SHA256, "geometry_rebuilt": rebuilt,
        "feature_count": entry["metadata"]["feature_count"],
        "vertex_count": entry["metadata"]["vertex_count"],
        "files": [{"path": name, "bytes": len(body), "sha256": digest(body),
                   "received_from": origins[name]} for name, body in sorted(bodies.items())],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--original-domain")
    parser.add_argument("--search-root", action="append", default=[])
    parser.add_argument("--node", default="node")
    parser.add_argument("--install", action="store_true",
                        help="Run the maintained regional installer after exact map preparation")
    args = parser.parse_args()
    result = prepare(args.application, args.source_root, original_domain=args.original_domain,
                     search_roots=args.search_root, node=args.node)
    print(json.dumps(result, indent=2, sort_keys=True), flush=True)
    if args.install:
        source = Path(args.source_root).resolve(strict=True)
        installer = owned_file(source, "operator/install_watershed_context.py")
        if installer is None:
            raise ValueError("The prepared source needs the complete current regional installer")
        subprocess.run([sys.executable, "-B", str(installer), "--application",
                        str(Path(args.application).resolve(strict=True)), "--source-root", str(source)],
                       check=True)


if __name__ == "__main__":
    main()
