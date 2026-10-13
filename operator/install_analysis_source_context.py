"""Compose original source context into the maintained Scenario analysis desk."""
from __future__ import annotations
import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile

ADDITIONS = (
    "model/analysis_source_context.py",
    "model/analysis_source_context_cli.py",
    "operator/analysis_source_context.py",
    "operator/extensions/analysis-source-context.json",
    "operator/web/analysis_source_context.mjs",
    "operator/analysis_source_context_patch.json",
    "operator/install_analysis_source_context.py",
    "operator/ANALYSIS_SOURCE_CONTEXT.md",
)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def encode(value):
    return (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def patch_text(body, edits):
    for edit in edits:
        old, new = edit["before"], edit["after"]
        if edit.get("retained_block"):
            if body.count(edit["retained_block"]) == 1:
                continue
            if edit.get("marker") in body:
                raise ValueError("Merge the changed source-context verification block: " + edit["label"])
        if body.count(new) == 1 and old not in body.replace(new, "", 1):
            continue
        if body.count(old) != 1:
            raise ValueError("Merge the maintained current source seam: " + edit["label"])
        body = body.replace(old, new, 1)
    return body


def atomic(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".analysis-source-context-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        if path.exists():
            os.chmod(temporary, path.stat().st_mode & 0o777)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install(application, source_root):
    root, source = Path(application).resolve(strict=True), Path(source_root).resolve(strict=True)
    for name in ("operator/extension_registry.py", "source/retained_point_sources.py",
                 "source/observation_source_calendar.py", "model/scenario_analysis.py"):
        if not (root / name).is_file():
            raise ValueError("Receive the maintained native analysis and original point-source component: " + name)
    state = root / "operator/installed/analysis-source-context"
    state.mkdir(parents=True, exist_ok=True)
    with (state / "lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        spec = json.loads((source / "operator/analysis_source_context_patch.json").read_text())
        if spec.get("schema") != "upstate.analysis-source-context-patch/v1":
            raise ValueError("Select the original source-context composition")
        current_path, pending_path = state / "current.json", state / "pending.json"
        current = json.loads(current_path.read_text()) if current_path.exists() else {}
        pending = json.loads(pending_path.read_text()) if pending_path.exists() else {}
        candidates = {name: (source / name).read_bytes() for name in ADDITIONS}
        # Complete shared postimages in this bank are review copies. Compose into the live source.
        for name, edits in spec["files"].items():
            if name not in ("operator/web/scenario_analysis.mjs", "operator/install_point_source_context.py", "model/portable.py"):
                raise ValueError("An unexpected shared file was selected")
            candidates[name] = patch_text((root / name).read_text(), edits).encode()
        originals = {}
        for name, body in candidates.items():
            if name.endswith(".py"):
                ast.parse(body.decode(), filename=name)
            if name.endswith(".json"):
                json.loads(body)
            path = root / name
            path.resolve().relative_to(root)
            if path.is_symlink():
                raise ValueError("Use regular retained source files: " + name)
            old = path.read_bytes() if path.exists() else None
            originals[name] = old
            if name in ADDITIONS and old is not None and old != body:
                known = {row.get("files", {}).get(name, {}).get("sha256") for row in (current, pending)}
                known.update(spec.get("known_additions", {}).get(name, []))
                if sha(old) not in known:
                    raise ValueError("An independently edited source-context component needs a source merge: " + name)
        target = {name: {"sha256": sha(body), "bytes": len(body)} for name, body in candidates.items()}
        if current.get("files") == target and all(originals[name] == body for name, body in candidates.items()):
            return current
        for old in originals.values():
            if old is None:
                continue
            path = state / "preimages" / sha(old)
            if path.exists() and path.read_bytes() != old:
                raise ValueError("A retained composition preimage differs")
            if not path.exists():
                atomic(path, old)
        receipt = {"schema": "upstate.analysis-source-context-install/v1", "version": "1.1.0",
                   "files": target, "patch_sha256": sha((source / "operator/analysis_source_context_patch.json").read_bytes())}
        atomic(pending_path, encode(receipt))
        descriptor = "operator/extensions/analysis-source-context.json"
        order = [name for name in candidates if name != descriptor] + [descriptor]
        for name in order:
            path, body = root / name, candidates[name]
            if (path.read_bytes() if path.exists() else None) != originals[name]:
                raise ValueError("Application source changed during contextual report composition: " + name)
            if originals[name] != body:
                atomic(path, body)
        atomic(current_path, encode(receipt))
        return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source_root), sort_keys=True))


if __name__ == "__main__":
    main()
