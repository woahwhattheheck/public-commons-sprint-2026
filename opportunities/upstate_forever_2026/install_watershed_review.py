#!/usr/bin/env python3
"""Adopt the completed watershed review source into an existing application.

This installs only the original review family, composes its existing component,
and retains the installed formatter except for compatible original layout joins.
No Workspace, scientific result, native worker or operator process is changed.
"""
from __future__ import annotations
import argparse
import ast
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tempfile

EXPECTED_BANK_SHA256 = "321f429a47d8d89e9c820fd9472b391782d62ff292566583a12667635e434c17"
PREFIX = "source_tools/watershed_review/"
REPORT = "model/implementation_reporting.py"
COMPONENT = "integration/component_fragments/fieldwork-scientific-receiving.json"
SOURCE_NAMES = {
    "NATIVE_HANDOFF.md", "OWNER_INSTRUCTIONS.md", "apply_native_report_layout.py",
    "build.py", "compute.mjs", "desk.html", "receive_review.py", "review_core.mjs",
}
EXPECTED_PATHS = {PREFIX + name for name in SOURCE_NAMES} | {REPORT, COMPONENT}


def checksum(value):
    return hashlib.sha256(value).hexdigest()


def target_path(root, relative):
    member = PurePosixPath(relative)
    if member.is_absolute() or ".." in member.parts or member.as_posix() != relative:
        raise ValueError("Invalid review source path")
    target = root.joinpath(*member.parts)
    for item in (target, *target.parents):
        if item == root:
            break
        if item.is_symlink():
            raise ValueError("Review source path contains a symbolic link: " + relative)
    if not target.parent.resolve().is_relative_to(root):
        raise ValueError("Review source path escapes application")
    return target


def replace_bytes(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".review-source-", delete=False) as out:
            pending = Path(out.name)
            out.write(body)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(pending, path.stat().st_mode & 0o777 if path.exists() else 0o644)
        os.replace(pending, path)
        pending = None
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def install(application, bank_path):
    root = Path(application).resolve(strict=True)
    raw = Path(bank_path).read_bytes()
    if checksum(raw) != EXPECTED_BANK_SHA256:
        raise ValueError("Select the exact complete watershed review source bank")
    bank = json.loads(raw)
    if bank.get("schema") != "upstate.selected-model-source/v1":
        raise ValueError("Unsupported review source bank")
    rows = bank["files"]
    if len(rows) != len(EXPECTED_PATHS) or {row["path"] for row in rows} != EXPECTED_PATHS:
        raise ValueError("Complete original review source closure differs")
    bodies = {}
    for row in rows:
        body = base64.b64decode(row["content_base64"], validate=True)
        if len(body) != row["bytes"] or checksum(body) != row["sha256"]:
            raise ValueError("Carried source identity differs: " + row["path"])
        if row["path"].endswith(".py"):
            ast.parse(body.decode("utf-8"), filename=row["path"])
        bodies[row["path"]] = body
    for required in ("model/workspace.py", "model/implementation.py", REPORT):
        if not target_path(root, required).is_file():
            raise ValueError("Use the existing complete Implementation application: " + required)
    lock = target_path(root, ".watershed-review-install.lock")
    with lock.open("a+b") as held:
        fcntl.flock(held.fileno(), fcntl.LOCK_EX)
        changes = []
        for row in rows:
            relative = row["path"]
            if relative in (REPORT, COMPONENT):
                continue
            path = target_path(root, relative)
            old = path.read_bytes() if path.exists() else None
            new = bodies[relative]
            if old not in (None, new) and checksum(old) not in row["accepted_predecessor_sha256"]:
                raise ValueError("Preserve newer or edited review source: " + relative)
            changes.append((relative, path, old, new))

        # Execute only the fully checked source of this small original layout
        # helper; it imports no application modules and starts no operator.
        layout = {"__name__": "_watershed_review_layout"}
        exec(compile(bodies[PREFIX + "apply_native_report_layout.py"],
                     PREFIX + "apply_native_report_layout.py", "exec"), layout)
        path = target_path(root, REPORT)
        old = path.read_bytes()
        new = layout["compose"](old.decode("utf-8")).encode("utf-8")
        changes.append((REPORT, path, old, new))

        carried = json.loads(bodies[COMPONENT])
        reference = carried["source_reference"]["watershed_review_native"]
        path = target_path(root, COMPONENT)
        old = path.read_bytes() if path.exists() else None
        component = json.loads(old) if old is not None else {
            "schema": "upstate.application-component-fragment/v1",
            "id": "fieldwork-scientific-receiving",
            "extend_components": {}, "source_reference": {},
        }
        if (component.get("schema") != carried["schema"]
                or component.get("id") != carried["id"]):
            raise ValueError("Preserve the current application component contract")
        implementation = component.setdefault("extend_components", {}).setdefault("implementation", {})
        paths = implementation.setdefault("paths", [])
        if not isinstance(paths, list) or any(not isinstance(value, str) for value in paths):
            raise ValueError("Invalid maintained Implementation component paths")
        for relative in sorted(PREFIX + name for name in SOURCE_NAMES):
            if relative not in paths:
                paths.append(relative)
        sources = component.setdefault("source_reference", {})
        if sources.get("watershed_review_native", reference) != reference:
            raise ValueError("Preserve a newer review source registration")
        sources["watershed_review_native"] = reference
        new = (json.dumps(component, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        if old is not None and json.loads(old) == component:
            new = old
        changes.append((COMPONENT, path, old, new))

        published = []
        try:
            for relative, path, old, new in changes:
                current = path.read_bytes() if path.exists() else None
                if current != old:
                    raise ValueError("Application source changed during adoption: " + relative)
                if new != old:
                    replace_bytes(path, new)
                    published.append((path, old, new))
            for relative, path, old, new in changes:
                if path.read_bytes() != new:
                    raise ValueError("Adopted review source differs: " + relative)
        except BaseException:
            for path, old, new in reversed(published):
                if path.exists() and path.read_bytes() == new:
                    if old is None:
                        path.unlink()
                    else:
                        replace_bytes(path, old)
            raise
    return {"schema": "upstate.watershed-review-source-adoption/v1",
            "application": str(root), "bank_sha256": EXPECTED_BANK_SHA256,
            "files": [{"path": relative, "changed": old != new,
                       "before_sha256": checksum(old) if old is not None else None,
                       "sha256": checksum(new)} for relative, path, old, new in changes]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--bank", type=Path,
                        default=Path(__file__).resolve().parent / "integration/watershed-review-source-20261013.json")
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.bank), indent=2))
