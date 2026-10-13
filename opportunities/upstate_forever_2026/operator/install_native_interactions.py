"""Install native conservation combinations into the current ECSA application."""
from __future__ import annotations
import argparse
import ast
import hashlib
import fcntl
import json
import os
from pathlib import Path
import tempfile
from datetime import datetime, timezone

FILES = ("model/native_interactions.py", "model/native_interactions_cli.py",
         "docs/native-interactions.md", "operator/native_interactions.py",
         "operator/web/native-interactions.mjs", "operator/web/native-interactions.css",
         "operator/extensions/native-interactions.json", "operator/NATIVE_INTERACTIONS.md",
         "operator/install_native_interactions.py")

KNOWN_RELEASED = {
    "model/native_interactions.py": [
        "d2d1f0dcb8a719b0e7271def9569043bc4b529a1c73b95e08aed42b58c8db9be"
    ],
    "model/native_interactions_cli.py": [
        "3991e05748aca8ba7354f86b12a210cd07432ebaa68d4772f76ab3e7653de220"
    ],
    "docs/native-interactions.md": [
        "0f0f815ed0f82d620178a4f096313be8714344e7983b6be2ca96253e1289051a"
    ],
    "operator/native_interactions.py": [
        "d663ba475f9c2878c064574bd5fd0ae0fef2712fbf5c61f59929387c8d527b42"
    ],
    "operator/web/native-interactions.mjs": [
        "99612e028059880ea7f49ac63c6780830e444fc1a56bb028115a3a67cf0de113"
    ],
    "operator/web/native-interactions.css": [
        "7fb93c2a4ebe8c08b8275d5dc07801952b1376e795ce5729147a1d68a194e7d1"
    ],
    "operator/extensions/native-interactions.json": [
        "545d44c336d3d794e131eb7203a3499969d23747e427cda54e81a978dab5f59f"
    ],
    "operator/install_native_interactions.py": [
        "cd0a5322b5d40bcb3f08cca77facb1fd2098d3b872c1d30564dcefb833a7b6f5"
    ],
    "operator/NATIVE_INTERACTIONS.md": [
        "7165c1fe51d9aff4ef7b9b8753402881214de00184bd5a8aa950160d1b36198f"
    ]
}


def sha(body):
    return hashlib.sha256(body).hexdigest()


def write(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".interaction-install-", delete=False) as out:
            pending = Path(out.name)
            out.write(body)
            out.flush()
            os.fsync(out.fileno())
        os.replace(pending, path)
        pending = None
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def data(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode() + b"\n"


def _install(application, source, *, dry_run=False):
    app, src = Path(application).resolve(strict=True), Path(source).resolve(strict=True)
    if not (app / "operator" / "extension_registry.py").is_file():
        raise ValueError("Install the current ECSA extension host in this application first")
    if not (app / "model" / "model_selection.py").is_file():
        raise ValueError("Receive the selected-model scientific core in this application first")
    targets, plan = {}, []
    receipt_root = app / "operator" / "native-interactions-install"
    receipt_path, pending_path = receipt_root / "current.json", receipt_root / "pending.json"
    previous, pending = data(receipt_path), data(pending_path)
    for name in FILES:
        source_path, target = src / name, app / name
        if source_path.is_symlink() or target.is_symlink():
            raise ValueError("Use regular installed component members: " + name)
        if not target.parent.resolve().is_relative_to(app):
            raise ValueError("Installed component parent leaves the selected application")
        body = source_path.read_bytes()
        if name.endswith(".py"):
            ast.parse(body.decode("utf-8"), filename=name)
        if name.endswith(".json"):
            json.loads(body)
        before = target.read_bytes() if target.exists() else None
        desired = sha(body)
        actual = sha(before) if before is not None else None
        allowed = {desired, *KNOWN_RELEASED.get(name, [])}
        if previous and name in previous["files"]:
            allowed.add(previous["files"][name]["sha256"])
        if pending and name in pending.get("files", {}):
            allowed.update({pending["files"][name]["before_sha256"],
                            pending["files"][name]["sha256"]})
        if actual is not None and actual not in allowed:
            raise ValueError("Compose the current authored component before replacing " + name)
        targets[name] = (target, body, before)
        plan.append({"path": name, "sha256": desired, "bytes": len(body),
                     "before_sha256": actual, "changed": before != body})
    changed = [row for row in plan if row["changed"]]
    if dry_run:
        return {"schema": "upstate.native-interactions-install-plan/v1", "files": plan}
    desired_files = {row["path"]: {"sha256": row["sha256"], "bytes": row["bytes"]} for row in plan}
    if not changed and previous and previous["files"] == desired_files:
        return previous
    receipt_root.mkdir(parents=True, exist_ok=True)
    # Keep every actual preimage before the intent and first feature replacement.
    for row in changed:
        before = targets[row["path"]][2]
        if before is not None:
            path = receipt_root / "preimages" / row["before_sha256"]
            if path.exists() and path.read_bytes() != before:
                raise ValueError("The retained source preimage differs")
            if not path.exists():
                write(path, before)
    intent = {"schema": "upstate.native-interactions-install-intent/v1",
              "files": {row["path"]: row for row in plan}}
    if pending:
        old_intent = canonical(pending)
        archive = receipt_root / "intents" / (sha(old_intent) + ".json")
        if not archive.exists():
            write(archive, old_intent)
    write(pending_path, canonical(intent))
    for row in changed:
        path, body, before = targets[row["path"]]
        actual = path.read_bytes() if path.exists() else None
        if actual != before:
            raise ValueError("Installed source changed during composition: " + row["path"])
        write(path, body)
    for name, item in desired_files.items():
        path = app / name
        if path.stat().st_size != item["bytes"] or sha(path.read_bytes()) != item["sha256"]:
            raise ValueError("Installed component member differs: " + name)
    result = {"schema": "upstate.native-interactions-install/v1",
              "installed_at": datetime.now(timezone.utc).isoformat(),
              "files": desired_files}
    if previous:
        old_receipt = canonical(previous)
        archive = receipt_root / "receipts" / (sha(old_receipt) + ".json")
        if not archive.exists():
            write(archive, old_receipt)
    write(receipt_path, canonical(result))
    pending_path.unlink(missing_ok=True)
    return result


def install(application, source, *, dry_run=False):
    app = Path(application).resolve(strict=True)
    lock_path = app / "operator" / ".native-interactions-install.lock"
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        return _install(app, source, dry_run=dry_run)
    finally:
        os.close(fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(install(args.application, args.source, dry_run=args.dry_run),
                     ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
