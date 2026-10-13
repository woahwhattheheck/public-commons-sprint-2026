#!/usr/bin/env python3
"""Compose owned monitoring modules into an existing full Eco source checkout.

No full server/template replacement. Source preflight, peer-route preservation,
repeat safety and rollback copies are independent of GitHub or hosted CI.
"""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path

RELATIVE = Path("opportunities/upstate_forever_2026")
MARKER = "# ASTRA-MONITOR12 native action extension"
SCRIPT = '<script src="/static/monitoring.js" defer></script>'


def router(source: str) -> str:
    tree = ast.parse(source)
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "route_action"]
    if len(functions) != 1: raise ValueError("expected exactly one original route_action function")
    function = functions[0]
    names = [arg.arg for arg in function.args.args]
    if names[:3] != ["workspace", "action", "params"]:
        raise ValueError("native route_action signature changed; reconcile its exact source contract")
    extension = 'if isinstance(action, str) and action.startswith("monitoring."):\n        from .monitoring import route_monitoring\n        return route_monitoring(workspace, action[len("monitoring."):], params)'
    if MARKER in source:
        if extension not in source: raise ValueError("monitoring router marker exists but its source differs")
        return source
    # Do not silently take over another implementation's namespace.
    body_text = ast.get_source_segment(source, function) or ""
    if '"monitoring."' in body_text or "'monitoring.'" in body_text:
        raise ValueError("a monitoring router already exists without this implementation marker")
    first = function.body[0]
    if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
        line = first.end_lineno
    else:
        line = first.lineno - 1
    lines = source.splitlines(keepends=True)
    block = f"    {MARKER}\n    {extension}\n"
    value = "".join(lines[:line]) + block + "".join(lines[line:])
    ast.parse(value)
    return value


def template(source: str) -> str:
    if SCRIPT in source: return source
    if "monitoring.js" in source: raise ValueError("different monitoring browser integration exists")
    offset = source.lower().rfind("</body>")
    if offset < 0: raise ValueError("original operator/static/index.html has no body closing tag")
    return source[:offset] + SCRIPT + "\n" + source[offset:]


def replace(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as handle: handle.write(data);handle.flush();os.fsync(handle.fileno())
        os.replace(temp,path)
    finally:
        if os.path.exists(temp): os.unlink(temp)


def _body(root: Path, name: str) -> bytes:
    path = root / name
    if (not name or "\\" in name or Path(name).is_absolute()
            or any(part in (".", "..") for part in Path(name).parts)
            or str(Path(name)) != name):
        raise ValueError("Choose an application-relative original source path: " + name)
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Monitoring source leaves its original application: " + name)
    if any(parent.is_symlink() for parent in path.parents if parent != root.parent):
        raise ValueError("Monitoring source has a directory alias: " + name)
    return path.read_bytes()


def _application_source(source_root: Path | None):
    bundle = Path(__file__).resolve().parent
    if source_root is None:
        candidate = bundle.parents[1]
        if not (candidate / "model/monitoring_implementation.py").is_file():
            return None, None
    else:
        candidate = source_root.expanduser().resolve()
        if (candidate / RELATIVE / "model/workspace.py").is_file():
            candidate = candidate / RELATIVE
    manifest_path = bundle / "current_application_files.json"
    if manifest_path.is_symlink():
        raise ValueError("Receive the original Monitoring file inventory as a regular file")
    spec = json.loads(manifest_path.read_bytes())
    if spec.get("schema") != "upstate.monitoring-application-files/v1":
        raise ValueError("Receive the current Monitoring application file inventory")
    for key in ("files", "requires"):
        paths = spec.get(key)
        if (not isinstance(paths, list) or not paths
                or any(not isinstance(name, str) for name in paths)
                or len(paths) != len(set(paths))):
            raise ValueError("Invalid current Monitoring " + key + " inventory")
        for name in paths:
            _body(candidate, name)
    return candidate.resolve(), spec


def install(target: Path, *, check: bool = False, source_root: Path | None = None) -> dict:
    target = target.expanduser().resolve()
    application = target / RELATIVE if (target / RELATIVE / "model/workspace.py").is_file() else target
    if not (application / "model/workspace.py").is_file():
        raise ValueError("Choose the actual application directory or its complete source repository root")
    prefix = application.relative_to(target)
    server_source = (application / "operator/server.py").read_text()
    native = "class Operator" in server_source
    registry = (application / "operator/extension_registry.py").is_file()
    registered_host = registry and 'self.extensions = ExtensionRegistry' in server_source
    if registry and not registered_host:
        raise ValueError("Install the current shared extension host on this application before adding its registered monitoring desk")
    source_application, source_spec = _application_source(source_root)
    if source_application is not None and not registered_host:
        raise ValueError("Install the maintained shared extension host before the current Monitoring application")
    if source_spec is not None:
        for name in source_spec["requires"]:
            _body(application, name)
    package_root = Path(__file__).resolve().parent / "src"
    changes = {}
    source_identities = {}
    preimages = {}
    predecessor_file = Path(__file__).resolve().parent / "PREDECESSORS.json"
    predecessors = json.loads(predecessor_file.read_text()) if predecessor_file.exists() else {}
    if source_application is not None:
        selected_files = [(name, _body(source_application, name)) for name in source_spec["files"]]
    else:
        selected_files = [(source.relative_to(package_root / RELATIVE).as_posix(), source.read_bytes())
                          for source in sorted(package_root.rglob("*"))
                          if source.is_file() and "__pycache__" not in source.parts]
    for name, data in selected_files:
        rel = prefix / name
        destination = target / rel
        if destination.is_symlink() or not destination.resolve().is_relative_to(application):
            raise ValueError("Monitoring destination leaves its application: " + name)
        old = _body(application, name) if destination.exists() else None
        source_identities[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        if old != data:
            if old is not None:
                old_hash = hashlib.sha256(old).hexdigest()
                canonical = "src/" + str(RELATIVE / name)
                packaged = package_root / RELATIVE / name
                known = [edition.get(canonical) for edition in predecessors.values()]
                if source_application is not None and packaged.is_file():
                    known.append(hashlib.sha256(packaged.read_bytes()).hexdigest())
                if old_hash not in known:
                    raise ValueError(f"owned source already differs: {rel}; compose its current source before replacing it")
            changes[rel] = data
            preimages[rel] = old
    server_rel = prefix / "operator/server.py"
    if registered_host:
        from install_native_monitoring import remove_server, remove_app, remove_index
        index_rel = prefix / "operator/web/index.html"
        transforms = [(server_rel,remove_server),(index_rel,remove_index),(prefix / "operator/web/app.mjs",remove_app)]
    elif native:
        from install_native_monitoring import server as native_server, app as native_app, index as native_index
        index_rel = prefix / "operator/web/index.html"
        transforms = [(server_rel,native_server),(index_rel,native_index),(prefix / "operator/web/app.mjs",native_app)]
    else:
        index_rel = prefix / "operator/static/index.html"
        transforms = [(server_rel,router),(index_rel,template)]
    for rel, transform in transforms:
        before = (target/rel).read_bytes()
        after = transform(before.decode("utf-8")).encode("utf-8")
        if after != before:
            changes[rel] = after
            preimages[rel] = before
    for rel, data in changes.items():
        if rel.suffix == ".py": ast.parse(data.decode("utf-8"))
    result = {"target": str(target), "check_only": check, "integration": "shared-extension-registry" if registered_host else "original-direct-join", "changed_paths": [str(p) for p in changes],
              "source_sha256": {str(p): hashlib.sha256(data).hexdigest() for p,data in changes.items()},
              "source_mode": "maintained-application" if source_application else "retained-original-package",
              "source_application": str(source_application) if source_application else None,
              "source_edition": source_spec["edition"] if source_spec else None,
              "source_files": source_identities}
    if check or not changes: return result
    # Local lock excludes two installers, and preimages are rechecked under it.
    import fcntl
    lock_path = application / ".locks/extension-install.lock" if registered_host else target / ".monitoring-install.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        # Every integration preimage is captured before preparation above; rerun
        # check now catches concurrent peer edits instead of replacing their work.
        latest = install(target, check=True, source_root=source_root)
        if (latest["source_sha256"] != result["source_sha256"]
                or latest["source_files"] != result["source_files"]
                or any(((target / rel).read_bytes() if (target / rel).exists() else None) != body
                       for rel, body in preimages.items())):
            raise ValueError("source changed during installation; rerun against the latest composition")
        backup = target / ".monitoring-install-backups" / hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()[:16]
        backup.mkdir(parents=True,exist_ok=True)
        originals = {rel:(target/rel).read_bytes() if (target/rel).exists() else None for rel in changes}
        for rel, data in originals.items():
            if data is not None: replace(backup/rel,data)
        written=[]
        try:
            # Shared dispatch/template become visible only after owned modules.
            order=sorted(changes,key=lambda p:(p in {rel for rel,_ in transforms},str(p)))
            for rel in order:
                replace(target/rel,changes[rel]);written.append(rel)
        except BaseException:
            for rel in reversed(written):
                if originals[rel] is None: (target/rel).unlink(missing_ok=True)
                else: replace(target/rel,originals[rel])
            raise
        result["backup"] = str(backup)
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("source_root",type=Path)
    p.add_argument("--check",action="store_true")
    p.add_argument("--source-root", dest="maintained_source", type=Path,
                   help="Pinned complete application or repository containing the current Monitoring source")
    a=p.parse_args()
    try: print(json.dumps(install(a.source_root,check=a.check,source_root=a.maintained_source),indent=2))
    except (ValueError,OSError,SyntaxError) as exc: p.exit(2,f"monitoring install: {exc}\n")


if __name__ == "__main__": main()
