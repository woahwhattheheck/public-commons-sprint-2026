#!/usr/bin/env python3
"""Register received Water and Habitat Context with the current portable application."""
from __future__ import annotations

import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile

REQUIRED = (
    "model/water_context.py", "model/WATER_CONTEXT.md",
    "operator/water_context_service.py", "operator/WATER_CONTEXT_SERVICE.md",
    "operator/web/water_context.mjs", "operator/web/water_context_map.mjs",
    "operator/web/water_context.css", "operator/extensions/water-context.json",
    "water_context_cli.py", "WATER_CONTEXT_OPERATOR.md",
)
ROOT_FILES = ("water_context_cli.py", "WATER_CONTEXT_OPERATOR.md")


def sha(body):
    return hashlib.sha256(body).hexdigest()


def source_file(application, name):
    path = application
    for part in Path(name).parts:
        path = path / part
        if path.is_symlink():
            raise ValueError("Receive regular application source: " + name)
    if not path.is_file():
        raise ValueError("Receive the complete current application first; missing " + name)
    return path


def portable_source(source):
    """Append only missing owned roots to the actual ordered literal inventory."""
    tree = ast.parse(source, filename="model/portable.py")
    declared, last = [], None

    def sequence(node):
        if isinstance(node, ast.Name) and node.id == "APPLICATION_FILES":
            return list(declared)
        if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
            values = []
            for item in node.elts:
                if isinstance(item, ast.Starred):
                    values.extend(sequence(item.value))
                elif isinstance(item, ast.Constant) and isinstance(item.value, str):
                    values.append(item.value)
                else:
                    raise ValueError("Portable application files must use literal names")
            return values
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            return sequence(node.left) + sequence(node.right)
        if isinstance(node, ast.Call) and len(node.args) == 1 and not node.keywords:
            constructor = isinstance(node.func, ast.Name) and node.func.id in {"tuple", "list", "set"}
            unique = (isinstance(node.func, ast.Attribute) and node.func.attr == "fromkeys"
                      and isinstance(node.func.value, ast.Name) and node.func.value.id == "dict")
            if constructor or unique:
                return sequence(node.args[0])
        raise ValueError("Compose the current literal APPLICATION_FILES declaration")

    for node in tree.body:
        if isinstance(node, ast.Assign):
            targets, value = node.targets, node.value
        elif isinstance(node, ast.AnnAssign):
            targets, value = [node.target], node.value
        elif (isinstance(node, ast.AugAssign) and isinstance(node.target, ast.Name)
              and node.target.id == "APPLICATION_FILES"):
            if not isinstance(node.op, ast.Add):
                raise ValueError("Compose the current portable inventory operation")
            declared += sequence(node.value)
            last = node
            continue
        else:
            continue
        if any(isinstance(target, ast.Name) and target.id == "APPLICATION_FILES" for target in targets):
            if value is None:
                continue
            declared = sequence(value)
            last = node
    if last is None:
        raise ValueError("The current application has no portable APPLICATION_FILES inventory")
    missing = tuple(name for name in ROOT_FILES if name not in declared)
    if not missing:
        return source
    lines = source.splitlines(keepends=True)
    addition = "# Water and Habitat Context root command and operating guide.\nAPPLICATION_FILES += " + repr(missing) + "\n"
    prefix = "".join(lines[:last.end_lineno])
    if not prefix.endswith("\n"):
        prefix += "\n"
    updated = prefix + addition + "".join(lines[last.end_lineno:])
    ast.parse(updated, filename="model/portable.py")
    return updated


def compose(application):
    """Use installed shared hooks; the addon never supplies a replacement host."""
    bodies = {}
    for name in (*REQUIRED, "install_extensions.py", "operator/extension_registry.py",
                 "model/portable.py", "operator/server.py", "operator/web/app.mjs"):
        bodies[name] = source_file(application, name).read_bytes()
    for name in REQUIRED:
        if name.endswith(".py"):
            compile(bodies[name], str(application / name), "exec")
    descriptor = json.loads(bodies["operator/extensions/water-context.json"])
    if (descriptor.get("schema") != "upstate.operator-extension/v1"
            or descriptor.get("id") != "water-context"
            or descriptor.get("backend", {}).get("module") != "water_context_service"):
        raise ValueError("Receive the original Water and Habitat Context descriptor")
    host = application / "install_extensions.py"
    namespace = {"__name__": "_water_context_current_installer", "__file__": str(host)}
    exec(compile(bodies["install_extensions.py"], str(host), "exec"), namespace)
    if not callable(namespace.get("patch_server")) or not callable(namespace.get("patch_app")):
        raise ValueError("The installed extension owner must supply patch_server and patch_app")
    pending = {
        "operator/server.py": namespace["patch_server"](bodies["operator/server.py"].decode("utf-8")).encode("utf-8"),
        "operator/web/app.mjs": namespace["patch_app"](bodies["operator/web/app.mjs"].decode("utf-8")).encode("utf-8"),
        "model/portable.py": portable_source(bodies["model/portable.py"].decode("utf-8")).encode("utf-8"),
    }
    for name, body in pending.items():
        if name.endswith(".py"):
            compile(body, str(application / name), "exec")
    return bodies, pending


def install(application, *, dry_run=False):
    application = Path(application).resolve(strict=True)
    lock_root = application / ".locks"
    if lock_root.is_symlink():
        raise ValueError("The application lock directory is a file alias")
    lock_root.mkdir(exist_ok=True)
    lock_path = lock_root / "extension-install.lock"
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        original, pending = compose(application)
        changes = [name for name, body in pending.items() if body != original[name]]
        receipt = {
            "schema": "upstate.water-context-install/v1", "application": str(application),
            "dry_run": dry_run, "changed": changes, "retained_root_files": list(ROOT_FILES),
            "files": [{"path": name, "bytes": len(body), "sha256": sha(body),
                       "previous_sha256": sha(original[name])} for name, body in sorted(pending.items())],
            "dependencies": [{"path": name, "bytes": len(body), "sha256": sha(body)}
                             for name, body in sorted(original.items()) if name not in pending],
        }
        if dry_run or not changes:
            return receipt
        staged, applied = {}, []
        try:
            for name in changes:
                path = source_file(application, name)
                with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".water-context-install-", delete=False) as out:
                    out.write(pending[name])
                    out.flush()
                    os.fsync(out.fileno())
                    staged[name] = Path(out.name)
                os.chmod(staged[name], path.stat().st_mode & 0o777)
            for name, expected in original.items():
                if source_file(application, name).read_bytes() != expected:
                    raise ValueError("Concurrent current source change: " + name)
            for name in changes:
                path = source_file(application, name)
                if path.read_bytes() != original[name]:
                    raise ValueError("Concurrent current source change: " + name)
                os.replace(staged[name], path)
                applied.append(name)
        except BaseException:
            # Restore only a source body still identical to this operation's write.
            for name in reversed(applied):
                path = source_file(application, name)
                if path.read_bytes() != pending[name]:
                    continue
                with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".water-context-rollback-", delete=False) as out:
                    out.write(original[name])
                    out.flush()
                    os.fsync(out.fileno())
                    rollback = Path(out.name)
                os.chmod(rollback, path.stat().st_mode & 0o777)
                os.replace(rollback, path)
            raise
        finally:
            for path in staged.values():
                path.unlink(missing_ok=True)
        return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(install(args.application, dry_run=args.dry_run), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
