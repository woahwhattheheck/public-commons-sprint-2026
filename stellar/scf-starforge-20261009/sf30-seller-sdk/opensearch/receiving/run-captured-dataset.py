#!/usr/bin/env python3
"""Receive actual saved OpenSearch editions through the original dataset product.

Uses the retained-review source assembler, the original receiver lock, and two
separate guarded Node processes. No upstream provider request is performed.
Python 3.10+, Node 24+, and the original util-linux flock executable are required.
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import tempfile
from uuid import uuid4
import zipfile

ROOT = "stellar/scf-starforge-20261009"
SDK = ROOT + "/sf30-seller-sdk"
PREFIX = SDK + "/opensearch/receiving"
CORE_FILES = {
    PREFIX + "/retained-local-network.mjs",
    PREFIX + "/retained-review.mjs",
    PREFIX + "/run-retained-review.py",
    PREFIX + "/RETAINED-REVIEW.md",
    SDK + "/dataset-workspace.mjs",
    SDK + "/dataset-workspace.html",
    SDK + "/dataset-workspace.js",
    SDK + "/opensearch/captured-dataset.mjs",
    SDK + "/opensearch/CAPTURED-DATASETS.md",
    PREFIX + "/captured-local-network.mjs",
    PREFIX + "/captured-dataset-journey.mjs",
    PREFIX + "/run-captured-dataset.py",
}
EXTRA_FILES = {SDK + "/dataset-cli.mjs", SDK + "/opensearch/README.md",
               SDK + "/opensearch/workspace/README.md"}


def load_helpers(source):
    filename = source / PREFIX / "run-retained-review.py"
    spec = importlib.util.spec_from_file_location("original_retained_receiving", filename)
    if spec is None or spec.loader is None:
        raise ValueError("Read the original retained receiving assembler.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def assemble(h, archive, expected_sha256, target, source_root, selected_raw):
    selection = json.loads(selected_raw)
    h.need(selection.get("schema") == "stellar-forge.opensearch-captured-source-selection.v1"
           and isinstance(selection.get("files"), dict)
           and CORE_FILES <= set(selection["files"])
           and set(selection["files"]) <= CORE_FILES | EXTRA_FILES,
           "Select the complete maintained captured-edition source and original operator assets.")
    original = h.assemble(archive, expected_sha256, target, source_root / PREFIX)
    additions, replacements = {}, {}
    for name, expected in sorted(selection["files"].items()):
        h.safe_name(name)
        h.need(isinstance(expected, dict) and {"bytes", "sha256", "mode"} <= set(expected)
               and set(expected) <= {"bytes", "sha256", "mode", "replacesSha256"}
               and type(expected["bytes"]) is int and 0 < expected["bytes"] <= 256 * 1024
               and expected["mode"] in (0o644, 0o755),
               "Use exact bounded source member descriptors.")
        body = h.regular(source_root / name, 256 * 1024)
        h.need(len(body) == expected["bytes"] and h.digest(body) == expected["sha256"],
               "A selected product source member changed: " + name)
        destination = target / name
        if destination.exists():
            prior = h.regular(destination, 256 * 1024)
            if prior != body:
                h.need(expected.get("replacesSha256") == h.digest(prior),
                       "An intentional selected source replacement needs its original base checksum: " + name)
                replacements[name] = {"bytes": len(prior), "sha256": h.digest(prior)}
                h.atomic(destination, body)
                os.chmod(destination, expected["mode"])
            else:
                h.need("replacesSha256" not in expected or expected["replacesSha256"] == h.digest(prior),
                       "The selected original source replacement differs: " + name)
        else:
            h.need("replacesSha256" not in expected, "The selected base source member is missing: " + name)
            h.retain(destination, body, expected["mode"])
        additions[name] = {key: expected[key] for key in ("bytes", "sha256", "mode")}
    return {"schema": "stellar-forge.opensearch-captured-source-assembly.v1",
            "original": original, "sourceSelectionSha256": h.digest(selected_raw),
            "extensions": additions, "replacements": replacements}


def portable_source(h, source, assembly, directory, temporary):
    original_raw = h.regular(source / "SOURCE_MANIFEST.json", 1024 * 1024)
    original = json.loads(original_raw)
    members = dict(original["files"])
    for name, value in assembly["extensions"].items():
        if name in members and members[name] != value:
            prior = assembly["replacements"].get(name)
            h.need(prior and members[name]["sha256"] == prior["sha256"]
                   and members[name]["bytes"] == prior["bytes"],
                   "Preserve the selected original source preimage: " + name)
        members[name] = value
    members["SOURCE_MANIFEST.json"] = {"bytes": len(original_raw),
                                      "sha256": h.digest(original_raw), "mode": 0o644}
    manifest = {"schema": "stellar-forge.opensearch-captured-runtime.v1",
                "assemblySha256": h.digest(h.encoded(assembly)),
                "files": members, "bytes": sum(value["bytes"] for value in members.values())}
    manifest_raw = h.encoded(manifest)
    selection = h.digest(manifest_raw)
    filename = "captured-source-" + selection + ".zip"
    candidate = temporary / filename
    with zipfile.ZipFile(candidate, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as package:
        for name, expected in sorted(members.items()):
            raw = h.regular(source / str(h.safe_name(name)))
            h.need(len(raw) == expected["bytes"] and h.digest(raw) == expected["sha256"],
                   "A selected source file changed during portable assembly: " + name)
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | expected["mode"]) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            package.writestr(info, raw)
        info = zipfile.ZipInfo("CAPTURED_SOURCE_MANIFEST.json", (1980, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = (stat.S_IFREG | 0o644) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        package.writestr(info, manifest_raw)
    raw = h.regular(candidate)
    target = directory / "source" / filename
    h.retain(target, raw)
    h.retain(directory / "source" / ("assembly-" + selection + ".json"), h.encoded(assembly))
    return {"path": str(target.relative_to(directory)), "bytes": len(raw), "sha256": h.digest(raw),
            "manifestSha256": selection, "files": len(members) + 1, "sourceBytes": manifest["bytes"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True, help="Original retained receiver directory")
    parser.add_argument("--output", type=Path, required=True, help="Separate captured-product working directory")
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--expected-archive-sha256", required=True)
    parser.add_argument("--selection", type=Path, required=True, help="Original customer and capture identities")
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--source-manifest", type=Path, required=True)
    parser.add_argument("--runtime-root", type=Path, required=True)
    parser.add_argument("--node", default="node")
    parser.add_argument("--flock", default="flock")
    args = parser.parse_args()
    os.umask(0o077)
    directory = args.directory.expanduser().resolve()
    output = args.output.expanduser().resolve()
    runtime = args.runtime_root.expanduser().resolve()
    source_root = args.source_root.expanduser().resolve()
    h = load_helpers(source_root)
    h.need(output != directory and output != directory / "workspace"
           and output not in directory.parents and directory / "workspace" not in output.parents,
           "Keep the captured product separate from the original workspace and receiver root.")
    h.need(runtime != output and runtime not in output.parents and output not in runtime.parents
           and runtime != directory and runtime not in directory.parents and directory not in runtime.parents,
           "Keep reproducible runtime separate from both retained stores.")
    h.need((directory / "receiver.lock").is_file()
           and (directory / "workspace/workspace.sqlite3").is_file(),
           "Use the existing receiver, original SQLite workspace and original lock.")
    selection_raw = h.regular(args.selection, 256 * 1024)
    selection = json.loads(selection_raw)
    h.need(selection.get("schema") == "stellar-forge.opensearch-captured-customer.v1"
           and isinstance(selection.get("operation"), str) and selection["operation"],
           "Use the original complete captured-product customer selection.")
    source_selection_raw = h.regular(args.source_manifest, 256 * 1024)
    checkpoint = directory / "deployment-journey.json"
    before = h.regular(checkpoint, 4 * 1024 * 1024)
    h.need(h.digest(before) == selection["originalLiveReportSha256"],
           "Reconcile the original live checkpoint before receiving its captured editions.")
    package_id = selection["basePackageId"]
    h.need(isinstance(package_id, str) and package_id and all(c in "0123456789abcdef" for c in package_id),
           "Select the original retained package ID.")
    plan = directory / "workspace/packages" / package_id / "merchant-plan.json"
    plan_raw = h.regular(plan, 256 * 1024)
    node_name, flock_name = shutil.which(args.node), shutil.which(args.flock)
    h.need(node_name is not None and flock_name is not None, "Use the original Node and util-linux flock binaries.")
    node, flock = Path(node_name).resolve(), Path(flock_name).resolve()
    flock_raw = h.regular(flock, 8 * 1024 * 1024)
    h.need(os.access(flock, os.X_OK), "The original selected flock binary must be executable.")
    environment = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
                   "PYTHONDONTWRITEBYTECODE": "1"}
    node_version = subprocess.run([str(node), "--version"], check=True, capture_output=True,
                                  text=True, env=environment).stdout.strip()
    h.need(int(node_version.lstrip("v").split(".")[0]) >= 24, "Node 24+ is required.")
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    state_path = output / "receiving-run.json"
    if state_path.exists():
        state = json.loads(h.regular(state_path, 4 * 1024 * 1024))
        h.need(state.get("operation") == selection["operation"]
               and state.get("selectionSha256") == h.digest(selection_raw),
               "Keep this receiving history with its original operation and captured inputs.")
    else:
        state = {"schema": "stellar-forge.opensearch-captured-receiving.v1",
                 "operation": selection["operation"], "selectionSha256": h.digest(selection_raw),
                 "originalLiveReportSha256": h.digest(before), "startedAt": h.now(), "attempts": []}
    attempt = {"id": uuid4().hex, "startedAt": h.now(), "node": {"path": str(node), "version": node_version},
               "flock": {"path": str(flock), "bytes": len(flock_raw), "sha256": h.digest(flock_raw)},
               "processes": [], "sourceSelectionSha256": h.digest(source_selection_raw)}
    child, temporary, handlers = None, None, {}
    with (directory / "receiver.lock").open("r+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        h.need(h.regular(checkpoint, 4 * 1024 * 1024) == before,
               "The live checkpoint changed before original receiver ownership.")
        state["attempts"].append(attempt)
        try:
            handlers = {sig: signal.signal(sig, h.interrupted) for sig in (signal.SIGTERM, signal.SIGINT)}
            runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
            temporary = Path(tempfile.mkdtemp(prefix="captured-dataset-", dir=runtime))
            source = temporary / "source"
            source.mkdir(mode=0o700)
            assembly = assemble(h, args.archive, args.expected_archive_sha256, source,
                                source_root, source_selection_raw)
            source_archive = portable_source(h, source, assembly, output, temporary)
            h.retain(output / "selection.json", selection_raw)
            h.retain(output / "original-public-terms.json", plan_raw)
            attempt["sourceArchive"] = source_archive
            state.update(phase="SOURCE_READY", sourceArchive=source_archive)
            h.atomic(state_path, h.encoded(state))
            common = [str(node), "--max-old-space-size=192", str(source / PREFIX / "captured-dataset-journey.mjs"),
                      "--workspace", str(directory / "workspace"), "--directory", str(output),
                      "--plan", str(output / "original-public-terms.json"), "--selection", str(output / "selection.json"),
                      "--flock", str(flock), "--flock-sha256", h.digest(flock_raw)]
            environment["TMPDIR"] = str(temporary)
            report_path = output / "captured-dataset-journey.json"
            phases = [("operate", "OPERATIONS_COMPLETE"), ("reopen", "COMPLETE")]
            if report_path.exists():
                previous = json.loads(h.regular(report_path, 4 * 1024 * 1024))
                if any(stage.get("name") == "operator-rollback" for stage in previous.get("stages", [])):
                    phases = [("reopen", "COMPLETE")]
            for mode, expected in phases:
                record = {"mode": mode, "startedAt": h.now()}
                attempt["processes"].append(record)
                state["phase"] = mode.upper()
                h.atomic(state_path, h.encoded(state))
                child = subprocess.Popen(common + ["--mode", mode], cwd=source, env=environment,
                                         start_new_session=True)
                record["pid"] = child.pid
                h.atomic(state_path, h.encoded(state))
                code = child.wait()
                record.update(endedAt=h.now(), exitCode=code)
                child = None
                h.atomic(state_path, h.encoded(state))
                h.need(code == 0, "The original captured " + mode + " process exited " + str(code))
                report = json.loads(h.regular(report_path, 4 * 1024 * 1024))
                h.need(report.get("state") == expected, "The complete captured product phase is unfinished.")
                h.need(h.regular(checkpoint, 4 * 1024 * 1024) == before, "Preserve the original live checkpoint.")
            report_raw = h.regular(report_path, 4 * 1024 * 1024)
            attempt.update(phase="COMPLETE", endedAt=h.now())
            state.update(phase="COMPLETE", completedAt=h.now(), originalLiveReportUnchanged=True,
                         report={"path": report_path.name, "bytes": len(report_raw), "sha256": h.digest(report_raw)})
            state.pop("error", None)
            h.atomic(state_path, h.encoded(state))
            print(json.dumps({"state": "COMPLETE", "directory": str(output),
                              "report": state["report"], "source": source_archive}), flush=True)
            return 0
        except KeyboardInterrupt:
            attempt.update(phase="INTERRUPTED", endedAt=h.now())
            state.update(phase="INTERRUPTED", endedAt=h.now())
            h.atomic(state_path, h.encoded(state))
            return 130
        except Exception as error:
            attempt.update(phase="FAILED", endedAt=h.now(), error=str(error))
            state.update(phase="FAILED", endedAt=h.now(), error=str(error))
            h.atomic(state_path, h.encoded(state))
            print(json.dumps({"state": "FAILED", "error": str(error)}), flush=True)
            return 1
        finally:
            h.stop(child)
            for sig, previous in handlers.items():
                signal.signal(sig, previous)
            if temporary is not None:
                shutil.rmtree(temporary)
            with contextlib.suppress(OSError):
                runtime.rmdir()
            attempt["childrenDrainedAt"] = h.now()
            h.atomic(state_path, h.encoded(state))
            fcntl.flock(lock, fcntl.LOCK_UN)


if __name__ == "__main__":
    raise SystemExit(main())
