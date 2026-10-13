#!/usr/bin/env python3
"""Attach saved scientific diagnostics to the maintained investigations desk.

Authored by TokenJunkieLabs. Preserves unrelated A66A/E258 and original host
changes through unique source anchors and JSON registry edits.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import tempfile


def sha(body):
    return hashlib.sha256(body).hexdigest()


def inside(root, name):
    path = root / name
    if not path.resolve().is_relative_to(root):
        raise ValueError("Application member leaves its selected root: " + name)
    return path


def patch_once(source, change, name):
    new = change["replacement"]
    completed = [new, *change.get("compatible_postimages", [])]
    if any(body in source for body in completed):
        return source
    originals = list(dict.fromkeys([change["old"], *change.get("compatible_preimages", [])]))
    matches = [old for old in originals if source.count(old) == 1]
    if len(matches) != 1:
        raise ValueError("Resolve the current unique source anchor in " + name)
    return source.replace(matches[0], new, 1)


def atomic(path, body, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, filename = tempfile.mkstemp(prefix=".diagnostic-install-", dir=path.parent)
    temporary = Path(filename)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
            os.fchmod(handle.fileno(), mode)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def install(application, source_root):
    application, source_root = application.resolve(), source_root.resolve()
    if not (application / "operator" / "server.py").is_file():
        raise ValueError("Select the maintained original operator application.")
    payload = json.loads((source_root / "operator" / "diagnostic_investigations_patch.json").read_text("utf-8"))
    if payload.get("schema") != "upstate.diagnostic-investigations-install/v1":
        raise ValueError("Select this component's complete source package.")
    for name in payload["required"]:
        if not inside(application, name).is_file():
            raise ValueError("Install the maintained native source dependency first: " + name)
    # The current owner supplies the complete native experiment controller.
    # This additive installer never replaces it with a preceding browser edition.
    for name, symbols in payload.get("required_source_symbols", {}).items():
        current = inside(application, name).read_text("utf-8")
        if any(symbol not in current for symbol in symbols):
            raise ValueError("Install the maintained diagnostic entry controller first: " + name)
    changes = {}

    def plan(name, body):
        target = inside(application, name)
        before = target.read_bytes() if target.is_file() else None
        if before == body:
            return
        if name.endswith(".py"):
            ast.parse(body.decode("utf-8"), filename=name)
        changes[name] = {
            "before": before, "after": body,
            "mode": target.stat().st_mode & 0o777 if before is not None else 0o644,
        }

    for name, replacements in payload["patches"].items():
        target = inside(application, name)
        if not target.is_file():
            raise ValueError("Install this existing native component first: " + name)
        text = target.read_text("utf-8")
        for replacement in replacements:
            text = patch_once(text, replacement, name)
        plan(name, text.encode("utf-8"))

    registry_name = payload["registry"]
    registry = json.loads(inside(application, registry_name).read_text("utf-8"))
    if registry.get("id") != "investigations":
        raise ValueError("The selected registry entry belongs to another component.")
    actions = registry["backend"]["actions"]
    if "intelligence.diagnostic.open" not in actions:
        actions.append("intelligence.diagnostic.open")
    required = registry["client"].setdefault("requires", [])
    for capability in ("navigate", "openExtension"):
        if capability not in required:
            required.append(capability)
    plan(registry_name, (json.dumps(registry, indent=2) + "\n").encode("utf-8"))

    for name, expected in payload["replacements"].items():
        body = inside(source_root, name).read_bytes()
        if sha(body) != expected["sha256"]:
            raise ValueError("Source bytes differ from the retained component: " + name)
        target = inside(application, name)
        if target.is_file():
            current = target.read_bytes()
            if current != body and sha(current) not in expected["allowed_preimages"]:
                raise ValueError("Reconcile the newer retained component before replacing " + name)
        plan(name, body)

    # Keep the installer and its exact patch data with the portable application.
    for name in ("operator/install_diagnostic_investigations.py",
                 "operator/diagnostic_investigations_patch.json"):
        plan(name, inside(source_root, name).read_bytes())

    if not changes:
        return {"schema": "upstate.diagnostic-investigations-installation/v1",
                "state": "current", "application": str(application), "changed": []}

    identities = {
        name: {"before": sha(row["before"]) if row["before"] is not None else None,
               "after": sha(row["after"])}
        for name, row in sorted(changes.items())
    }
    key = sha(json.dumps(identities, sort_keys=True).encode("utf-8"))
    history = application.parent / ".diagnostic-investigations-history" / key
    history.mkdir(parents=True, exist_ok=True)
    for name, row in changes.items():
        if row["before"] is not None:
            backup = history / "original" / name
            if backup.exists() and backup.read_bytes() != row["before"]:
                raise ValueError("An earlier source recovery member differs: " + name)
            if not backup.exists():
                atomic(backup, row["before"], row["mode"])
    atomic(history / "source-identities.json",
           (json.dumps(identities, indent=2) + "\n").encode("utf-8"))

    # Recheck all preimages after preparation, before the first application edit.
    for name, row in changes.items():
        target = inside(application, name)
        current = target.read_bytes() if target.is_file() else None
        if current != row["before"]:
            raise ValueError("The native source changed during installation: " + name)

    applied = []
    try:
        for name, row in changes.items():
            target = inside(application, name)
            current = target.read_bytes() if target.is_file() else None
            if current != row["before"]:
                raise ValueError("The native source changed during installation: " + name)
            atomic(target, row["after"], row["mode"])
            applied.append(name)
    except Exception:
        # Restore only our own exact writes; preserve a concurrent owner's edits.
        for name in reversed(applied):
            row = changes[name]
            target = inside(application, name)
            if target.is_file() and target.read_bytes() == row["after"]:
                if row["before"] is None:
                    target.unlink()
                else:
                    atomic(target, row["before"], row["mode"])
        raise

    return {
        "schema": "upstate.diagnostic-investigations-installation/v1",
        "state": "installed", "application": str(application),
        "source_history": str(history),
        "changed": [{"path": name, "bytes": len(row["after"]), "sha256": sha(row["after"])}
                    for name, row in sorted(changes.items())],
        "ui_join": "extensions.openExtension('investigations','openForDiagnostic',selection)",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parents[1])
    arguments = parser.parse_args()
    print(json.dumps(install(arguments.application, arguments.source_root), indent=2))


if __name__ == "__main__":
    main()
