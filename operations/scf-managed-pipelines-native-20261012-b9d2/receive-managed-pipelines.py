#!/usr/bin/env python3
"""Receive and run the original managed Pipelines native journey on an equipped Linux host."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tempfile

OPERATION = "SCF-MANAGED-UNSTRUCTURED-PIPELINES-B9D2-20261012"
REPOSITORY = "woahwhattheheck/public-commons-sprint-2026"
COMMIT = "7f4a42f78b8bfd491f7932e623fdffea55affef7"
CARRIER_BLOB = "d0cb258733703378769423f51dc2ef40219c23ab"
SOURCE_PREFIX = "stellar/scf-starforge-20261009/"
NATIVE_ENTRY = ("sf88-operator-buyer-cli/research-dossiers/unstructured-pipelines/"
                "native/managed-pipelines-native.mjs")
BINDING_SCHEMA = "stellar-forge.managed-pipelines-native-receiving.v1"
PLAN_FILE = "native-receiving.json"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    hasher = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def read_json(path):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("Duplicate JSON field: " + key)
            value[key] = item
        return value
    return json.loads(Path(path).read_bytes(), object_pairs_hook=unique)


def absolute(value):
    original = Path(value).expanduser()
    if not original.is_absolute():
        raise ValueError("Select an absolute host path: " + str(value))
    return original.resolve()


def child(root, relative):
    path = PurePosixPath(relative)
    if (not relative or str(path) != relative or path.is_absolute()
            or any(part in ("", ".", "..") for part in relative.split("/"))):
        raise ValueError("Invalid selected source path: " + relative)
    target = root.joinpath(*path.parts)
    if not target.resolve().is_relative_to(root):
        raise ValueError("Selected path leaves its receiving directory: " + relative)
    return target


def immutable(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError("Retained file differs; keep its original operation: " + str(path))
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".receiving-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        # Link publishes only when absent, including with a concurrent receiver.
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_bytes() != data:
                raise ValueError("A concurrent receiver retained different bytes: " + str(path))
        parent = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def executable(value):
    path = absolute(value)
    if not path.is_file() or not os.access(path, os.X_OK):
        raise ValueError("Select the existing executable: " + str(path))
    return path


def existing_directory(value):
    path = absolute(value)
    if not path.is_dir():
        raise ValueError("Select an existing directory: " + str(path))
    return path


def observed_version(argv):
    return subprocess.check_output(argv, text=True, stderr=subprocess.STDOUT, timeout=20).strip()


def verify_selection(plan):
    if plan.get("schema") != BINDING_SCHEMA or plan.get("operation_id") != OPERATION:
        raise ValueError("Receiving plan does not identify the original managed Pipelines operation.")
    if plan.get("source_commit") != COMMIT or plan.get("source_carrier_git_blob") != CARRIER_BLOB:
        raise ValueError("Receiving plan changed the selected source.")
    root = absolute(plan["directory"])
    repository = root / "source"
    for name, expected in plan["source_files"].items():
        data = child(repository, name).read_bytes()
        if (len(data) != expected["bytes"] or digest(data) != expected["sha256"]
                or git_blob(data) != expected["gitBlob"]):
            raise ValueError("Selected source changed: " + name)
    identity = root / "native-source.json"
    if digest(identity.read_bytes()) != plan["source_identity_sha256"]:
        raise ValueError("Original source identity changed.")
    for name, selected in plan["runtime"].items():
        if file_digest(selected["path"]) != selected["sha256"]:
            raise ValueError("Selected runtime entry changed: " + name)
    return root


def prepare(args):
    if not sys.platform.startswith("linux"):
        raise ValueError("This selected original product uses Linux util-linux flock.")
    root = absolute(args.directory)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    data = absolute(args.source_carrier).read_bytes()
    if len(data) > 8 * 1024 * 1024 or git_blob(data) != CARRIER_BLOB:
        raise ValueError("Use the exact retained public source-carrier Git blob.")
    carrier = read_json(args.source_carrier)
    if (carrier.get("repository") != REPOSITORY or carrier.get("commit") != COMMIT
            or not isinstance(carrier.get("files"), dict) or len(carrier["files"]) != 117):
        raise ValueError("The selected source carrier must contain its original 117 files.")
    repository = root / "source"
    repository.mkdir(exist_ok=True, mode=0o700)
    measured, selected = {}, {}
    for name, value in carrier["files"].items():
        body = value["content"].encode("utf-8")
        if git_blob(body) != value["gitBlob"]:
            raise ValueError("Source-carrier member differs: " + name)
        immutable(child(repository, name), body)
        measured[name] = {"gitBlob": value["gitBlob"], "sha256": digest(body), "bytes": len(body)}
        if name.startswith(SOURCE_PREFIX):
            selected[name[len(SOURCE_PREFIX):]] = measured[name]
    identity = {"schema": "stellar-forge.native-source-selection.v1", "repository": REPOSITORY,
                "commit": COMMIT, "files": selected}
    identity_bytes = json_bytes(identity)
    immutable(root / "native-source.json", identity_bytes)
    node, chromium = executable(args.node), executable(args.chromium)
    playwright = absolute(args.playwright)
    if not playwright.is_file():
        raise ValueError("Select the installed Playwright module entry.")
    controller = existing_directory(args.controller_host)
    for leaf in ("swarm_cloud_worker.py", "swarm_cloud_job.py"):
        if not (controller / leaf).is_file():
            raise ValueError("Select the existing original native controller host directory.")
    temporary_root = existing_directory(args.temporary_root)
    memory_root = existing_directory(args.memory_reservations_root)
    disk_root = existing_directory(args.disk_reservations_root)
    runtime_consumers_root = absolute(args.runtime_consumers_root)
    openssl_name, flock_name = shutil.which("openssl"), shutil.which("flock")
    if not openssl_name or not flock_name:
        raise ValueError("The receiving host needs its existing OpenSSL and util-linux flock.")
    openssl, flock = executable(openssl_name), executable(flock_name)
    node_version = observed_version([str(node), "--version"])
    if int(node_version.lstrip("v").split(".")[0]) < 20:
        raise ValueError("Select an existing Node runtime version 20 or newer.")
    # Check the installed module without starting Chromium or the provider.
    browser_binding = json.loads(observed_version([
        str(node), "--input-type=module", "-e",
        "import{createRequire}from'node:module';"
        "import{realpathSync,readFileSync,existsSync}from'node:fs';"
        "import{dirname,join}from'node:path';"
        "const m=await import(process.argv[1]);"
        "if(typeof m.chromium?.launchPersistentContext!=='function')process.exit(2);"
        "const r=createRequire(new URL(process.argv[1]));"
        "const entry=realpathSync(r.resolve('playwright-core'));let root=dirname(entry);"
        "for(;;){const p=join(root,'package.json');"
        "if(existsSync(p)&&JSON.parse(readFileSync(p,'utf8')).name==='playwright-core')break;"
        "const next=dirname(root);if(next===root)throw Error('playwright-core package root');root=next;}"
        "console.log(JSON.stringify({entry,root}));",
        playwright.as_uri()]))
    playwright_core = absolute(browser_binding["entry"])
    playwright_core_root = existing_directory(browser_binding["root"])
    runtime = {}
    for name, path in (("node", node), ("playwright", playwright),
                       ("playwright_core", playwright_core), ("chromium", chromium),
                       ("openssl", openssl), ("flock", flock),
                       ("controller", controller / "swarm_cloud_worker.py"),
                       ("controller_job", controller / "swarm_cloud_job.py")):
        runtime[name] = {"path": str(path), "sha256": file_digest(path)}
    records = root / "native-records"
    command = [str(node), str(repository / SOURCE_PREFIX / NATIVE_ENTRY),
               "--source-root", str(repository / SOURCE_PREFIX),
               "--source-identity-file", str(root / "native-source.json"),
               "--directory", str(root / "managed-state"),
               "--output", str(root / "output"),
               "--playwright", str(playwright), "--chromium", str(chromium),
               "--temporary-root", str(temporary_root)]
    argv = [sys.executable, "-B", str(controller / "swarm_cloud_worker.py"), "run",
            "b9d2-managed-pipelines", "--operation-id", OPERATION, "--project", str(root),
            "--worker-root", str(root / "worker"), "--temp-root", str(root / "worker" / "tmp"),
            "--records-root", str(records),
            "--memory-mib", "768", "--memory-reserve-mib", "256",
            "--memory-reclaim", "clean-cache", "--memory-storage", "included",
            "--memory-reservations-root", str(memory_root),
            "--disk-space", str(root) + "=16", "--disk-space", str(temporary_root) + "=128",
            "--disk-reserve-mib", "64", "--disk-reserve-inodes", "128",
            "--disk-reservations-root", str(disk_root),
            "--runtime-consumers-root", str(runtime_consumers_root),
            "--artifact-on-success", "output", "--retain-artifacts",
            "--report-format", "summary"]
    runtime_paths = list(dict.fromkeys(str(path) for path in
                         (node, playwright.parent, playwright_core_root, chromium.parent,
                          openssl, flock, controller)))
    for path in runtime_paths:
        argv.extend(["--runtime-path", path])
    argv.extend(["--"] + command)
    plan = {"schema": BINDING_SCHEMA, "operation_id": OPERATION,
            "directory": str(root), "repository": REPOSITORY, "source_commit": COMMIT,
            "source_carrier_git_blob": CARRIER_BLOB, "source_carrier_sha256": digest(data),
            "source_files": measured, "source_identity_sha256": digest(identity_bytes),
            "runtime": runtime, "runtime_paths": runtime_paths,
            "native_argv": argv, "records_root": str(records),
            "native_record": str(records / hashlib.sha256(OPERATION.encode()).hexdigest()),
            "temporary_root": str(temporary_root),
            "memory_reservations_root": str(memory_root), "disk_reservations_root": str(disk_root),
            "runtime_consumers_root": str(runtime_consumers_root),
            "versions": {"node": node_version, "openssl": observed_version([str(openssl), "version"]),
                         "flock": observed_version([str(flock), "--version"])},
            "declared_memory_mib": 768, "memory_reserve_mib": 256,
            "declared_persistent_growth_mib": 16, "declared_temporary_growth_mib": 128}
    immutable(root / PLAN_FILE, json_bytes(plan))
    verify_selection(plan)
    print(json.dumps({"state": "SOURCE_READY", "operation_id": OPERATION,
                      "source_files": len(measured), "native_record": plan["native_record"],
                      "plan": str(root / PLAN_FILE), "versions": plan["versions"]}), flush=True)
    return 0


def run(args):
    root = absolute(args.directory)
    plan = read_json(root / PLAN_FILE)
    if (plan.get("schema") != BINDING_SCHEMA or plan.get("operation_id") != OPERATION
            or absolute(plan["directory"]) != root):
        raise ValueError("The selected receiving directory differs.")
    if args.action != "status" and verify_selection(plan) != root:
        raise ValueError("The selected receiving directory differs.")
    # The existing controller owns record inspection, source custody, capacity,
    # process liveness, same-record continuation and retained artifacts.
    environment = dict(os.environ)
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    prefixes = list(dict.fromkeys(str(Path(plan["runtime"][name]["path"]).parent)
                                 for name in ("node", "openssl", "flock")))
    environment["PATH"] = os.pathsep.join(prefixes + [environment.get("PATH", "")])
    argv = plan["native_argv"]
    if args.action in ("status", "resume"):
        argv = [plan["native_argv"][0], "-B", plan["runtime"]["controller_job"]["path"],
                "status" if args.action == "status" else "resume-capacity",
                OPERATION, "--records-root", plan["records_root"], "--report-format", "summary"]
        if args.action == "resume":
            argv.append("--follow")
            if args.recover_failure:
                argv.extend(["--recover-failure", args.recover_failure])
    os.execve(argv[0], argv, environment)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    prep = actions.add_parser("prepare", help="receive exact source and bind the observed existing host")
    for name in ("directory", "source-carrier", "controller-host", "node", "playwright",
                 "chromium", "temporary-root", "memory-reservations-root", "disk-reservations-root",
                 "runtime-consumers-root"):
        prep.add_argument("--" + name, required=True)
    for action, help_text in (
            ("run", "enter the original controller or follow the same existing record"),
            ("status", "read the original native record"),
            ("resume", "resume the same pre-dispatch capacity record through its original controller")):
        command = actions.add_parser(action, help=help_text)
        command.add_argument("--directory", required=True)
        if action == "resume":
            command.add_argument("--recover-failure", help="exact original pre-dispatch failure SHA from status")
    args = parser.parse_args()
    try:
        return prepare(args) if args.action == "prepare" else run(args)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        print(json.dumps({"state": "RECEIVING_ERROR", "operation_id": OPERATION,
                          "error": type(exc).__name__, "message": str(exc)}), file=sys.stderr, flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
