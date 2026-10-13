#!/usr/bin/env python3
"""Install only the sourced cost-range addition into an existing Eco application."""
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
    "model/economic_cost_ranges.py",
    "operator/economic_cost_ranges.py",
    "operator/economic_cost_ranges_cli.py",
    "operator/web/economic_cost_ranges.mjs",
    "operator/web/economic_cost_ranges.css",
    "operator/extensions/economic-cost-ranges.json",
    "operator/ECONOMIC_COST_RANGES.md",
    "source_tools/economic_cost_ranges_original_course.py",
    "source_tools/economic_cost_ranges_browser.mjs",
    "operator/ECONOMIC_COST_RANGES_RECEIVING.md",
    "integration/component_fragments/economic-cost-ranges.json",
    "install_economic_cost_ranges.py"
)
SHARED = "operator/web/economic_request_store.mjs"
ANCHOR = "'economic.comparison.report-source.import'"
NEW = "'economic.cost-ranges.build'"

def sha(body):
    return hashlib.sha256(body).hexdigest()

def safe(root, name):
    path = root
    for part in Path(name).parts:
        if part in ("", ".", "..") or Path(name).is_absolute():
            raise ValueError("Keep source paths inside the selected application.")
        path = path / part
        if path.is_symlink():
            raise ValueError("Preserve the original source; symbolic links are not installed: " + name)
    return path

def run(application, source_root, expected_current=None, dry_run=False):
    application, source_root = Path(application).resolve(strict=True), Path(source_root).resolve(strict=True)
    expected = json.loads(Path(expected_current).read_text()) if expected_current else {}
    if not isinstance(expected, dict):
        raise ValueError("Expected current source is an explicit path to SHA256 map.")
    for name in ("operator/server.py", "operator/extension_registry.py",
                 "operator/web/extension_host.mjs", "operator/economic_comparison.py",
                 "operator/economic_workbench.py", "model/decision_analysis.py",
                 "operator/web/economic_quantity_estimate.mjs", SHARED):
        if not safe(application, name).is_file():
            raise ValueError("Receive the complete original Economic comparison application first: " + name)
    host = safe(application, "operator/extension_registry.py").read_text()
    tree = ast.parse(host)
    classes = [x for x in tree.body if isinstance(x, ast.ClassDef) and x.name == "ExtensionRegistry"]
    methods = {x.name for x in classes[0].body if isinstance(x, ast.FunctionDef)} if len(classes) == 1 else set()
    if not {"has_file_route", "file_reply"} <= methods:
        raise ValueError("Receive the original typed retained-file extension host before this addition.")
    lockdir = safe(application, ".locks")
    lockdir.mkdir(exist_ok=True)
    with (lockdir / "extension-install.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        original, selected = {}, {}
        for name in FILES:
            target = safe(application, name)
            prior = target.read_bytes() if target.exists() else None
            body = safe(source_root, name).read_bytes()
            if name.endswith(".py"):
                compile(body, name, "exec")
            if name.endswith(".json"):
                json.loads(body)
            if prior is not None and prior != body and expected.get(name) != sha(prior):
                raise ValueError("A different maintained source was preserved. Reconcile it and provide its exact expected SHA256: " + name)
            original[name], selected[name] = prior, body
        before = safe(application, SHARED).read_bytes()
        text = before.decode("utf-8")
        if text.count(NEW) == 1:
            after = before
        elif NEW not in text and text.count(ANCHOR) == 1:
            after = text.replace(ANCHOR, ANCHOR + "," + NEW).encode("utf-8")
        else:
            raise ValueError("The maintained Economic recovery allowlist needs an explicit source join.")
        original[SHARED], selected[SHARED] = before, after
        result = {"schema": "upstate.economic-cost-ranges-install/v1",
                  "application": str(application), "source_root": str(source_root),
                  "dry_run": dry_run, "view": "#economic-cost-ranges",
                  "files": [{"path": name, "bytes": len(body), "sha256": sha(body),
                             "previous_sha256": sha(original[name]) if original[name] is not None else None}
                            for name, body in sorted(selected.items())]}
        if dry_run:
            return result
        with tempfile.TemporaryDirectory(prefix=".economic-ranges-", dir=application.parent) as temp:
            stage = Path(temp)
            for name, body in selected.items():
                if body == original[name]:
                    continue
                target = stage / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("wb") as stream:
                    stream.write(body)
                    stream.flush()
                    os.fsync(stream.fileno())
            order = sorted(selected, key=lambda name: (name == "operator/extensions/economic-cost-ranges.json", name))
            for name in order:
                target = safe(application, name)
                current = target.read_bytes() if target.exists() else None
                if current != original[name]:
                    raise RuntimeError("Concurrent source is preserved; reconcile before continuing: " + name)
                if selected[name] == current:
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(stage / name, target)
                fd = os.open(target.parent, os.O_RDONLY)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
        return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parent))
    parser.add_argument("--expected-current", help="Exact prior SHA256 map for explicitly reconciled own-file upgrades.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(run(args.application, args.source_root, args.expected_current, args.dry_run), indent=2))

if __name__ == "__main__":
    main()
