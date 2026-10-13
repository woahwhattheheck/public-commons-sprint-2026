"""Migrate paired raster analysis into the existing shared operator host.

Run --apply after receiving the complete source. Existing native products,
CLI identities, queued requests and standalone entry assets remain available.
"""
from __future__ import annotations
import argparse
import ast
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile

BLOCK = "\n# ASTRA-ECO12-2651 namespaced original-operator integration\nimport paired_ensemble as _paired_ensemble_extension\n_paired_ensemble_extension.install(sys.modules[__name__])\n\n"
IMPORT = "import paired_ensemble as _paired_ensemble_extension\n"
CALL = "_paired_ensemble_extension.install(sys.modules[__name__])\n"
LINK = '<a href="/web/paired_ensemble.html">Paired multi-pollutant ensembles</a>'
EXPECTED_ACTIONS = {"paired_ensemble.build", "paired_ensemble.resume",
                    "paired_ensemble.export", "paired_ensemble.receive"}
REQUIRED = (
    "install_extensions.py", "operator/extension_registry.py", "operator/web/extension_host.mjs",
    "operator/paired_ensemble_service.py", "operator/paired_ensemble_provider.py",
    "operator/web/paired_ensemble_host.mjs", "operator/web/paired_ensemble_host.css", "operator/extensions/paired-ensemble.json",
    "operator/web/paired_ensemble_desk.mjs", "operator/web/paired_ensemble_desk.css",
    "operator/web/paired_ensemble.html", "operator/web/paired_ensemble.mjs",
    "operator/web/paired_ensemble.css", "model/ensembles.py",
    "model/paired_ensemble/__init__.py", "model/paired_ensemble/designs.py",
    "model/paired_ensemble/ensemble_workspace.py", "model/paired_ensemble/ensemble_rasters.py",
    "model/paired_ensemble/ensemble_store.py", "model/paired_ensemble/ensemble_report.py",
    "model/paired_ensemble/ensemble_portable.py", "model/paired_ensemble/ensemble_cli.py",
)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def atomic(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".paired-host-", delete=False) as out:
            pending = Path(out.name)
            out.write(body)
            out.flush()
            os.fsync(out.fileno())
        if path.exists():
            os.chmod(pending, path.stat().st_mode & 0o777)
        os.replace(pending, path)
        pending = None
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def remove_standalone(source):
    """Remove this component's exact activation without reverting neighbours."""
    migrated = source.count(BLOCK)
    source = source.replace(BLOCK, "\n")
    # A peer may have inserted its own lines beside the two owned statements.
    # Only those exact statements are removed in that case.
    lines = source.splitlines(keepends=True)
    kept = []
    for line in lines:
        if line == IMPORT or line == CALL:
            migrated += 1
        else:
            kept.append(line)
    source = "".join(kept)
    tree = ast.parse(source, filename="operator/server.py")
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "_paired_ensemble_extension"
                and node.func.attr == "install"):
            raise ValueError("Compose the modified paired standalone activation before registering its shared descriptor.")
    return source, migrated


def shared_installer(root):
    path = root / "install_extensions.py"
    spec = importlib.util.spec_from_file_location("upstate_paired_current_shared_installer", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if any(not callable(getattr(module, name, None)) for name in ("patch_server", "patch_app")):
        raise ValueError("Receive the current shared extension installer with server and browser joins.")
    return module


def compose(relative, before, shared):
    text = before.decode("utf-8")
    migrated = 0
    if relative == "operator/server.py":
        text, migrated = remove_standalone(text)
        text = shared.patch_server(text)
        ast.parse(text, filename=relative)
    elif relative == "operator/web/app.mjs":
        text = shared.patch_app(text)
    elif relative == "operator/web/index.html":
        migrated = text.count(LINK)
        text = text.replace(LINK, "")
    return text.encode("utf-8"), migrated


def integrate(application, *, apply=False):
    root = Path(application).resolve(strict=True)
    for name in REQUIRED:
        path = root / name
        if not path.is_file() or path.is_symlink():
            raise ValueError("Receive the complete current paired source: " + name)
        if name.endswith(".py"):
            ast.parse(path.read_text(encoding="utf-8"), filename=name)
    manifest = json.loads((root / "operator/extensions/paired-ensemble.json").read_text(encoding="utf-8"))
    if (manifest.get("schema") != "upstate.operator-extension/v1" or manifest.get("id") != "paired-ensemble"
            or set(manifest.get("backend", {}).get("actions", [])) != EXPECTED_ACTIONS
            or manifest.get("client", {}).get("view", {}).get("id") != "paired-ensemble"):
        raise ValueError("Receive the original paired-raster shared descriptor.")
    registry = ast.parse((root / "operator/extension_registry.py").read_text(encoding="utf-8"))
    registry_class = next((node for node in registry.body if isinstance(node, ast.ClassDef)
                           and node.name == "ExtensionRegistry"), None)
    methods = {node.name for node in registry_class.body if isinstance(node, ast.FunctionDef)} if registry_class else set()
    if not {"register", "file_reply", "_member_path", "verify_workspace"} <= methods:
        raise ValueError("Receive the current shared host with typed nested retained-file routes.")
    shared = shared_installer(root)
    lock_directory = root / ".locks"
    lock_directory.mkdir(exist_ok=True)
    fd = os.open(lock_directory / "extension-install.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        prepared, records = {}, {}
        retired = {}
        previous_descriptor = root / "operator/extensions/paired-ensembles.json"
        if previous_descriptor.exists():
            if previous_descriptor.is_symlink() or not previous_descriptor.is_file():
                raise ValueError("Choose the original regular paired descriptor.")
            body = previous_descriptor.read_bytes()
            if sha(body) != "596075c23bece6f7c54569206b04df94f65d897fbe9ddea5ae730cfe45d51f71":
                raise ValueError("Compose the changed earlier plural paired descriptor before migration.")
            retired["operator/extensions/paired-ensembles.json"] = body
        for relative in ("operator/server.py", "operator/web/app.mjs", "operator/web/index.html"):
            path = root / relative
            if path.is_symlink() or not path.is_file():
                raise ValueError("Choose the original regular application source: " + relative)
            before = path.read_bytes()
            after, migrated = compose(relative, before, shared)
            prepared[relative] = before, after
            records[relative] = {"before_sha256": sha(before), "after_sha256": sha(after),
                                 "bytes": len(after), "standalone_joins_removed": migrated}
        changed = bool(retired) or any(before != after for before, after in prepared.values())
        if apply:
            for relative, before in retired.items():
                if (root / relative).read_bytes() != before:
                    raise ValueError("Concurrent descriptor changed before migration.")
            for relative, (before, _) in prepared.items():
                if (root / relative).read_bytes() != before:
                    raise ValueError("Concurrent source changed before integration: " + relative)
            for relative, (before, after) in prepared.items():
                if before == after:
                    continue
                path = root / relative
                if path.read_bytes() != before:
                    raise ValueError("Concurrent source changed during integration: " + relative)
                backup = root / ".paired-ensemble-source-join" / sha(before) / relative
                if backup.exists():
                    if backup.read_bytes() != before:
                        raise ValueError("The retained integration preimage differs: " + relative)
                else:
                    atomic(backup, before)
                atomic(path, after)
            for relative, before in retired.items():
                path = root / relative
                if path.read_bytes() != before:
                    raise ValueError("Concurrent descriptor changed during migration.")
                atomic(root / ".paired-ensemble-source-join" / sha(before) / relative, before)
                path.unlink()
        return {
            "state": "applied" if apply else "prepared",
            "extension_id": "paired-ensemble", "view": "paired-ensemble",
            "catalogue": "/api/extensions", "opening_path": "/",
            "server_sha256": records["operator/server.py"]["after_sha256"],
            "restart_required": bool(apply and changed),
            "retired_exact_descriptors": list(retired),
            "files": records,
        }
    finally:
        os.close(fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(integrate(args.application, apply=args.apply), sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
