"""Compose source-update Programme controls into the maintained application."""
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
    "model/programme_source_updates.py",
    "model/PROGRAMME_SOURCE_UPDATES.md",
    "operator/programme_source_updates.py",
    "operator/extensions/programme-source-updates.json",
    "operator/web/programme_source_updates.mjs",
    "operator/programme_source_updates_patch.json",
    "operator/install_programme_source_updates.py",
    "operator/PROGRAMME_SOURCE_UPDATES.md",
    "integration/component_fragments/programme-source-updates.json",
)
SHARED = "operator/web/programmes.mjs"


def _sha(body):
    return hashlib.sha256(body).hexdigest()


def _encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def patch_text(source, patches):
    for patch in patches:
        before, after = patch["before"], patch["after"]
        if source.count(after) == 1 and before not in source.replace(after, "", 1):
            continue
        if source.count(before) != 1:
            raise ValueError("Compose the current Programme source-update seam: " + patch["id"])
        source = source.replace(before, after, 1)
    for patch in patches:
        if source.count(patch["after"]) != 1:
            raise ValueError("A later join changed the Programme source-update seam: " + patch["id"])
    return source


def _atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, pending = tempfile.mkstemp(prefix=".programme-source-updates-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if path.exists():
            os.chmod(pending, path.stat().st_mode & 0o777)
        os.replace(pending, path)
    finally:
        if os.path.exists(pending):
            os.unlink(pending)


def install(application, source_root):
    root = Path(application).resolve(strict=True)
    source = Path(source_root).resolve(strict=True)
    for name in ("operator/extension_registry.py", "model/compute_programme.py",
                 "model/source_refresh.py", "model/workspace.py", "model/portable.py", SHARED):
        if not (root / name).is_file():
            raise ValueError("Receive the maintained Programme/source-update dependency: " + name)
    state = root / "operator/installed/programme-source-updates"
    state.mkdir(parents=True, exist_ok=True)
    with (state / "lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        spec_bytes = (source / "operator/programme_source_updates_patch.json").read_bytes()
        spec = json.loads(spec_bytes)
        if spec.get("schema") != "upstate.programme-source-updates-patch/v1":
            raise ValueError("Select the original Programme source-update composition")
        current_path, pending_path = state / "current.json", state / "pending.json"
        current = json.loads(current_path.read_text()) if current_path.exists() else {}
        pending = json.loads(pending_path.read_text()) if pending_path.exists() else {}
        candidates = {name: (source / name).read_bytes() for name in FILES}
        programme_source = (root / SHARED).read_text("utf-8")
        if "  function beginFormOpening() {" not in programme_source:
            raise ValueError("Receive the maintained Programme form continuation before this component")
        candidates[SHARED] = patch_text(programme_source, spec["patches"]).encode("utf-8")
        portable_source = (root / "model/portable.py").read_text("utf-8")
        candidates["model/portable.py"] = patch_text(portable_source, spec["portable_patches"]).encode("utf-8")
        originals = {}
        for name, data in candidates.items():
            if name.endswith(".py"):
                ast.parse(data.decode("utf-8"), filename=name)
            elif name.endswith(".json"):
                json.loads(data)
            target = root / name
            target.resolve().relative_to(root)
            if target.is_symlink():
                raise ValueError("Retain regular application source: " + name)
            old = target.read_bytes() if target.exists() else None
            originals[name] = old
            if name in FILES and old is not None and old != data:
                accepted = {record.get("files", {}).get(name, {}).get("sha256") for record in (current, pending)}
                accepted.update(spec.get("known_additions", {}).get(name, []))
                if _sha(old) not in accepted:
                    raise ValueError("An independently edited Programme source-update file needs composition: " + name)
        metadata = {name: {"bytes": len(data), "sha256": _sha(data)} for name, data in candidates.items()}
        if current.get("files") == metadata and all(originals[name] == data for name, data in candidates.items()):
            return current
        for original in originals.values():
            if original is not None:
                saved = state / "preimages" / _sha(original)
                if saved.exists() and saved.read_bytes() != original:
                    raise ValueError("An original Programme composition preimage differs")
                if not saved.exists():
                    _atomic(saved, original)
        result = {"schema": "upstate.programme-source-updates-install/v1", "version": "1.0.0",
                  "patch_sha256": _sha(spec_bytes), "files": metadata}
        _atomic(pending_path, _encoded(result))
        descriptor = "operator/extensions/programme-source-updates.json"
        for name in [item for item in candidates if item != descriptor] + [descriptor]:
            target = root / name
            if (target.read_bytes() if target.exists() else None) != originals[name]:
                raise ValueError("Application source changed during Programme composition: " + name)
            if originals[name] != candidates[name]:
                _atomic(target, candidates[name])
        _atomic(current_path, _encoded(result))
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args(argv)
    print(json.dumps(install(args.application, args.source_root), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
