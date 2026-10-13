#!/usr/bin/env python3
"""Install the Keowee, watershed and scientific-setup receiving workflows.

Run the installer from a current source checkout against an existing application:
  python -B source_tools/install_keowee_watershed_join.py \
    --application APPLICATION --source-root SOURCE_CHECKOUT
"""
from __future__ import annotations

import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import shutil
import shlex
import subprocess
import sys
import tempfile

SCHEMA = "upstate.keowee-watershed-install/v1"
SOURCE_SCHEMA = "upstate.keowee-watershed-source/v1"
MANIFEST = "source_tools/keowee_watershed_join.source.json"
ENTRYPOINTS = ("model/keowee_priority.py", "operator/receive_watershed_context.py",
               "operator/web/conservation.mjs")
REGISTRATIONS = ("operator/extensions/keowee-method-view.json",
                 "operator/extensions/scientific-setup.json")
PACKAGE_FILES = (
    "model/keowee_profile_adapter.py", "model/keowee_priority.py",
    "source/keowee-native-binding-20261013.json",
    "source_tools/keowee_profile_receiving.py", "model/KEOWEE_PROFILE_INTEGRATION.md",
    "source/keowee-native-integration-20261013.json",
    "source/keowee-native-receiving-20261013/sources.json",
    "source/keowee-native-receiving-20261013/source-selection-journey.json",
    "source/keowee-native-receiving-20261013/greenwood-native-feature.json",
    "source/keowee-native-receiving-20261013/capture.json",
    "source_tools/receive_watershed_edition.py", "source_tools/RECEIVE_WATERSHED_EDITION.md",
    "operator/receive_watershed_context.py",
    "source_tools/install_keowee_watershed_join.py",
    "source_tools/INSTALL_KEOWEE_WATERSHED_JOIN.md",
    "operator/web/keowee-method-view.mjs", "operator/web/conservation.mjs",
    "operator/KEOWEE_METHOD_VIEW.md", "source/keowee-method-view-integration-20261013.json",
    "operator/extensions/keowee-method-view.json",
    "model/setup_review.py", "operator/scientific_setup.py",
    "source_tools/receive_scientific_setup.py", "model/SCIENTIFIC_SETUP.md",
    "source/scientific-setup-selection.schema.json",
    "source/scientific-setup-integration-20261013.json",
    "operator/web/scientific-setup.mjs", "operator/web/scientific-setup.css",
    "operator/extensions/scientific-setup.json", "operator/SCIENTIFIC_SETUP_DESK.md",
    "source_tools/keowee_interval_receiving.mjs",
    "source/keowee-native-receiving-20261013/source-interval-journey.json",
    "source_tools/gura_setup_review.py", "source_tools/GURA_SETUP_REVIEW.md",
    "source/gura-scientific-setup-request.json", "source/gura-setup-integration-20261013.json",
    "source_tools/receive_first_gura_case.py", "source_tools/FIRST_GURA_RECEIVING.md",
)
PROFILE_NAMES = (
    "lake-keowee-methodology.json", "keowee-evaluator.mjs", "keowee-evaluator.d.mts",
    "keowee-fields.csv", "keowee-criteria.csv", "keowee-source-catalog.json",
    "keowee-journey-check.json", "KEOWEE-INTEGRATION.md", "keowee-sources-manifest.json",
)
PROFILE_ROOT = "source/keowee/20261013/"
HOST_FILES = (
    "model/common.py", "model/workspace.py", "model/portable.py",
    "model/conservation.py", "model/conservation_optimization.py",
    "model/conservation_scenarios.py", "model/watershed_context.py",
    "operator/watershed_context.py", "source/keowee-priority-methods-20261013.json",
    "operator/server.py", "operator/extension_registry.py", "operator/web/app.mjs",
    "model/reviews.py", "model/model_selection.py", "model/scenario_footprint.py",
    "operator/customer_reviews.py", "source_tools/gura_comparison.py",
    "source_tools/gura_workflow.py", "source_tools/receive_gura.py",
)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def regular(root, relative, *, missing=False):
    if (not isinstance(relative, str) or not relative or "\\" in relative or "\0" in relative
            or Path(relative).is_absolute() or any(p in ("", ".", "..") for p in relative.split("/"))):
        raise ValueError("Expected a portable relative application path: " + str(relative))
    current = root
    parts = relative.split("/")
    for index, part in enumerate(parts):
        current = current / part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            if missing:
                return root / relative
            raise ValueError("Required application source is missing: " + relative) from None
        if stat.S_ISLNK(mode):
            raise ValueError("Application source contains a symbolic link: " + relative)
        wanted = stat.S_ISREG if index == len(parts) - 1 else stat.S_ISDIR
        if not wanted(mode):
            raise ValueError("Application source has an incompatible type: " + relative)
    return current


def read_optional(root, relative):
    path = regular(root, relative, missing=True)
    return path.read_bytes() if path.exists() else None


def validate_body(name, body):
    if name.endswith(".py"):
        compile(body, name, "exec", dont_inherit=True)
    elif name.endswith(".json"):
        json.loads(body)


def checked_body(root, row):
    body = regular(root, row["path"]).read_bytes()
    if len(body) != row["bytes"] or sha(body) != row["sha256"]:
        raise ValueError("Checkout source differs from the complete integration manifest: " + row["path"])
    validate_body(row["path"], body)
    return body


def _functions(body, *, class_name=None):
    tree = ast.parse(body)
    nodes = tree.body
    if class_name is not None:
        found = [node for node in nodes if isinstance(node, ast.ClassDef) and node.name == class_name]
        if len(found) != 1:
            raise ValueError("Expected native class " + class_name)
        nodes = found[0].body
    return {node.name for node in nodes if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}


def validate_host(application):
    bodies = {name: regular(application, name).read_bytes() for name in HOST_FILES}
    for name, body in bodies.items():
        validate_body(name, body)
    required = (
        ("model/workspace.py", "Workspace", {"import_sources", "source_file", "get_grid", "save_scenario", "_get", "_save", "_list"}),
        ("model/conservation.py", None, {"prepare", "build", "inspect", "save_plan", "get_plan"}),
        ("model/portable.py", None, {"backup", "restore", "inspect_archive"}),
        ("model/reviews.py", None, {"create_review", "show_review", "history", "export_review",
                                    "describe_export", "response_template", "validate_workspace"}),
        ("model/model_selection.py", None, {"grid_models", "selected", "required_roles"}),
        ("model/scenario_footprint.py", None, {"validate_destination_codes"}),
        ("source_tools/gura_comparison.py", None, {"catalog", "make_plan", "_check_plan"}),
        ("operator/watershed_context.py", "WatershedContextActions", {"read", "invoke", "_export"}),
    )
    for name, class_name, needed in required:
        absent = needed - _functions(bodies[name], class_name=class_name)
        if absent:
            raise ValueError("The current native application API is missing " + name + ": " + ", ".join(sorted(absent)))
    methods = json.loads(bodies["source/keowee-priority-methods-20261013.json"])
    if methods.get("schema") != "upstate.keowee-priority-methods/v1":
        raise ValueError("The original native Keowee method definition is required")
    if b"keowee_priority" not in bodies["model/conservation.py"]:
        raise ValueError("Receive the maintained native Conservation published-method join before installing this profile")
    server = bodies["operator/server.py"].decode("utf-8")
    browser = bodies["operator/web/app.mjs"].decode("utf-8")
    if ("ExtensionRegistry" not in server or "web_assets" not in server
            or "createExtensionHost" not in browser):
        raise ValueError("Install the maintained shared operator extension host before receiving the method view")
    customer_reviews = bodies["operator/customer_reviews.py"].decode("utf-8")
    for action in ("customer.review.create", "customer.review.export"):
        if action not in customer_reviews:
            raise ValueError("The original customer-review action is required: " + action)
    return {name: sha(body) for name, body in bodies.items()}


def _edits(recipe):
    edits = recipe.get("edits")
    if not isinstance(edits, list) or not edits:
        raise ValueError("A complete exact edit ledger is required")
    for edit in edits:
        if (not isinstance(edit.get("before"), str) or not edit["before"]
                or not isinstance(edit.get("after"), str) or not edit["after"]
                or edit["before"] == edit["after"]):
            raise ValueError("An integration edit has an invalid original or replacement")
    return edits


def compose(current, recipe):
    """Undo recognized own joins in reverse, then replay unique exact originals.

    Reverse order preserves nested joins: the receiver's atomic file-publication
    change is inside its earlier legacy-record receiving block.
    """
    text = current.decode("utf-8")
    edits = _edits(recipe)
    recognized = []
    for index in range(len(edits) - 1, -1, -1):
        edit = edits[index]
        count = text.count(edit["after"])
        if count > 1:
            raise ValueError("Repeated installed integration block: " + recipe["path"] + " / " + edit["id"])
        if count == 1:
            text = text.replace(edit["after"], edit["before"], 1)
            recognized.append(edit["id"])
    for edit in edits:
        count = text.count(edit["before"])
        if count != 1:
            raise ValueError("Cannot uniquely compose the current owner source: " + recipe["path"]
                             + " / " + edit["id"] + " (original matches " + str(count) + ")")
        text = text.replace(edit["before"], edit["after"], 1)
    result = text.encode("utf-8")
    validate_body(recipe["path"], result)
    return result, sorted(recognized)


def validate_recipe(recipe, postimage):
    if sha(postimage) != recipe["result_sha256"]:
        raise ValueError("The integration postimage differs from its recorded ledger: " + recipe["path"])
    text = postimage.decode("utf-8")
    for edit in reversed(_edits(recipe)):
        if text.count(edit["after"]) != 1:
            raise ValueError("The complete source does not reverse its exact edit ledger: " + edit["id"])
        text = text.replace(edit["after"], edit["before"], 1)
    original = text.encode("utf-8")
    if len(original) != recipe["base_bytes"] or sha(original) != recipe["base_sha256"]:
        raise ValueError("The edit ledger does not retain its exact original owner source: " + recipe["path"])
    rebuilt, _ = compose(original, recipe)
    if rebuilt != postimage:
        raise ValueError("The exact native-source edits do not reconstruct the complete postimage")
    return original


def package(source_root):
    raw = regular(source_root, MANIFEST).read_bytes()
    manifest = json.loads(raw)
    if manifest.get("schema") != SOURCE_SCHEMA:
        raise ValueError("Expected the complete Keowee and watershed source manifest")
    rows = manifest.get("files", [])
    if (len(rows) != len(PACKAGE_FILES)
            or {row.get("path") for row in rows} != set(PACKAGE_FILES)):
        raise ValueError("The complete integration package must contain its exact declared files")
    rows = {row["path"]: row for row in rows}
    sources = {name: checked_body(source_root, rows[name]) for name in PACKAGE_FILES}
    profiles = manifest.get("required_profile", {}).get("files", [])
    if (len(profiles) != len(PROFILE_NAMES)
            or {row.get("path") for row in profiles} != {PROFILE_ROOT + name for name in PROFILE_NAMES}):
        raise ValueError("The complete nine-member Keowee methodology and evaluator edition is required")
    profile_rows = {row["path"]: row for row in profiles}
    profile_bodies = {name: checked_body(source_root, row) for name, row in profile_rows.items()}
    profile_manifest = json.loads(profile_bodies[PROFILE_ROOT + "keowee-sources-manifest.json"])
    entries = profile_manifest.get("entries", [])
    if len(entries) != 1 or entries[0].get("path") != "lake-keowee-methodology.json":
        raise ValueError("Expected the original Keowee methodology source entry")
    entry = entries[0]
    declared = [entry] + entry.get("companions", [])
    expected_names = set(PROFILE_NAMES) - {"keowee-sources-manifest.json"}
    if len(declared) != len(expected_names) or {row.get("path") for row in declared} != expected_names:
        raise ValueError("The Keowee import manifest must retain every exact evaluator companion")
    for member in declared:
        body = profile_bodies[PROFILE_ROOT + member["path"]]
        if sha(body) != member.get("sha256") or member.get("bytes", len(body)) != len(body):
            raise ValueError("The Keowee import companion differs from this source edition: " + member["path"])
    binding = json.loads(sources["source/keowee-native-binding-20261013.json"])
    for key in ("profile", "evaluator"):
        member = binding.get(key, {})
        body = profile_bodies.get(member.get("path"))
        if body is None or sha(body) != member.get("sha256") or member.get("bytes", len(body)) != len(body):
            raise ValueError("The native Keowee binding differs from the retained " + key)
    recipes = manifest.get("joins", [])
    if len(recipes) != len(ENTRYPOINTS) or {row.get("path") for row in recipes} != set(ENTRYPOINTS):
        raise ValueError("Expected the three maintained source join ledgers")
    recipes = {row["path"]: row for row in recipes}
    for name in ENTRYPOINTS:
        validate_recipe(recipes[name], sources[name])
    descriptor = json.loads(sources["operator/extensions/keowee-method-view.json"])
    if (descriptor.get("schema") != "upstate.operator-extension/v1"
            or descriptor.get("id") != "keowee-method-view"
            or descriptor.get("assets") != ["keowee-method-view.mjs"]):
        raise ValueError("Expected the maintained method-view asset registration")
    setup_descriptor = json.loads(sources["operator/extensions/scientific-setup.json"])
    if (setup_descriptor.get("schema") != "upstate.operator-extension/v1"
            or setup_descriptor.get("id") != "scientific-setup"
            or setup_descriptor.get("assets") != ["scientific-setup.mjs", "scientific-setup.css"]
            or setup_descriptor.get("backend", {}).get("module") != "scientific_setup"
            or setup_descriptor.get("backend", {}).get("actions") != ["scientific.setup.create"]
            or setup_descriptor.get("requires_actions") != ["customer.review.create", "customer.review.export"]
            or setup_descriptor.get("client", {}).get("module") != "/web/scientific-setup.mjs"
            or setup_descriptor.get("client", {}).get("styles") != ["/web/scientific-setup.css"]):
        raise ValueError("Expected the original scientific setup action and view registration")
    sources[MANIFEST] = raw
    return manifest, rows, profiles, recipes, sources


def _flush_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _write_stage(path, body, mode):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as handle:
        handle.write(body)
        handle.flush()
        os.fchmod(handle.fileno(), mode)
        os.fsync(handle.fileno())


def _check_staged_javascript(staging, names):
    selected = [name for name in names if name.endswith(".mjs")]
    node = shutil.which("node")
    if not node or not selected:
        return {"method": "verified source hashes and exact joins", "node_check": False}
    for name in selected:
        result = subprocess.run([node, "--check", str(staging / name)],
                                capture_output=True, text=True, timeout=30, check=False)
        if result.returncode:
            raise ValueError("Staged browser source did not parse: " + name + "\n" + result.stderr.strip())
    return {"method": "node --check", "node_check": True, "files": selected}


def _same_current(application, name, before):
    actual = read_optional(application, name)
    if actual != before:
        raise RuntimeError("Concurrent source changed during installation: " + name
                           + ". Rerun to compose the current owner source.")


def install(application, source_root, *, dry_run=False):
    application = Path(application).expanduser().resolve(strict=True)
    source_root = Path(source_root).expanduser().resolve(strict=True)
    if not application.is_dir() or not source_root.is_dir():
        raise ValueError("Application and source checkout must be directories")
    manifest, rows, profiles, recipes, sources = package(source_root)
    validate_host(application)
    lock_root = application / ".locks"
    if lock_root.exists() and (lock_root.is_symlink() or not lock_root.is_dir()):
        raise ValueError("Application lock directory must be a real directory")
    lock_root.mkdir(exist_ok=True)
    lock_path = lock_root / "extension-install.lock"
    if lock_path.is_symlink():
        raise ValueError("The shared application installation lock cannot be a symbolic link")
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(lock_path, flags, 0o600), "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        host = validate_host(application)
        pending, original, policies, recognized = {}, {}, {}, {}
        # Methodology bytes stay immutable. Executable companions can advance
        # only from an explicitly retained, byte-identified owner predecessor.
        for row in profiles:
            name = row["path"]
            before = read_optional(application, name)
            original[name] = before
            wanted = checked_body(source_root, row)
            if before == wanted:
                pending[name] = wanted
                policies[name] = "retained source edition"
            elif before is None:
                pending[name] = wanted
                policies[name] = "copy source edition"
            elif sha(before) in row.get("previous_sha256", []):
                pending[name] = wanted
                policies[name] = "upgrade recorded executable companion"
            else:
                raise ValueError("The installed Keowee source member has an unrecognized edition: " + name)

        for name in PACKAGE_FILES:
            before = read_optional(application, name)
            original[name] = before
            wanted = sources[name]
            if before == wanted:
                pending[name] = wanted
                policies[name] = "already installed"
            elif name in recipes and before is not None:
                pending[name], recognized[name] = compose(before, recipes[name])
                policies[name] = "compose current owner source"
            elif before is None or sha(before) in rows[name].get("previous_sha256", []):
                pending[name] = wanted
                policies[name] = "install source" if before is None else "upgrade retained predecessor"
            else:
                raise ValueError("This integration leaf contains an unrecognized concurrent edit: " + name)
        original[MANIFEST] = read_optional(application, MANIFEST)
        pending[MANIFEST] = sources[MANIFEST]
        # A prior manifest is metadata, but validate its component before updating.
        if original[MANIFEST] is not None:
            old_manifest = json.loads(original[MANIFEST])
            if old_manifest.get("schema") != SOURCE_SCHEMA:
                raise ValueError("The existing source manifest belongs to another component")
        policies[MANIFEST] = "source manifest"

        # Parse and compile the complete receiving plan before any source write.
        for name, body in pending.items():
            validate_body(name, body)
        changed = [name for name in pending if pending[name] != original[name]]
        # Publish complete implementation dependencies before shared entrypoints.
        # Registration follows every implementation member; scientific setup is last.
        order = ([row["path"] for row in profiles]
                 + [name for name in PACKAGE_FILES if name not in ENTRYPOINTS
                    and name not in REGISTRATIONS]
                 + list(ENTRYPOINTS) + list(REGISTRATIONS) + [MANIFEST])
        result = {
            "schema": SCHEMA, "operation_id": manifest["operation_id"],
            "application": str(application), "source_root": str(source_root),
            "source_manifest_sha256": sha(sources[MANIFEST]), "dry_run": dry_run,
            "changed": [name for name in order if name in changed],
            "host_sha256": host, "recognized_joins": recognized,
            "reload_operator": True,
            "javascript_validation": {"method": "verified source hashes and exact joins", "node_check": False},
            "files": [{
                "path": name, "bytes": len(pending[name]), "sha256": sha(pending[name]),
                "previous_sha256": sha(original[name]) if original[name] is not None else None,
                "policy": policies[name],
            } for name in order],
            "receiving_commands": [
                "cd " + shlex.quote(str(application))
                + " && " + shlex.quote(sys.executable)
                + " -B -m source_tools.keowee_profile_receiving "
                "--workspace /actual/owned/receiving/keowee-profile",
                shlex.quote(sys.executable) + " -B "
                + shlex.quote(str(application / "source_tools/receive_watershed_edition.py"))
                + " --application " + shlex.quote(str(application))
                + " --manifest " + shlex.quote(str(source_root / "source/water_context/20261013/complete-sources.json"))
                + " --output /actual/owned/receiving/watershed",
                "cd " + shlex.quote(str(application))
                + " && " + shlex.quote(sys.executable)
                + " -B -m source_tools.receive_scientific_setup "
                "--workspace /actual/existing/scientific-workspace --catalog "
                "--output-dir /actual/owned/receiving/setup-catalog",
                "cd " + shlex.quote(str(application))
                + " && " + shlex.quote(sys.executable)
                + " -B -m source_tools.receive_scientific_setup "
                "--workspace /actual/existing/scientific-workspace "
                "--selection /actual/owned/receiving/setup-selection.json "
                "--output-dir /actual/owned/receiving/scientific-setup",
                "cd " + shlex.quote(str(application))
                + " && " + shlex.quote(sys.executable)
                + " -B -m source_tools.gura_setup_review "
                "--workspace /actual/existing/gura-workspace "
                "--receiving /actual/original/receiving.json --catalog "
                "--output-dir /actual/owned/receiving/gura-catalog",
                "cd " + shlex.quote(str(application))
                + " && node source_tools/keowee_interval_receiving.mjs",
                shlex.quote(sys.executable) + " -B "
                + shlex.quote(str(application / "source_tools/receive_first_gura_case.py"))
                + " --application " + shlex.quote(str(application))
                + " --operation-root /actual/original-gura-operation"
                + " --python " + shlex.quote(sys.executable),
            ],
        }
        if dry_run or not changed:
            result["state"] = "planned" if dry_run else "already_installed"
            return result
        with tempfile.TemporaryDirectory(prefix=".keowee-watershed-install-", dir=application) as temporary:
            staging = Path(temporary)
            for name in changed:
                target = regular(application, name, missing=True)
                mode = stat.S_IMODE(target.stat().st_mode) if original[name] is not None else 0o644
                _write_stage(staging / name, pending[name], mode)
            # Staging bytes are the exact compiled receiving plan.
            for name in changed:
                staged = (staging / name).read_bytes()
                if staged != pending[name]:
                    raise ValueError("Staged integration source differs: " + name)
                validate_body(name, staged)
                _same_current(application, name, original[name])
            result["javascript_validation"] = _check_staged_javascript(staging, changed)
            if validate_host(application) != host:
                raise RuntimeError("The native application changed while staging this integration; rerun against its current source")
            installed = []
            for name in order:
                if name not in changed:
                    continue
                _same_current(application, name, original[name])
                target = regular(application, name, missing=True)
                target.parent.mkdir(parents=True, exist_ok=True)
                if original[name] is None:
                    # Creating an absent member must never replace a newly appeared file.
                    os.link(staging / name, target)
                    (staging / name).unlink()
                else:
                    os.replace(staging / name, target)
                _flush_directory(target.parent)
                installed.append(name)
            for name in order:
                if regular(application, name).read_bytes() != pending[name]:
                    raise RuntimeError("A receiving source changed during final verification: " + name)
        result["state"] = "installed"
        result["installed"] = installed
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    result = install(args.application, args.source_root, dry_run=args.dry_run)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
