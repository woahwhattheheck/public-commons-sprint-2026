"""Compose Observed Context v3 and physical measurement support into an existing application."""
from __future__ import annotations
import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile

ADDITIONS = [
    "model/observation_support.py", "operator/web/observation_support.mjs",
    "source/import_observation_support.py", "source/observation_source_calendar.py", "source/OBSERVATION_SUPPORT.md",
    "source/observation_support_patch.json", "source/install_observation_support.py",
    "source/import_observed_context.py", "operator/web/observed_series.mjs",
    "source/install_observed_context.py", "source/OBSERVED_CONTEXT.md",
    "source/observed_context_patch.json",
]


def sha(body):
    return hashlib.sha256(body).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def patch_text(body, edits, path):
    for edit in edits:
        old, new = edit["old"], edit["next"]
        if body.count(new) == 1 and not body.replace(new, "", 1).count(old):
            continue
        choices = [value for value in [old] + edit.get("previous", []) if body.count(value) == 1]
        if len(choices) != 1:
            raise ValueError("Current " + path + " needs its maintained source seam: " + edit["label"])
        body = body.replace(choices[0], new, 1)
    return body


def static_assets(body):
    tree = ast.parse(body)
    matches = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Compare) and isinstance(node.left, ast.Name)
                and node.left.id == "selected" and len(node.ops) == 1
                and isinstance(node.ops[0], ast.NotIn)):
            for value in ast.walk(node.comparators[0]):
                if isinstance(value, ast.Set) and all(isinstance(x, ast.Constant)
                        and isinstance(x.value, str) for x in value.elts):
                    names = [x.value for x in value.elts]
                    if {"index.html", "app.mjs", "spatial.mjs"}.issubset(names):
                        matches.append((value, names))
    if len(matches) != 1:
        raise ValueError("The existing operator needs its unique static-asset allowlist")
    node, names = matches[0]
    added = [name for name in ("observed_series.mjs", "observation_support.mjs") if name not in names]
    if not added:
        return body
    raw = body.encode()
    lines = raw.splitlines(keepends=True)
    first = sum(map(len, lines[:node.lineno-1])) + node.col_offset
    last = sum(map(len, lines[:node.end_lineno-1])) + node.end_col_offset
    return (raw[:first] + ("{" + ", ".join(repr(x) for x in names + added) + "}").encode()
            + raw[last:]).decode()


def atomic(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".observation-support-", dir=path.parent)
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
    state = root / "source/installed/observation-support"
    state.mkdir(parents=True, exist_ok=True)
    with (state / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        base = json.loads((source / "source/observed_context_patch.json").read_text())
        support = json.loads((source / "source/observation_support_patch.json").read_text())
        candidates, originals = {}, {}
        for name in ADDITIONS:
            body = (source / name).read_bytes()
            if name.endswith(".py"):
                ast.parse(body.decode(), filename=name)
            if name.endswith(".json"):
                json.loads(body)
            candidates[name] = body
        for name, changes in support["edits"].items():
            path = root / name
            original = path.read_bytes()
            body = original.decode()
            own_marker = ("from . import rasters, observation_support" if name.endswith(".py")
                          else "from './observation_support.mjs';")
            if name in base["edits"] and own_marker not in body:
                body = patch_text(body, base["edits"][name], name)
            body = patch_text(body, changes, name)
            if name.endswith(".py"):
                ast.parse(body, filename=name)
            candidates[name] = body.encode()
        path = root / "operator/server.py"
        candidates["operator/server.py"] = static_assets(path.read_text()).encode()
        ast.parse(candidates["operator/server.py"].decode())
        current_path, pending_path = state / "current.json", state / "pending.json"
        current = json.loads(current_path.read_text()) if current_path.exists() else {}
        pending = json.loads(pending_path.read_text()) if pending_path.exists() else {}
        target = {name: {"sha256": sha(body), "bytes": len(body)} for name, body in candidates.items()}
        for name, body in candidates.items():
            path = root / name
            if path.is_symlink():
                raise ValueError("Use regular retained application files: " + name)
            original = path.read_bytes() if path.exists() else None
            originals[name] = original
            if name in ADDITIONS and original is not None and original != body:
                allowed = {item.get(name, {}).get("sha256") for item in (
                    current.get("files", {}), pending.get("files", {}))}
                allowed.update(support.get("known_additions", {}).get(name, []))
                if sha(original) not in allowed:
                    raise ValueError("An independently changed component needs a source merge: " + name)
        if current.get("files") == target and all(originals[name] == body for name, body in candidates.items()):
            return current
        preimages = state / "preimages"
        preimages.mkdir(exist_ok=True)
        for original in originals.values():
            if original is not None:
                saved = preimages / sha(original)
                if saved.exists() and saved.read_bytes() != original:
                    raise ValueError("A retained preimage differs")
                if not saved.exists():
                    atomic(saved, original)
        intent = {"schema": "upstate.observation-support-install/v1", "files": target,
                  "source_patch_sha256": sha((source / "source/observation_support_patch.json").read_bytes())}
        atomic(pending_path, encoded(intent))
        for name, body in candidates.items():
            path = root / name
            if (path.read_bytes() if path.exists() else None) != originals[name]:
                raise ValueError("Application source changed during preflight: " + name)
            if originals[name] != body:
                atomic(path, body)
        atomic(current_path, encoded(intent))
        return intent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source_root), sort_keys=True))


if __name__ == "__main__":
    main()
