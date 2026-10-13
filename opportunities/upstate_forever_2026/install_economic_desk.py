#!/usr/bin/env python3
"""Install the economic desk into the actual extension-enabled operator."""
from __future__ import annotations

import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile

FILES = (
    "operator/web/economic_received_comparisons.mjs",
    "docs/ECONOMIC_COMPARISON_STUDY_TRANSFER.md",
    "operator/ECONOMIC_COMPARISON_REPORT.md",
    "model/economic_comparison_source.py",
    "model/economic_comparison_study_transfer.py",
    "operator/economic_comparison_source.py",
    "operator/extensions/economic-comparison-source.json",
    "operator/web/economic_comparison_source.mjs",
    "integration/component_fragments/economic-comparison-source.json",
    "model/common.py",
    "model/economic_comparison.py",
    "model/economic_comparison_render.py",
    "operator/economic_comparison.py",
    "operator/extensions/economic-comparison.json",
    "operator/web/economic_comparison.mjs",
    "integration/component_fragments/economic-comparison.json",
    "operator/web/economic_request_store.mjs",
    "install_economic_desk.py",
    "model/native_versions.py",
    "operator/economic_workbench.py",
    "operator/web/economic_desk.mjs",
    "operator/web/economic_cost_worksheet.mjs",
    "operator/web/economic_implementation.mjs",
    "operator/web/economic_desk.css",
    "operator/extensions/economic-desk.json",
)
OPTIONAL_FILES = ("operator/ECONOMIC_DESK.md", "operator/ECONOMIC_COMPARISON.md", "operator/COST_WORKSHEETS.md", "operator/ECONOMIC_IMPLEMENTATION.md")


def sha(body):
    return hashlib.sha256(body).hexdigest()


def require_host(application):
    registry = (application / "operator/extension_registry.py").read_text(encoding="utf-8")
    tree = ast.parse(registry)
    classes = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "ExtensionRegistry"]
    methods = {node.name for node in classes[0].body if isinstance(node, ast.FunctionDef)} if len(classes) == 1 else set()
    server = (application / "operator/server.py").read_text(encoding="utf-8")
    if not {"has_file_route", "file_reply"} <= methods or "self.app.extensions.has_file_route(url.path)" not in server:
        raise ValueError("Apply the current ECSA typed retained-file host overlay F0C8TKYRX52 with its install_extensions.py before registering Economic desk.")
    return {"registry_sha256": sha(registry.encode("utf-8")),
            "server_sha256": sha(server.encode("utf-8"))}


def run(application, source_root, *, dry_run=False):
    application = Path(application).resolve(strict=True)
    source_root = Path(source_root).resolve(strict=True)
    needed = ("operator/server.py", "operator/extension_registry.py",
              "operator/web/extension_host.mjs", "model/decision_analysis.py",
              "model/decision_cli.py", "model/decision_desk.html", "model/model_selection.py")
    for name in needed:
        if not (application / name).is_file():
            raise ValueError("Receive the existing extension host and decision companion; missing " + name)
    host = require_host(application)
    # Compile actual receiving source in memory, without importing GIS or making bytecode files.
    for name in ("model/decision_analysis.py", "model/decision_cli.py"):
        compile((application / name).read_bytes(), str(application / name), "exec")
    locks = application / ".locks"
    locks.mkdir(exist_ok=True)
    with (locks / "extension-install.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        pending, original = {}, {}
        names = list(FILES) + [name for name in OPTIONAL_FILES if (source_root / name).is_file()]
        for name in names:
            before = application / name
            original[name] = before.read_bytes() if before.exists() else None
            data = (source_root / name).read_bytes()
            if name.endswith(".py"):
                compile(data, name, "exec")
            if name.endswith(".json"):
                manifest = json.loads(data)
                if name.startswith("operator/extensions/"):
                    expected_id = Path(name).stem
                    if manifest.get("schema") != "upstate.operator-extension/v1" or manifest.get("id") != expected_id:
                        raise ValueError("Choose the authored " + expected_id + " registration.")
                elif name.startswith("integration/component_fragments/"):
                    if manifest.get("schema") != "upstate.application-component-fragment/v1" or manifest.get("id") != Path(name).stem:
                        raise ValueError("Choose the authored complete Economic comparison component.")
            pending[name] = data
        changed = [name for name in pending if pending[name] != original[name]]
        result = {
            "schema": "upstate.economic-desk-install/v1", "application": str(application),
            "dry_run": dry_run, "changed": changed, "view": "#economic-desk",
            "catalog": "/api/economic-desk/catalog", "host": host,
            "files": [{"path": name, "bytes": len(pending[name]), "sha256": sha(pending[name]),
                       "previous_sha256": sha(original[name]) if original[name] is not None else None}
                      for name in sorted(pending)],
        }
        if dry_run or not changed:
            return result
        with tempfile.TemporaryDirectory(prefix=".economic-install-", dir=application.parent) as temporary:
            staging = Path(temporary)
            for name in changed:
                target = staging / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(pending[name])
            for name in changed:
                target = application / name
                current = target.read_bytes() if target.exists() else None
                if current != original[name]:
                    raise RuntimeError("Current authored changes were preserved at " + name + "; rerun from those bytes.")
            # The shared ECSA host owns routing. Install the current desk and its explicit shared version dependency.
            order = sorted(changed, key=lambda name: (name.endswith("economic-desk.json"), name))
            for name in order:
                target = application / name
                current = target.read_bytes() if target.exists() else None
                if current != original[name]:
                    raise RuntimeError("Concurrent source changed at " + name + "; rerun to finish the remaining installed joins.")
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(staging / name, target)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parent))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(run(args.application, args.source_root, dry_run=args.dry_run), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
