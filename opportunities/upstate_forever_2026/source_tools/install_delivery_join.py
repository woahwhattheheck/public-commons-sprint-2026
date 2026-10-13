#!/usr/bin/env python3
"""Install a complete delivery source join while preserving unrelated current code."""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile
from datetime import datetime, timezone


def digest(body):
    return hashlib.sha256(body).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Source path must be a canonical relative path")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or str(path) != value
            or any(part in (".", "..") for part in path.parts)):
        raise ValueError("Source path leaves the selected application: " + str(value))
    return path


def selected_path(root, name):
    path = root
    for part in relative(name).parts:
        path = path / part
        if path.is_symlink():
            raise ValueError("Source joins do not replace file aliases: " + name)
    return path


def current_bytes(path):
    if not path.exists():
        return None
    if not stat.S_ISREG(path.stat().st_mode):
        raise ValueError("Selected source is not a regular file: " + str(path))
    return path.read_bytes()


def compose(current, entry, changes):
    wanted = base64.b64decode(entry["content_base64"], validate=True)
    if len(wanted) != entry["bytes"] or digest(wanted) != entry["sha256"]:
        raise ValueError("Source bank content differs from its declared identity: " + entry["path"])
    if current == wanted:
        return wanted, "already-present"
    if current is None:
        if entry.get("base_sha256") is not None:
            raise ValueError("Required current source is absent: " + entry["path"])
        return wanted, "add"
    if entry.get("base_sha256") is None:
        raise ValueError("An independently created file occupies: " + entry["path"])
    current_sha256 = digest(current)
    if current_sha256 == entry["base_sha256"]:
        return wanted, "replace-original"
    reviewed = {item["sha256"] for item in entry.get("accepted_predecessors", [])}
    if current_sha256 in reviewed:
        return wanted, "advance-reviewed-source"
    if not changes:
        raise ValueError("Current source needs an explicit join: " + entry["path"])
    text = current.decode("utf-8")
    for change in changes:
        before, after = change["old"], change["new"]
        if after and text.count(after) == 1:
            continue
        candidates = change.get("alternatives", []) + [{"old": before, "new": after}]
        selected = next((item for item in candidates
                         if item["old"] and text.count(item["old"]) == 1), None)
        if selected is None:
            raise ValueError("Current source overlaps " + change["label"] + ": " + entry["path"])
        text = text.replace(selected["old"], selected["new"], 1)
    return text.encode("utf-8"), "join-current"


def install(root, bundle, *, preview=False):
    root = Path(root).resolve(strict=True)
    if not (root / "model" / "workspace.py").is_file():
        raise ValueError("Select the existing Upper Savannah application root")
    packet = json.loads(Path(bundle).read_text(encoding="utf-8"))
    expected = packet.get("bundle_sha256")
    payload = {key: value for key, value in packet.items() if key != "bundle_sha256"}
    if not isinstance(expected, str) or digest(canonical(payload)) != expected:
        raise ValueError("Source bank identity differs from its declared complete content")
    if packet.get("schema") != "commons.source-bank/v1":
        raise ValueError("Select the complete delivery source bank")
    entries = packet.get("files")
    changes = packet.get("source_edits", [])
    if not isinstance(entries, list) or not isinstance(changes, list) or not entries:
        raise ValueError("Source bank must contain complete source files and guarded joins")
    paths = [entry["path"] for entry in entries]
    if len(set(paths)) != len(paths) or any(change["path"] not in paths for change in changes):
        raise ValueError("Source bank contains duplicate or unowned source paths")
    prepared = []
    for entry in entries:
        path = selected_path(root, entry["path"])
        original = current_bytes(path)
        body, action = compose(original, entry, [c for c in changes if c["path"] == entry["path"]])
        if path.suffix == ".py":
            compile(body.decode("utf-8"), str(path), "exec")
        prepared.append((entry, path, original, body, action))
    result = {"schema": "upstate.delivery-source-join/v1",
              "operation_id": packet["operation_id"], "bundle_sha256": expected,
              "application": str(root), "preview": preview,
              "files": [{"path": entry["path"], "action": action,
                         "before_sha256": digest(original) if original is not None else None,
                         "sha256": digest(body), "bytes": len(body)}
                        for entry, path, original, body, action in prepared]}
    if preview or all(original == body for entry, path, original, body, action in prepared):
        result["published"] = []
        return result
    # Preflight every current source again before publishing any file.
    for entry, path, original, body, action in prepared:
        selected_path(root, entry["path"])
        if current_bytes(path) != original:
            raise ValueError("Source changed during preflight: " + entry["path"])
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    history = root / ".source-history" / ("delivery-" + stamp + "-" + expected[:12])
    history.mkdir(parents=True, exist_ok=False)
    result["history"] = str(history)
    for entry, path, original, body, action in prepared:
        if original is not None and original != body:
            previous = history.joinpath(*relative(entry["path"]).parts)
            previous.parent.mkdir(parents=True, exist_ok=True)
            with previous.open("xb") as stream:
                stream.write(original)
                stream.flush()
                os.fsync(stream.fileno())
    result["published"] = []
    receipt = history / "installation.json"
    receipt.write_bytes(canonical(result) + b"\n")
    for entry, path, original, body, action in prepared:
        if original == body:
            continue
        selected_path(root, entry["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix=".delivery-source-", dir=path.parent)
        temporary = Path(temporary)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(body)
                stream.flush()
                os.fsync(stream.fileno())
            selected_path(root, entry["path"])
            if current_bytes(path) != original:
                raise ValueError("Source changed before publication: " + entry["path"])
            mode = stat.S_IMODE(path.stat().st_mode) if original is not None else 0o644
            os.chmod(temporary, mode)
            if original is None:
                os.link(temporary, path)
                temporary.unlink()
            else:
                os.replace(temporary, path)
            folder = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(folder)
            finally:
                os.close(folder)
            result["published"].append(entry["path"])
            receipt.write_bytes(canonical(result) + b"\n")
        finally:
            temporary.unlink(missing_ok=True)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args(argv)
    try:
        result = install(args.root, args.bundle, preview=args.preview)
    except (OSError, ValueError, KeyError, TypeError, SyntaxError) as error:
        parser.exit(1, json.dumps({"state": "source-join-error", "type": type(error).__name__,
                                  "message": str(error)}, ensure_ascii=False) + "\n")
    print(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
