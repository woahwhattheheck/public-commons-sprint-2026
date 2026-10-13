#!/usr/bin/env python3
"""Install implementation planning and fieldwork into the current local operator.

The extension descriptor owns the new actions, reads, items and browser view.
The only desk-specific shared-server join preserves structured native errors.
If the receiving app predates the extension host, this installer composes the
official received host installer in the same prepared change set.
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

FILES = (
    "model/scientific_report.py",
    "model/implementation_qc.py",
    "model/implementation_qc_actions.py",
    "operator/implementation_qc.py",
    "operator/extensions/implementation-qc.json",
    "operator/web/implementation_qc.mjs",
    "integration/implementation_qc.json",
    "source_tools/build_wqp_field_intake.mjs",
    "source_tools/receive_wqp_field_results.py",
    "source_tools/receive_wqp_laboratory_cycle.py",
    "observations/eighteenmile_2023/wqp_20261013/three-lake-stations-original.csv",
    "observations/eighteenmile_2023/wqp_20261013/three-lake-activities-2023-original.csv",
    "observations/eighteenmile_2023/wqp_20261013/three-lake-results-2023-original.csv",
    "observations/eighteenmile_2023/wqp_20261013/field-intake/plan.json",
    "observations/eighteenmile_2023/wqp_20261013/field-intake/mapping.json",
    "observations/eighteenmile_2023/wqp_20261013/field-intake/coverage.json",
    "observations/eighteenmile_2023/wqp_20261013/field-intake/lab-request.json",
    "model/implementation_schema.py",
    "model/implementation.py",
    "model/portable_implementation.py",
    "model/implementation_reporting.py",
    "model/implementation_cli.py",
    "model/implementation_sources.py",
    "model/implementation_economics.py",
    "model/implementation_observations.py",
    "model/implementation_observation_quality.py",
    "model/implementation_outcomes.py",
    "model/implementation_lab_results.py",
    "model/briefing_implementation.py",
    "model/client_briefing.py",
    "source_tools/receive_briefing_followup.py",
    "docs/BRIEFING_FOLLOWUP.md",
    "model/implementation_lab_dispatch.py",
    "model/implementation_dispatch_report.py",
    "operator/implementation_operator.py",
    "operator/implementation_outcomes.py",
    "operator/extensions/implementation.json",
    "operator/extensions/implementation-outcomes.json",
    "operator/web/implementation.mjs",
    "operator/web/implementation_lab.mjs",
    "operator/web/implementation_briefing.mjs",
    "operator/web/implementation_dispatch.mjs",
    "operator/web/implementation_results.mjs",
    "operator/web/implementation_outcomes.mjs",
    "operator/web/implementation_core.mjs",
    "operator/web/implementation_forms.mjs",
    "operator/web/implementation.css",
    "operator/web/implementation_catalog.json",
    "source_tools/receive_implementation.py",
    "source/implementation/20261013/greenwood-review-plan.json",
    "source/keowee-native-receiving-20261013/greenwood-native-feature.json",
    "source/keowee-native-receiving-20261013/source-interval-journey.json",
)
OFFLINE_FILE = "operator/web/implementation_workbench.html"
OFFLINE_BUILDER = "build_implementation_offline.py"
OPTIONAL_FILES = (
    "model/IMPLEMENTATION_QC.md",
    "observations/eighteenmile_2023/wqp_20261013/field-intake/README.md",
    "observations/eighteenmile_2023/wqp_20261013/field-intake/LABORATORY_CYCLE.md",
    OFFLINE_BUILDER,
    "docs/implementation-native-guide.md",
    "docs/implementation-operator-guide.md",
    "IMPLEMENTATION_SOURCE_IMPORT.md",
    "docs/IMPLEMENTATION_OBSERVATIONS.md",
    "docs/IMPLEMENTATION_LAB_RESULTS.md",
    "docs/IMPLEMENTATION_LAB_DISPATCH.md",
    "docs/IMPLEMENTATION_DISPATCH_REPORT.md",
    "docs/IMPLEMENTATION_RESULTS_REVIEW.md",
    "model/IMPLEMENTATION_OUTCOMES_METHOD.md",
    "docs/IMPLEMENTATION_FIELD_CAPTURE.md",
    "docs/IMPLEMENTATION_PORTABLE_RECEIVING.md",
    "docs/IMPLEMENTATION_NATIVE_RECEIVING.md",
)
RECEIPT = ".implementation-install.json"
ERROR_IMPORT = "from implementation_operator import implementation_error\n"
ERROR_JOIN = (
    "    implementation_detail = implementation_error(error)\n"
    "    if implementation_detail is not None:\n"
    "        return implementation_detail\n"
)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def current(root, name):
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError("Installation path must stay inside its ordinary source tree: " + name)
    if path.exists() and not path.is_file():
        raise ValueError("Installation member must be a file: " + name)
    return path.read_bytes() if path.exists() else None


def required(root, name):
    result = current(root, name)
    if result is None:
        raise ValueError("Receive the complete implementation package; missing " + name)
    return result


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def parse_source(name, data):
    if name.endswith(".py"):
        ast.parse(data.decode("utf-8"), filename=name)
    elif name.endswith(".json"):
        value = json.loads(data)
        if name == "operator/extensions/implementation.json":
            if (value.get("schema") != "upstate.operator-extension/v1"
                    or value.get("id") != "implementation"
                    or value.get("backend", {}).get("module") != "implementation_operator"):
                raise ValueError("The native implementation descriptor has another owner.")
        elif name == "operator/web/implementation_catalog.json" and not isinstance(value, dict):
            raise ValueError("The implementation methods catalog must be a JSON object.")


def patch_error(source):
    tree = ast.parse(source, filename="operator/server.py")
    functions = [node for node in tree.body
                 if isinstance(node, ast.FunctionDef) and node.name == "summary_error"]
    if len(functions) != 1 or len(functions[0].args.args) != 1:
        raise ValueError("Expected the current single summary_error(error) function.")
    node = functions[0]
    if node.args.args[0].arg != "error":
        raise ValueError("The current summary_error input needs composition.")
    lines = source.splitlines(keepends=True)
    section = "".join(lines[node.lineno - 1:node.end_lineno])
    if ERROR_JOIN not in section:
        if "implementation_error(" in section:
            raise ValueError("An existing implementation error formatter needs composition.")
        first = node.body[0]
        insert_after_docstring = isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str)
        position = first.end_lineno if insert_after_docstring else first.lineno - 1
        source = "".join(lines[:position]) + ERROR_JOIN + "".join(lines[position:])
    if ERROR_IMPORT not in source:
        anchor = "from model.spatial_exports import SpatialExports\n"
        if source.count(anchor) != 1:
            raise ValueError("Expected the current unique native model import anchor.")
        source = source.replace(anchor, anchor + ERROR_IMPORT, 1)
    ast.parse(source, filename="operator/server.py")
    return source


def host_installed(application, server, app):
    checks = (
        "from extension_registry import ExtensionRegistry",
        "self.extensions = ExtensionRegistry(",
        "self.extensions.handles_action(action)",
        "self.extensions.extend_state(workspace, state)",
        "self.app.extensions.has_route(",
    )
    return (all(value in server for value in checks)
            and "createExtensionHost" in app and "extensions.load()" in app
            and current(application, "operator/extension_registry.py") is not None
            and current(application, "operator/web/extension_host.mjs") is not None)


def load_host_installer(source_root):
    path = source_root / "install_extensions.py"
    required(source_root, "install_extensions.py")
    specification = importlib.util.spec_from_file_location("_upstate_received_extension_installer", path)
    if specification is None or specification.loader is None:
        raise ValueError("Cannot load the received extension-host installer.")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    for name in ("patch_server", "patch_app"):
        if not callable(getattr(module, name, None)):
            raise ValueError("The received host installer must provide " + name)
    return module


def offline_bytes(source_root):
    supplied = current(source_root, OFFLINE_FILE)
    if supplied is not None:
        return supplied
    source = required(source_root, OFFLINE_BUILDER)
    parse_source(OFFLINE_BUILDER, source)
    path = source_root / OFFLINE_BUILDER
    specification = importlib.util.spec_from_file_location("_upstate_received_offline_builder", path)
    if specification is None or specification.loader is None:
        raise ValueError("Cannot load the received offline workbench builder.")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    build = getattr(module, "build", None)
    if not callable(build):
        raise ValueError("The received offline builder must expose build(application, output=None).")
    with tempfile.TemporaryDirectory(prefix="implementation-offline-") as temporary:
        output = Path(temporary) / "implementation_workbench.html"
        receipt = build(source_root, output)
        if (not isinstance(receipt, dict)
                or receipt.get("schema") != "upstate.implementation-offline-build/v1"
                or not isinstance(receipt.get("path"), str)
                or Path(receipt["path"]).resolve() != output.resolve()
                or output.is_symlink() or not output.is_file()):
            raise ValueError("The offline builder must return its actual generated HTML reference.")
        value = output.read_bytes()
        if receipt.get("bytes") != len(value) or receipt.get("sha256") != sha(value):
            raise ValueError("The generated offline HTML differs from its builder receipt.")
        value.decode("utf-8")
        if b"<html" not in value.lower() or b"</html>" not in value.lower():
            raise ValueError("The offline builder must produce a complete HTML document.")
        return value


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def retained_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.is_symlink() or path.read_bytes() != data:
            raise RuntimeError("Retained installation backup differs: " + str(path))
        return
    with path.open("xb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    sync_directory(path.parent)


def run(application, source_root, *, dry_run=False, expected_preimages=None):
    application = Path(application).resolve(strict=True)
    source_root = Path(source_root).resolve(strict=True)
    for name in ("model/workspace.py", "operator/server.py", "operator/web/app.mjs"):
        required(application, name)
    allowed = {}
    prior_receipt = current(application, RECEIPT)
    if prior_receipt:
        prior = json.loads(prior_receipt)
        if prior.get("schema") == "upstate.implementation-install/v1":
            allowed.update({entry["path"]: entry["sha256"] for entry in prior.get("files", [])})
    if expected_preimages is not None:
        supplied = json.loads(Path(expected_preimages).read_text(encoding="utf-8"))
        if not isinstance(supplied, dict) or not all(
                isinstance(name, str) and isinstance(value, str) and len(value) == 64
                for name, value in supplied.items()):
            raise ValueError("Expected preimages must map exact relative paths to their SHA-256.")
        allowed.update(supplied)

    lock_root = application / ".locks"
    lock_root.mkdir(exist_ok=True)
    with (lock_root / "extension-install.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        original, pending = {}, {}

        def authored(name, data=None):
            if data is None:
                data = required(source_root, name)
            parse_source(name, data)
            before = current(application, name)
            if before is not None and before != data:
                same_json = name.endswith(".json") and json.loads(before) == json.loads(data)
                if same_json:
                    data = before
                elif allowed.get(name) != sha(before):
                    raise ValueError(
                        "Preserved current authored edits in " + name +
                        "; compose that source edition or supply its reviewed exact SHA-256 preimage."
                    )
            original[name], pending[name] = before, data

        for name in FILES:
            authored(name)
        for name in OPTIONAL_FILES:
            if current(source_root, name) is not None:
                authored(name)

        authored(OFFLINE_FILE, offline_bytes(source_root))

        server_before = required(application, "operator/server.py")
        app_before = required(application, "operator/web/app.mjs")
        server_text = server_before.decode("utf-8")
        app_text = app_before.decode("utf-8")
        added_host = not host_installed(application, server_text, app_text)
        if added_host:
            host = load_host_installer(source_root)
            for name in host.FILES:
                authored(name)
            for name in getattr(host, "OPTIONAL_FILES", ()):
                if current(source_root, name) is not None:
                    authored(name)
            server_text = host.patch_server(server_text)
            app_text = host.patch_app(app_text)
            original["operator/web/app.mjs"] = app_before
            pending["operator/web/app.mjs"] = app_text.encode("utf-8")
        server_text = patch_error(server_text)
        original["operator/server.py"] = server_before
        pending["operator/server.py"] = server_text.encode("utf-8")

        changed = [name for name in pending if pending[name] != original[name]]
        receipt = dict(
            schema="upstate.implementation-install/v1",
            application=str(application), source_root=str(source_root), dry_run=dry_run,
            added_extension_host=added_host, changed=changed,
            view="implementation", catalogue="/api/extensions",
            files=[dict(path=name, bytes=len(data), sha256=sha(data),
                        previous_sha256=sha(original[name]) if original[name] is not None else None)
                   for name, data in sorted(pending.items())],
        )
        if dry_run:
            return receipt
        with tempfile.TemporaryDirectory(prefix=".implementation-install-", dir=application) as temporary:
            staged = Path(temporary)
            for name in changed:
                target = staged / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as handle:
                    handle.write(pending[name])
                    handle.flush()
                    os.fsync(handle.fileno())
                installed = application / name
                os.chmod(target, installed.stat().st_mode & 0o777 if installed.exists() else 0o644)
            for name in changed:
                if current(application, name) != original[name]:
                    raise RuntimeError("Concurrent authored changes preserved at " + name)
            for name in changed:
                target = application / name
                if current(application, name) != original[name]:
                    raise RuntimeError(
                        "Concurrent authored changes preserved at " + name +
                        "; rerun to compose the remaining received files."
                    )
                target.parent.mkdir(parents=True, exist_ok=True)
                if original[name] is not None:
                    backup = application / ".installation-backups" / "implementation" / sha(original[name]) / name
                    retained_write(backup, original[name])
                    os.replace(staged / name, target)
                else:
                    # Exclusive publication cannot replace a concurrent new file.
                    os.link(staged / name, target)
                sync_directory(target.parent)
            receipt_path = staged / "receipt.json"
            with receipt_path.open("xb") as handle:
                handle.write(json_bytes(receipt))
                handle.flush()
                os.fsync(handle.fileno())
            current_receipt = current(application, RECEIPT)
            if current_receipt != prior_receipt:
                raise RuntimeError("Concurrent installation receipt preserved; rerun to reconcile installed source.")
            if current_receipt is None:
                os.link(receipt_path, application / RECEIPT)
            else:
                os.replace(receipt_path, application / RECEIPT)
            sync_directory(application)
        return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parent))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--expected-preimages", help="JSON mapping of reviewed existing paths to exact SHA-256 preimages")
    args = parser.parse_args(argv)
    result = run(args.application, args.source_root, dry_run=args.dry_run,
                 expected_preimages=args.expected_preimages)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
