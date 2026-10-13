#!/usr/bin/env python3
"""Join regional selections to the current native saved-view operator."""
from __future__ import annotations

import argparse
import ast
import fcntl
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid

MANIFEST = "operator/Regional_Saved_View_Integration.json"
INSTALLER = "operator/install_regional_saved_view.py"


def digest(value):
    return hashlib.sha256(value).hexdigest()


def member(root, name):
    if not isinstance(name, str) or not name or "\\" in name:
        raise ValueError("Choose a relative application member.")
    relative = Path(name)
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise ValueError("Unsupported application member: " + name)
    selected = root.joinpath(relative)
    selected.resolve().relative_to(root.resolve())
    return selected


def atomic(path, body, mode=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        if mode is not None:
            os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def prepare(application, source):
    specification = json.loads(member(source, MANIFEST).read_text(encoding="utf-8"))
    if specification.get("schema") != "upstate.regional-saved-view-integration/v1":
        raise ValueError("Choose the original regional journey integration declaration.")
    descriptor = json.loads(member(application, "operator/extensions/guided-journey.json").read_text(encoding="utf-8"))
    if descriptor.get("id") != "guided-journey" or descriptor.get("client", {}).get("factory") != "attachOperatingJourney":
        raise ValueError("Choose the current registered Guided journey application.")
    plans = {}
    hooks = {}
    for edit in specification["edits"]:
        name = edit["path"]
        if name not in plans:
            path = member(application, name)
            old = path.read_bytes()
            plans[name] = {"before": old, "after": old, "mode": path.stat().st_mode}
            hooks[name] = []
        current = plans[name]["after"].decode("utf-8")
        before, after = edit["before"], edit["after"]
        if current.count(after) == 1:
            state = "already_present"
        elif any(current.count(present) == 1 for present in edit.get("present", [])):
            matches = [present for present in edit["present"] if current.count(present) == 1]
            if len(matches) != 1:
                raise ValueError(name + ": multiple installed variants for " + edit["id"])
            state = "already_present_current"
        elif any(current.count(previous) == 1 for previous in edit.get("previous", [])):
            matches = [previous for previous in edit["previous"] if current.count(previous) == 1]
            if len(matches) != 1:
                raise ValueError(name + ": multiple retained preimages for " + edit["id"])
            current = current.replace(matches[0], after, 1)
            state = "updated_known_preimage"
        elif edit.get("marker") and edit["marker"] in current:
            raise ValueError(name + ": opening hook " + edit["id"] +
                             " has a newer or different body; reconcile that named hook before installation.")
        elif current.count(before) == 1:
            current = current.replace(before, after, 1)
            state = "composed"
        else:
            raise ValueError(name + ": opening hook " + edit["id"] +
                             " must match exactly once; current source was preserved.")
        plans[name]["after"] = current.encode("utf-8")
        hooks[name].append({"id": edit["id"], "state": state})
    for name, expected in specification["owned_files"].items():
        body = member(source, name).read_bytes()
        if len(body) != expected["bytes"] or digest(body) != expected["sha256"]:
            raise ValueError("Source member bytes changed: " + name)
        target = member(application, name)
        old = target.read_bytes() if target.exists() else None
        if old is not None and old != body and digest(old) not in expected.get("previous_sha256", []):
            raise ValueError("An existing regional member differs: " + name +
                             "; preserve and reconcile its current source before installation.")
        plans[name] = {"before": old, "after": body,
                       "mode": target.stat().st_mode if target.exists() else None}
    for name in (MANIFEST, INSTALLER):
        body = member(source, name).read_bytes()
        target = member(application, name)
        old = target.read_bytes() if target.exists() else None
        if old is not None and old != body and digest(old) not in specification.get("previous_integration_sha256", {}).get(name, []):
            raise ValueError("An existing integration source differs: " + name)
        plans[name] = {"before": old, "after": body,
                       "mode": target.stat().st_mode if target.exists() else None}
    # Update the maintained component inventory using the current exact bodies.
    # The shared extension-install lock covers this read, stage and commit.
    name = "operator/Guided_Journey_Source.json"
    target = member(application, name)
    old = target.read_bytes()
    metadata = json.loads(old)
    if metadata.get("schema") != "upstate.guided-journey-component/v1" or metadata.get("edition") != 2:
        raise ValueError("Install the current registered Guided journey component before this saved-view join.")
    records = metadata.get("files", {})
    for component, expected in records.items():
        current = plans[component]["before"] if component in plans else member(application, component).read_bytes()
        if expected != {"bytes": len(current), "sha256": digest(current)}:
            raise ValueError("Current Guided journey component inventory differs: " + component)
    for component in specification["component_members"]:
        if component not in records or component not in plans:
            raise ValueError("The saved-view join must preserve the maintained component inventory.")
        body = plans[component]["after"]
        records[component] = {"bytes": len(body), "sha256": digest(body)}
    metadata.setdefault("source_context", {})["regional_saved_view"] = "Regional selections, native project save and retained browser view composition"
    body = (json.dumps(metadata, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    plans[name] = {"before": old, "after": body, "mode": target.stat().st_mode}
    return plans, hooks


def validate(plans, node):
    checks = {"python": [], "javascript": [], "javascript_runtime": node}
    with tempfile.TemporaryDirectory(prefix="regional-journey-parse-") as directory:
        staging = Path(directory)
        for name, plan in plans.items():
            body = plan["after"]
            if name.endswith(".py"):
                ast.parse(body.decode("utf-8"), filename=name)
                checks["python"].append(name)
            elif name.endswith(".mjs") and node:
                path = member(staging, name)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(body)
                result = subprocess.run([node, "--check", str(path)], capture_output=True,
                                        text=True, timeout=60, check=False)
                if result.returncode:
                    raise ValueError("JavaScript parse failed for " + name + ":\n" +
                                     (result.stderr or result.stdout))
                checks["javascript"].append(name)
    return checks


def install(application, source, node=None):
    application = Path(application).resolve()
    if not (application / "operator/server.py").is_file():
        raise ValueError("Choose the existing application with its original operator/server.py.")
    lock = application / ".locks" / "extension-install.lock"
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("a+b") as owner:
        fcntl.flock(owner.fileno(), fcntl.LOCK_EX)
        try:
            return _install_locked(application, source, node)
        finally:
            fcntl.flock(owner.fileno(), fcntl.LOCK_UN)


def _install_locked(application, source, node=None):
    application = Path(application).resolve()
    source = Path(source).resolve()
    if not (application / "operator/server.py").is_file():
        raise ValueError("Choose the existing application with its original operator/server.py.")
    plans, hooks = prepare(application, source)
    checks = validate(plans, node)
    changed = {name: plan for name, plan in plans.items() if plan["before"] != plan["after"]}
    moment = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    receipt = {
        "schema": "upstate.regional-saved-view-installation/v1",
        "application": str(application), "created_at": moment,
        "files": {name: {"before_sha256": digest(plan["before"]) if plan["before"] is not None else None,
                         "after_sha256": digest(plan["after"]), "bytes": len(plan["after"]),
                         "changed": name in changed, "hooks": hooks.get(name, [])}
                  for name, plan in plans.items()},
        "syntax": checks,
    }
    if not changed:
        receipt["state"] = "already_installed"
        return receipt
    archive = application.parent / (application.name + "-regional-journey-installations") / (
        moment + "-" + uuid.uuid4().hex[:12])
    archive.mkdir(parents=True)
    for name, plan in changed.items():
        if plan["before"] is not None:
            atomic(member(archive / "before", name), plan["before"], plan["mode"])
    committed = []
    try:
        for name, plan in plans.items():
            path = member(application, name)
            actual = path.read_bytes() if path.exists() else None
            if actual != plan["before"]:
                raise ValueError("Application member changed while staging: " + name)
        for name, plan in changed.items():
            path = member(application, name)
            actual = path.read_bytes() if path.exists() else None
            if actual != plan["before"]:
                raise ValueError("Application member changed before replacement: " + name)
            atomic(path, plan["after"], plan["mode"])
            committed.append(name)
    except Exception as error:
        preserved = []
        for name in reversed(committed):
            path = member(application, name)
            plan = plans[name]
            if not path.exists() or path.read_bytes() != plan["after"]:
                preserved.append(name)
                continue
            if plan["before"] is None:
                path.unlink()
            else:
                atomic(path, plan["before"], plan["mode"])
        receipt.update(state="rolled_back", error=str(error),
                       concurrent_files_preserved=preserved)
        atomic(archive / "installation.json", (json.dumps(receipt, indent=2) + "\n").encode())
        raise RuntimeError(str(error) + "; installation record: " + str(archive / "installation.json")) from error
    receipt.update(state="installed", installation_record=str(archive / "installation.json"))
    atomic(archive / "installation.json", (json.dumps(receipt, indent=2) + "\n").encode())
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, help="Existing cumulative application root")
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parents[1]),
                        help="Root containing these exact additive source members")
    parser.add_argument("--node", default=shutil.which("node"),
                        help="Existing Node executable for parsing changed JavaScript")
    args = parser.parse_args(argv)
    result = install(args.application, args.source_root, args.node)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
