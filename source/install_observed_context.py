"""Apply the observed-context additions without replacing shared application files."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import tempfile

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def patch_text(body, edits, name):
    for edit in edits:
        old, new = edit["old"], edit["next"]
        if body.count(new) == 1 and not body.replace(new, "", 1).count(old):
            continue
        candidates = [candidate for candidate in [old] + edit.get("previous", [])
                      if body.count(candidate) == 1]
        if len(candidates) != 1:
            raise ValueError("Current " + name + " does not have the unique maintained seam: " + edit["label"])
        body = body.replace(candidates[0], new, 1)
    return body

def add_static_asset(body):
    tree = ast.parse(body)
    candidates = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Compare) and isinstance(node.left, ast.Name)
                and node.left.id == "selected" and len(node.ops) == 1
                and isinstance(node.ops[0], ast.NotIn)
                and len(node.comparators) == 1):
            # Current host composes its original literal assets with extension assets.
            for selected in ast.walk(node.comparators[0]):
                if not isinstance(selected, ast.Set):
                    continue
                if all(isinstance(x, ast.Constant) and isinstance(x.value, str) for x in selected.elts):
                    values = [x.value for x in selected.elts]
                    if {"index.html", "app.mjs", "spatial.mjs"}.issubset(values):
                        candidates.append((selected, values))
    if len(candidates) != 1:
        raise ValueError("Select the maintained operator's unique static-asset allowlist")
    node, values = candidates[0]
    if "observed_series.mjs" in values:
        return body
    # AST column offsets are UTF-8 byte offsets; preserve the rest of the current host exactly.
    lines = body.encode("utf-8").splitlines(keepends=True)
    first = sum(len(line) for line in lines[:node.lineno-1]) + node.col_offset
    last = sum(len(line) for line in lines[:node.end_lineno-1]) + node.end_col_offset
    addition = "{" + ", ".join(repr(x) for x in values + ["observed_series.mjs"]) + "}"
    raw = body.encode("utf-8")
    return (raw[:first] + addition.encode("utf-8") + raw[last:]).decode("utf-8")

def atomic(path, raw):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".observed-context-", delete=False) as stream:
        pending = Path(stream.name)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(pending, path.stat().st_mode & 0o777)
    os.replace(pending, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def install(application, receipt):
    root = Path(application).resolve(strict=True)
    patch_path = root / "source/observed_context_patch.json"
    patch = json.loads(patch_path.read_text(encoding="utf-8"))
    if patch.get("schema") != "upstate.observed-context-patch/v1":
        raise ValueError("Choose the original observed-context component")
    changes = []
    for name, edits in patch["edits"].items():
        path = root / name
        original = path.read_bytes()
        current = original.decode("utf-8")
        updated = patch_text(current, edits, name)
        if name.endswith(".py"):
            ast.parse(updated, filename=name)
        changes.append((path, original, updated.encode("utf-8")))
    path = root / "operator/server.py"
    original = path.read_bytes()
    updated = add_static_asset(original.decode("utf-8")).encode("utf-8")
    ast.parse(updated.decode("utf-8"), filename=str(path))
    changes.append((path, original, updated))
    for name, expected in patch["additions"].items():
        path = root / name
        body = path.read_bytes()
        if sha(body) != expected["sha256"] or len(body) != expected["bytes"]:
            raise ValueError("The received complete component differs: " + name)
        if name.endswith(".py"):
            ast.parse(body.decode("utf-8"), filename=name)
    # Every source seam and complete added file has now passed preflight.
    backup = root / "source/observed-context-originals"
    backup.mkdir(parents=True, exist_ok=True)
    results = []
    for path, original, updated in changes:
        if path.read_bytes() != original:
            raise ValueError("The shared application changed during component preflight")
        before, after = sha(original), sha(updated)
        name = path.relative_to(root).as_posix()
        if original != updated:
            retained = backup / before
            if retained.exists() and retained.read_bytes() != original:
                raise ValueError("The retained original application source differs")
            if not retained.exists():
                with retained.open("xb") as stream:
                    stream.write(original)
                    stream.flush()
                    os.fsync(stream.fileno())
            atomic(path, updated)
        results.append({"path": name, "before_sha256": before, "sha256": after,
                        "bytes": len(updated), "changed": original != updated})
    result = {"schema": "upstate.observed-context-install/v1",
              "application": str(root), "patch_sha256": sha(patch_path.read_bytes()),
              "files": results}
    destination = Path(receipt)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, sort_keys=True))
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--receipt", required=True)
    args = parser.parse_args()
    install(args.application, args.receipt)

if __name__ == "__main__":
    main()
