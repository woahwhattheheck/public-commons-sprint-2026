"""Install the additive model input-change desk into the current ECSA application."""
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

FILES = ("model/scenario_inputs.py", "model/scenario_response.py", "operator/scenario_inputs.py",
         "operator/web/scenario-inputs.mjs", "operator/web/scenario-inputs.css",
         "operator/extensions/scenario-inputs.json", "operator/SCENARIO_INPUTS.md")


KNOWN_RELEASED = {
    "model/scenario_inputs.py": [
        "8801a1e3fbee9812471f7f28960917b89805efb7b1c3514c9b04f6dc5ef44aa5"
    ],
    "operator/scenario_inputs.py": [
        "9d173e5be24f9a8c565fe57975b453a906e47057e4444bdfb79639040095cc34"
    ],
    "operator/web/scenario-inputs.mjs": [
        "e7a52c81cb99f3b60e6e9ccbae390a059d8daefb3e73eacd120777bd97cd7e77"
    ],
    "operator/web/scenario-inputs.css": [
        "29280a55666d822986c57bcd0ac9d635b28555298b9dbfdbecd9539a58378a84"
    ],
    "operator/extensions/scenario-inputs.json": [
        "538a226f09c5f952a7b2b73aef4a63814c680a06e0d9eb5b74ef24f5125b779e"
    ],
    "operator/SCENARIO_INPUTS.md": [
        "8596f5a3c5f3227871e7dd77c7234a1e415667746e20f35e3cd7643ee71fafc3"
    ]
}


def sha(body):
    return hashlib.sha256(body).hexdigest()


def write(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".input-install-", delete=False) as out:
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
    receipt_root = app / "operator" / "input-effects-install"
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
        return {"schema": "upstate.input-effects-install-plan/v1", "files": plan}
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
    intent = {"schema": "upstate.input-effects-install-intent/v1",
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
    result = {"schema": "upstate.input-effects-install/v1",
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
    lock_path = app / "operator" / ".input-effects-install.lock"
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
