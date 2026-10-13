"""Add source-support design review to the maintained Calibration desk."""
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
    "operator/web/calibration_design.mjs",
    "operator/calibration_design_patch.json",
    "operator/install_calibration_design.py",
    "operator/CALIBRATION_DESIGN.md",
    "source/calibration-design/upper-savannah-reference-support.json",
]


def sha(body):
    return hashlib.sha256(body).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n").encode()


def patch_text(body, edits):
    for edit in edits:
        old, new = edit["old"], edit["next"]
        if body.count(new) == 1 and old not in body.replace(new, "", 1):
            continue
        if body.count(old) != 1:
            raise ValueError("Current Calibration source needs a maintained merge: " + edit["label"])
        body = body.replace(old, new, 1)
    return body


def atomic(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".calibration-design-", dir=path.parent)
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
    state = root / "operator/installed/calibration-design"
    state.mkdir(parents=True, exist_ok=True)
    with (state / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        spec = json.loads((source / "operator/calibration_design_patch.json").read_text())
        candidates = {name: (source / name).read_bytes() for name in ADDITIONS}
        current_path, pending_path = state / "current.json", state / "pending.json"
        current = json.loads(current_path.read_text()) if current_path.exists() else {}
        pending = json.loads(pending_path.read_text()) if pending_path.exists() else {}
        path = root / "operator/web/calibration.mjs"
        candidates["operator/web/calibration.mjs"] = patch_text(path.read_text(), spec["edits"]).encode()
        path = root / "operator/extensions/calibration.json"
        descriptor = json.loads(path.read_text())
        if descriptor.get("id") != "calibration" or descriptor.get("client", {}).get("module") != "/web/calibration.mjs":
            raise ValueError("Select the maintained Calibration extension")
        if "calibration_design.mjs" not in descriptor.get("assets", []):
            descriptor.setdefault("assets", []).append("calibration_design.mjs")
            descriptor["version"] = str(descriptor.get("version", "")) + "+source-design1"
            candidates["operator/extensions/calibration.json"] = encoded(descriptor)
        else:
            candidates["operator/extensions/calibration.json"] = path.read_bytes()
        originals = {}
        for name, body in candidates.items():
            if name.endswith(".py"):
                ast.parse(body.decode(), filename=name)
            if name.endswith(".json"):
                json.loads(body)
            path = root / name
            path.resolve().relative_to(root)
            if path.is_symlink():
                raise ValueError("Use regular retained application files: " + name)
            old = path.read_bytes() if path.exists() else None
            originals[name] = old
            if name in ADDITIONS and old is not None and old != body:
                known = {x.get("files", {}).get(name, {}).get("sha256") for x in (current, pending)}
                known.update(spec.get("known_additions", {}).get(name, []))
                if sha(old) not in known:
                    raise ValueError("An independently edited design component needs a source merge: " + name)
        target = {name: {"sha256": sha(body), "bytes": len(body)} for name, body in candidates.items()}
        if current.get("files") == target and all(originals[name] == body for name, body in candidates.items()):
            return current
        for old in originals.values():
            if old is not None:
                path = state / "preimages" / sha(old)
                if path.exists() and path.read_bytes() != old:
                    raise ValueError("A retained source preimage differs")
                if not path.exists():
                    atomic(path, old)
        result = {"schema": "upstate.calibration-design-install/v1", "files": target,
                  "patch_sha256": sha((source / "operator/calibration_design_patch.json").read_bytes())}
        atomic(pending_path, encoded(result))
        for name, body in candidates.items():
            path = root / name
            if (path.read_bytes() if path.exists() else None) != originals[name]:
                raise ValueError("Calibration application changed during preflight: " + name)
            if originals[name] != body:
                atomic(path, body)
        atomic(current_path, encoded(result))
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source_root), sort_keys=True))


if __name__ == "__main__":
    main()
