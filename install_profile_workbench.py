#!/usr/bin/env python3
"""Compose the profile edition workbench into the retained Upper Savannah application."""
from __future__ import annotations

import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile

COMPONENT_FILES = (
    "model/profile_editions.py",
    "model/profile_customer_review.py",
    "source_tools/receive_profile_customer_review.py",
    "source_tools/PROFILE_CUSTOMER_REVIEW.md",
    "operator/profile_workbench.py",
    "operator/web/profile_workbench.mjs",
    "operator/web/profile_customer_review.mjs",
    "operator/web/profile_workbench.css",
    "operator/extensions/profile-workbench.json",
    "operator/PROFILE_WORKBENCH.md",
    "open_profile_desk.py",
    "install_profile_workbench.py",
    "source/run_profile_workbench_browser.mjs",
    "operator/PROFILE_WORKBENCH_RECEIVING.md",
)
PROFILE_BASE = "3436821e8dc6714d65d0f57f4f74799558ccaf69aaa40bd0a13fba0f9c2b63bb"
PROFILE_SELECTED_MODELS = "16381e8f01103232c8d5488cb14559fb77074db106e16fa792da0d7d4aaa6b55"


def sha(body):
    return hashlib.sha256(body).hexdigest()


def replace_once(source, before, after, label):
    if after in source:
        return source
    if source.count(before) != 1:
        raise ValueError("Compose the current " + label + " at its original source location.")
    return source.replace(before, after, 1)


def selected_model_join(source):
    # The maintained native catalogue now has its own selected_models helper.
    # Preserve that implementation and its model-specific catalogue filtering.
    current_native = (
        "    table = inspect_table(path, selected_models=selected_models(profile))\n",
        "        active = selected_models(profile)\n",
        "            baseline_parameters={model: profile[model] for model in active},\n",
        "    inspect_table(csv_path, selected_models=selected_models(base))\n",
    )
    if all(value in source for value in current_native):
        ast.parse(source)
        return source
    source = replace_once(source,
        "from .profiles import checked_parameters, inspect_table\n",
        "from .profiles import checked_parameters, inspect_table\nfrom .model_selection import selected\n",
        "source-profile model selection import")
    source = replace_once(source,
        "    table = inspect_table(path)\n",
        "    table = inspect_table(path, selected_models=selected(profile))\n",
        "original source-table inspection")
    source = replace_once(source,
        '            baseline_parameters={"ndr": profile["ndr"], "sdr": profile["sdr"]},\n',
        '            baseline_parameters={name: profile[name] for name in selected(profile)},\n',
        "native parameter catalogue")
    source = replace_once(source,
        "    inspect_table(csv_path)\n",
        "    inspect_table(csv_path, selected_models=selected(base))\n",
        "derived source-table inspection")
    ast.parse(source)
    return source


def retain_launchers(source):
    tree = ast.parse(source)
    assignments = [node for node in tree.body if isinstance(node, ast.Assign)
                   and any(isinstance(target, ast.Name) and target.id == "APPLICATION_FILES"
                           for target in node.targets)]
    if len(assignments) != 1:
        raise ValueError("Find the current original APPLICATION_FILES tuple for launcher transfer.")
    node = assignments[0].value
    values = ast.literal_eval(node)
    if not isinstance(values, tuple) or any(not isinstance(value, str) for value in values):
        raise ValueError("The original application file selection must remain a tuple of filenames.")
    additions = [value for value in ("open_profile_desk.py", "install_profile_workbench.py")
                 if value not in values]
    if not additions:
        return source
    rows = source.splitlines(keepends=True)
    start = sum(len(row) for row in rows[:node.lineno - 1]) + node.col_offset
    end = sum(len(row) for row in rows[:node.end_lineno - 1]) + node.end_col_offset
    replacement = "(\n" + "".join("    " + repr(value) + ",\n" for value in (*values, *additions)) + ")"
    source = source[:start] + replacement + source[end:]
    ast.parse(source)
    return source


def app_join(source):
    # Applied to the current core source, preserving every other extension join.
    source = replace_once(source,
        "for(const node of $('[data-native-models]',form))",
        "for(const node of $$('[data-native-models]',form))",
        "native model group iteration")
    source = replace_once(source,
        "for(const input of $('input,select,textarea,button',node))",
        "for(const input of $$('input,select,textarea,button',node))",
        "native model field iteration")
    current_caption = """parameter('sdr','l_max','Maximum RUSLE L-factor','Dimensionless.','min="0"')"""
    if current_caption not in source:
        source = replace_once(source,
            """parameter('sdr','l_max','Maximum slope length','Metres.','min="0"')""",
            """parameter('sdr','l_max','Maximum L factor','Dimensionless upper limit for the RUSLE L factor.','min="0"')""",
            "SDR maximum L factor caption")
    return source


def _install_locked(application, source_root, *, dry_run=False):
    application = Path(application).resolve(strict=True)
    source_root = Path(source_root).resolve(strict=True)
    for name in ("model/workspace.py", "model/experiment_profiles.py",
                 "operator/extension_registry.py", "operator/server.py",
                 "operator/web/extension_host.mjs", "operator/web/app.mjs", "model/portable.py"):
        if not (application / name).is_file():
            raise ValueError("Receive the current original application and its registry/source-profile dependencies: " + name)
    if "ExtensionRegistry" not in (application / "operator/server.py").read_text(encoding="utf-8"):
        raise ValueError("Apply the original install_extensions.py to the retained application first.")
    if "createExtensionHost" not in (application / "operator/web/app.mjs").read_text(encoding="utf-8"):
        raise ValueError("Complete the original browser extension-host installation first.")
    originals, pending = {}, {}
    for name in COMPONENT_FILES:
        incoming = (source_root / name).read_bytes()
        if name.endswith(".py"):
            ast.parse(incoming.decode("utf-8"), filename=name)
        if name.endswith(".json"):
            json.loads(incoming)
        target = application / name
        originals[name] = target.read_bytes() if target.exists() else None
        pending[name] = incoming
    profile_name = "model/experiment_profiles.py"
    profile_original = (application / profile_name).read_bytes()
    profile_source = selected_model_join(profile_original.decode("utf-8")).encode("utf-8")
    if sha(profile_original) == PROFILE_BASE and sha(profile_source) != PROFILE_SELECTED_MODELS:
        raise ValueError("The selected-model join differs from its retained original postimage.")
    originals[profile_name], pending[profile_name] = profile_original, profile_source
    for name, join in (("model/portable.py", retain_launchers),
                       ("operator/web/app.mjs", app_join)):
        body = (application / name).read_bytes()
        originals[name], pending[name] = body, join(body.decode("utf-8")).encode("utf-8")
    changed = [name for name in pending if originals[name] != pending[name]]
    result = {"schema": "upstate.profile-workbench-install/v1",
              "operation_id": "ECO-PROFILES-DD6B", "application": str(application),
              "changed": changed, "dry_run": dry_run,
              "files": {name: sha(body) for name, body in pending.items()}}
    if dry_run:
        return result
    lock_root = application / ".locks"
    lock_root.mkdir(exist_ok=True)
    with (lock_root / "profile-workbench-install.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with tempfile.TemporaryDirectory(prefix="profile-workbench-install-", dir=application.parent) as temp:
            stage = Path(temp)
            for name in changed:
                path = stage / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(pending[name])
            for name in changed:
                path = application / name
                current = path.read_bytes() if path.exists() else None
                if current != originals[name]:
                    raise RuntimeError("A concurrent application edit is retained at " + name)
            backup_root = application.parent / "profile-workbench-source-backups"
            for name in changed:
                path = application / name
                current = path.read_bytes() if path.exists() else None
                if current != originals[name]:
                    raise RuntimeError("A concurrent application edit is retained at " + name)
                if current is not None:
                    backup = backup_root / sha(current) / name
                    backup.parent.mkdir(parents=True, exist_ok=True)
                    if not backup.exists():
                        backup.write_bytes(current)
                path.parent.mkdir(parents=True, exist_ok=True)
                os.replace(stage / name, path)
    return result


def install(application, source_root, *, dry_run=False):
    application = Path(application).resolve(strict=True)
    if not application.is_dir():
        raise ValueError("Choose the current complete application directory")
    lock_root = application / ".locks"
    if lock_root.is_symlink():
        raise ValueError("Keep the native application lock directory")
    lock_root.mkdir(exist_ok=True)
    lock_path = lock_root / "extension-install.lock"
    if lock_path.is_symlink():
        raise ValueError("Keep the native application installer lock")
    with lock_path.open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _install_locked(application, source_root, dry_run=dry_run)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--source-root", default=Path(__file__).resolve().parent, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(install(args.application, args.source_root, dry_run=args.dry_run), indent=2))


if __name__ == "__main__":
    main()
