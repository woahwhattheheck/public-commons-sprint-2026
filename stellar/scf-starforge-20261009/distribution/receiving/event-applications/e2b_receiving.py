#!/usr/bin/env python3
"""Bind the complete retained event Applications case to an existing E2B worker.

This receiver verifies source inputs and invokes the original native controller.
The original event Applications driver remains the product operation.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import tempfile
import zipfile

OP = "SCF-EVENT-FEED-APPLICATIONS-20261012-F3BE"
SCHEMA = "stellar-forge.event-applications-e2b.v1"
CASE_PREFIX = "SCF-Event-Applications-Receiving"
CASE_SHA = "7c6c31f3b639cb6abe8397d60271102f86912c32911dcbd5c7b61a945b2605c2"
CASE_BYTES = 9027235
CASE_MANIFEST_SHA = "a75ac47df1cb961efd6ce8fb27e80e4ba8f01fd13bf6cf7d1b34d2b28b2536df"
COMPONENT_REF = "e28755f20dd4f9cb932d82fb59feb48424e327e7"
CONTROLLER_REF = "b21ff9e2bcf9e64bbdac87590d1b030afc9afe70"
CONTROLLER_FILES = [
  {
    "path": "CLOUD_DISK_ADMISSION.md",
    "gitBlob": "657f6b4cf1adee5fafb18b76f9393db97199e2e2",
    "mode": "100644"
  },
  {
    "path": "WORKER_CAPACITY.md",
    "gitBlob": "5d4c8750dc79347a5f2ea2c009cba71d0d52339a",
    "mode": "100644"
  },
  {
    "path": "capacity_fairness.py",
    "gitBlob": "3af54bf8637d76646a52e9bbc148814f96403505",
    "mode": "100644"
  },
  {
    "path": "capacity_recovery.py",
    "gitBlob": "c789218ee10a8152b2f37513f1773fc1873aaf18",
    "mode": "100644"
  },
  {
    "path": "cloud_disk.py",
    "gitBlob": "d490841b6966fe7a6a271b4e9623f5571a9196bf",
    "mode": "100644"
  },
  {
    "path": "cloud_memory.py",
    "gitBlob": "4856385be41da59d5010b2773ba762e1fa91036f",
    "mode": "100644"
  },
  {
    "path": "cloud_residency.py",
    "gitBlob": "60b28a472ae21d247566fe414ee115e0578598f7",
    "mode": "100644"
  },
  {
    "path": "cloud_source_command.py",
    "gitBlob": "4174da15f430c9d7384c3259e152e7bbac20d4bd",
    "mode": "100644"
  },
  {
    "path": "connected_github_source.py",
    "gitBlob": "f91cf38a590d591a0a904f463c2794bbbd0d4a19",
    "mode": "100755"
  },
  {
    "path": "connected_github_source_links.py",
    "gitBlob": "101ca1fb2e0f845f4625e854be614b6e3c549237",
    "mode": "100644"
  },
  {
    "path": "connected_github_source_reuse.py",
    "gitBlob": "7f0bd6b07f44b2923470249b0fa017df3e9f33ff",
    "mode": "100644"
  },
  {
    "path": "native_artifact_checkpoints.py",
    "gitBlob": "6234a05effb3fc69776c889fa00529b5a8936abd",
    "mode": "100644"
  },
  {
    "path": "native_artifact_retention.py",
    "gitBlob": "718a4e314390df666329f4f10dc260fa58757bcd",
    "mode": "100644"
  },
  {
    "path": "native_artifact_selection.py",
    "gitBlob": "318eb38b9c4b6323e53e4e4a8dd227b8fdd0fee5",
    "mode": "100644"
  },
  {
    "path": "native_capacity.py",
    "gitBlob": "e24bbe026a25ef38822dd5ff73b112879a7404eb",
    "mode": "100644"
  },
  {
    "path": "native_completion.py",
    "gitBlob": "835b72f255bcd1f5b1ff649a9be5f5ff31aa6c99",
    "mode": "100644"
  },
  {
    "path": "native_foreground.py",
    "gitBlob": "afb28c62e1635ab329c8c611f90184eeae03398f",
    "mode": "100644"
  },
  {
    "path": "native_handoff_capacity.py",
    "gitBlob": "1117b8ec2671fe4b4d6be5dc594472a354f04a48",
    "mode": "100644"
  },
  {
    "path": "native_reservation.py",
    "gitBlob": "5a3eb43c035827d951998a60683e9b371f5c2041",
    "mode": "100644"
  },
  {
    "path": "native_result_view.py",
    "gitBlob": "b9a52b40e2a32da20f1ff3fd704acfd73f375177",
    "mode": "100644"
  },
  {
    "path": "native_runtime_handoff.py",
    "gitBlob": "16373eb1e3160352ade64042ebae5e9c679fc4cb",
    "mode": "100644"
  },
  {
    "path": "node_dependency_borrow.py",
    "gitBlob": "2830b041ffc1d9612ad5c21b313cb9a2bbd186a1",
    "mode": "100644"
  },
  {
    "path": "node_dependency_materialize.py",
    "gitBlob": "29601b7a1b49887b9a9e2ee2a1211217a818a972",
    "mode": "100644"
  },
  {
    "path": "node_lockfile_cache.py",
    "gitBlob": "661566492bb0ae8e44b40b349187c3036b23451e",
    "mode": "100644"
  },
  {
    "path": "node_package_cache.py",
    "gitBlob": "20b224d96f453de5b7de71c2cb386a3871005a9e",
    "mode": "100644"
  },
  {
    "path": "offload_build.py",
    "gitBlob": "7ae4b9b51858b8e47c6e5655fd7083cec529ff72",
    "mode": "100644"
  },
  {
    "path": "run_bounded.py",
    "gitBlob": "05819dc9379cfc2a12c3db2378a5cc2b625ca85b",
    "mode": "100644"
  },
  {
    "path": "runtime_catalog.py",
    "gitBlob": "dd9b963c1a10d1db2b79d0df4db6766c2a06034f",
    "mode": "100644"
  },
  {
    "path": "runtime_consumers.py",
    "gitBlob": "6dc59325617ee88728fcad276d25d2abf6301a95",
    "mode": "100644"
  },
  {
    "path": "runtime_declarations.py",
    "gitBlob": "718c2f35821f0fac28c0d9c661a1d441b834baba",
    "mode": "100644"
  },
  {
    "path": "runtime_source.py",
    "gitBlob": "2f499158af7971304843bb58bd2136fc4540d9c3",
    "mode": "100644"
  },
  {
    "path": "swarm_cloud_browser.py",
    "gitBlob": "327494cd43a8bd6790a6a93f960e4ac3c0261cbb",
    "mode": "100755"
  },
  {
    "path": "swarm_cloud_cache.py",
    "gitBlob": "5f8639c9c66c35f73e801b828d2b8f7337371b2f",
    "mode": "100644"
  },
  {
    "path": "swarm_cloud_dependencies.py",
    "gitBlob": "ef74a49ea5af4ad8d64a324adb3e4f4a94d12092",
    "mode": "100755"
  },
  {
    "path": "swarm_cloud_job.py",
    "gitBlob": "8576af459469483d3159df2ce35076416d9d9e30",
    "mode": "100644"
  },
  {
    "path": "swarm_cloud_worker.py",
    "gitBlob": "dcc991d9051a6a985253a6a91c108d402b0768e2",
    "mode": "100644"
  },
  {
    "path": "worker_capacity.py",
    "gitBlob": "f008574700d116786aa4558d19dc96a93680ce0b",
    "mode": "100644"
  },
  {
    "path": "worker_storage.py",
    "gitBlob": "fbf5bbd03cc9eba88c385d7726fb1e5ddaa11238",
    "mode": "100644"
  }
]


def require(value, message):
    if not value:
        raise ValueError(message)


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def local_name(value):
    require(isinstance(value, str) and value and "\\" not in value and "\0" not in value,
            "Invalid source member name")
    path = PurePosixPath(value)
    require(not path.is_absolute() and all(part not in ("", ".", "..") for part in value.split("/")),
            "Source member must remain below its selected root")
    return path


def private_directory(path):
    path = Path(path).expanduser().absolute()
    require(path.resolve() == path, "Private operation directories must have real parents")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o077,
            "Keep the receiving operation in its existing private directory")
    return path


def regular_file(path):
    path = Path(path).expanduser().absolute()
    require(path.resolve() == path, "Source inputs must have real paths")
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode), "A complete regular source file is required")
    return path


def stable_write(root, name, body, mode=0o600):
    name = local_name(name)
    root = private_directory(root)
    parent = root
    for part in name.parts[:-1]:
        parent = private_directory(parent / part)
    target = parent / name.name
    temporary = None
    try:
        if target.exists() or target.is_symlink():
            fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, "rb") as saved:
                info = os.fstat(saved.fileno())
                require(stat.S_ISREG(info.st_mode) and info.st_size == len(body)
                        and saved.read(len(body) + 1) == body,
                        "The retained source or host selection differs: " + str(name))
            require(target.stat().st_mode & 0o777 == mode, "The retained source mode differs: " + str(name))
            return target
        fd, temporary = tempfile.mkstemp(prefix="." + name.name + "-", dir=parent)
        with os.fdopen(fd, "wb") as output:
            os.fchmod(output.fileno(), mode)
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, target, follow_symlinks=False)
        except FileExistsError:
            fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, "rb") as saved:
                require(saved.read(len(body) + 1) == body, "Concurrent source selection differs")
            require(target.stat().st_mode & 0o777 == mode, "Concurrent source mode differs")
        directory = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        return target
    finally:
        if temporary is not None:
            os.unlink(temporary)


@contextmanager
def source_archive(path, expected_sha, expected_bytes=None):
    path = regular_file(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode), "Source archive is not a regular file")
        if expected_bytes is not None:
            require(before.st_size == expected_bytes, "Source archive byte count differs")
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
        require(digest.hexdigest() == expected_sha, "Source archive hash differs")
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive:
            yield archive
        after = os.fstat(stream.fileno())
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                "Source archive changed during receiving")


def members(archive, prefix=""):
    found = {}
    for info in archive.infolist():
        require(not info.is_dir(), "The original source carrier uses regular file members")
        path = local_name(info.filename)
        name = str(path)
        if prefix:
            require(name.startswith(prefix + "/"), "Source member has another package root")
            name = name[len(prefix) + 1:]
            local_name(name)
        require(name not in found, "Duplicate source member")
        file_type = stat.S_IFMT(info.external_attr >> 16)
        require(file_type in (0, stat.S_IFREG), "Source members cannot be links or special files")
        require(info.file_size <= 64 * 1024 * 1024, "Source member is larger than the original case")
        found[name] = info
    require(len(found) <= 1024 and sum(info.file_size for info in found.values()) <= 96 * 1024 * 1024,
            "Source carrier exceeds the original receiving footprint")
    return found


def verified_body(archive, info, entry):
    require(info.file_size == entry["bytes"], "Source member byte count differs: " + entry["path"])
    body = archive.read(info)
    require(len(body) == entry["bytes"] and sha256(body) == entry["sha256"],
            "Source member hash differs: " + entry["path"])
    return body


def receive_case(archive_path, destination):
    with source_archive(archive_path, CASE_SHA, CASE_BYTES) as archive:
        found = members(archive, CASE_PREFIX)
        require("case-manifest.json" in found, "The complete original case manifest is required")
        raw = archive.read(found["case-manifest.json"])
        require(sha256(raw) == CASE_MANIFEST_SHA, "Original case manifest differs")
        manifest = json.loads(raw)
        require(manifest.get("schema") == "stellar-forge.event-applications-portable.v1"
                and manifest.get("operation") == OP and manifest.get("sourceCommit") == COMPONENT_REF,
                "Original event Applications case identity differs")
        entries = manifest["files"]
        names = [item["path"] for item in entries]
        require(len(names) == len(set(names)) and set(found) == set(names) | {"case-manifest.json"},
                "The complete original case members are required")
        for entry in entries:
            local_name(entry["path"])
            verified_body(archive, found[entry["path"]], entry)
        for entry in entries:
            # Private parents retain the original internal snapshot and source.
            mode = (found[entry["path"]].external_attr >> 16) & 0o777
            stable_write(destination, entry["path"],
                         verified_body(archive, found[entry["path"]], entry), mode or 0o600)
        stable_write(destination, "case-manifest.json", raw)
        return manifest


def receive_controller(archive_path, expected_sha, destination):
    with source_archive(archive_path, expected_sha) as archive:
        found = members(archive)
        require("SOURCE_MANIFEST.json" in found, "The original native source manifest is required")
        raw = archive.read(found["SOURCE_MANIFEST.json"])
        manifest = json.loads(raw)
        require(manifest.get("schema") == "commons.runtime-source-package/v1",
                "Use the original runtime_source.package_sources carrier")
        entries = manifest["files"]
        selected = {item["path"]: item for item in entries}
        expected = {item["path"]: item for item in CONTROLLER_FILES}
        require(len(selected) == len(entries) and set(selected) == set(expected)
                and set(found) == set(expected) | {"SOURCE_MANIFEST.json"},
                "The complete selected native controller closure is required")
        for name, entry in selected.items():
            body = verified_body(archive, found[name], entry)
            blob = hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest()
            require(blob == expected[name]["gitBlob"]
                    and entry["mode"] == int(expected[name]["mode"][-3:], 8),
                    "The selected merged native controller differs: " + name)
        for name, entry in selected.items():
            stable_write(destination, name, verified_body(archive, found[name], entry), entry["mode"])
        stable_write(destination, "SOURCE_MANIFEST.json", raw)
        return sha256(raw)


def installed_executable(value):
    path = Path(value).expanduser().resolve(strict=True)
    require(path.is_file() and os.access(path, os.X_OK), "Select an installed executable: " + str(path))
    return str(path)


def existing_directory(value):
    path = Path(value).expanduser().resolve(strict=True)
    require(path.is_dir(), "Use the existing worker's shared directory: " + str(path))
    return str(path)


def prepare(args):
    root = private_directory(args.root)
    lock_fd = os.open(root / ".event-applications-setup.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        case = root / "case"
        host = root / "controller" / "host"
        manifest = receive_case(args.case_archive, case)
        controller_manifest_sha = receive_controller(args.controller_archive, args.controller_sha256, host)
        sys.path.insert(0, str(host))
        from native_foreground import load_native
        from native_runtime_handoff import runtime_identity
        identity = runtime_identity(load_native(host))
        playwright = regular_file(Path(args.playwright).expanduser().resolve(strict=True))
        roots = {key: existing_directory(getattr(args, key)) for key in
                 ("memory_reservations_root", "disk_reservations_root", "state_root")}
        require(all(Path(value) != root and root not in Path(value).parents for value in roots.values()),
                "Keep the existing worker-wide reservation/state roots outside this private operation")
        selection = {
            "schema": SCHEMA, "operation_id": OP, "directory": str(root),
            "component_ref": COMPONENT_REF, "controller_ref": CONTROLLER_REF,
            "case_root": str(case), "case_archive_sha256": CASE_SHA,
            "case_manifest_sha256": CASE_MANIFEST_SHA,
            "controller_host": str(host), "controller_archive_sha256": args.controller_sha256,
            "controller_source_manifest_sha256": controller_manifest_sha,
            "controller_runtime_sha256": identity["sha256"],
            "records_root": str(root / "records"), "workspace": str(root / "receiving"),
            "node": installed_executable(args.node),
            "python": installed_executable(args.python),
            "terminal_python": installed_executable(args.terminal_python or args.python),
            "playwright": str(playwright), "chromium": installed_executable(args.chromium),
            "cloud_record_id": manifest["cloudRecordId"],
            "cloud_request_sha256": manifest["cloudRequestSha256"], **roots,
        }
        if args.buyer_port is not None:
            require(1 <= args.buyer_port <= 65535, "Buyer port must remain in 1..65535")
            selection["buyer_port"] = args.buyer_port
        path = stable_write(root, "host-selection.json", canonical(selection))
        print(json.dumps({"operation_id": OP, "phase": "prepared", "selection": str(path),
                          "selection_sha256": sha256(path.read_bytes()),
                          "native_record": str(Path(selection["records_root"]) / hashlib.sha256(OP.encode()).hexdigest()),
                          "controller_runtime_sha256": identity["sha256"]}, sort_keys=True))
    finally:
        os.close(lock_fd)


def selected(path):
    path = regular_file(path)
    raw = path.read_bytes()
    value = json.loads(raw)
    require(value.get("schema") == SCHEMA and value.get("operation_id") == OP
            and value.get("component_ref") == COMPONENT_REF and value.get("controller_ref") == CONTROLLER_REF,
            "The original prepared operation is required")
    root = private_directory(value["directory"])
    require(path == root / "host-selection.json"
            and Path(value["case_root"]) == root / "case"
            and Path(value["workspace"]) == root / "receiving"
            and Path(value["controller_host"]) == root / "controller" / "host"
            and Path(value["records_root"]) == root / "records",
            "The original private receiving paths changed")
    manifest_raw = regular_file(root / "case" / "case-manifest.json").read_bytes()
    require(value["case_archive_sha256"] == CASE_SHA
            and value["case_manifest_sha256"] == CASE_MANIFEST_SHA
            and sha256(manifest_raw) == CASE_MANIFEST_SHA,
            "The retained original case differs")
    manifest = json.loads(manifest_raw)
    launchers = [item for item in manifest["files"] if item["path"] == "run-receiving.py"]
    require(len(launchers) == 1, "The original receiving launcher is required")
    launcher = regular_file(root / "case" / "run-receiving.py").read_bytes()
    require(len(launcher) == launchers[0]["bytes"]
            and sha256(launcher) == launchers[0]["sha256"],
            "The retained receiving launcher changed")
    # This exact original launcher verifies every manifest member before the
    # first workspace write or product process, including all native inputs.
    host = Path(value["controller_host"])
    require(sha256((host / "SOURCE_MANIFEST.json").read_bytes()) == value["controller_source_manifest_sha256"],
            "The retained controller manifest differs")
    sys.path.insert(0, str(host))
    from native_foreground import load_native
    from native_runtime_handoff import runtime_identity
    require(runtime_identity(load_native(host))["sha256"] == value["controller_runtime_sha256"],
            "The selected original native runtime changed")
    for key in ("memory_reservations_root", "disk_reservations_root", "state_root"):
        require(existing_directory(value[key]) == value[key], "The selected shared directory changed")
    for key in ("node", "python", "terminal_python", "chromium"):
        require(installed_executable(value[key]) == value[key], "The selected executable changed")
    require(regular_file(value["playwright"]).is_file(), "The selected Playwright module changed")
    return value, sha256(raw)


def run(args):
    value, selection_sha = selected(args.selection)
    root = Path(value["directory"])
    host = Path(value["controller_host"])
    case = Path(value["case_root"])
    command = [
        value["python"], "-B", str(host / "swarm_cloud_job.py"), "run",
        "f3be-event-applications-receiving", "--operation-id", OP,
        "--project", str(root), "--worker-root", str(root / "worker"),
        "--temp-root", str(root / "temporary"), "--records-root", value["records_root"],
        "--memory-mib", "768", "--memory-reserve-mib", "256",
        "--memory-storage", "included", "--memory-reclaim", "clean-cache",
        "--memory-reservations-root", value["memory_reservations_root"],
        "--disk-space", str(root) + "=160", "--disk-inodes", str(root) + "=10000",
        "--disk-reserve-mib", "64", "--disk-reserve-inodes", "128",
        "--disk-reservations-root", value["disk_reservations_root"],
    ]
    for path in (case, host, Path(__file__).resolve(), Path(value["node"]),
                 Path(value["python"]), Path(value["terminal_python"]),
                 Path(value["chromium"]).parent, Path(value["playwright"]).parent):
        command += ["--runtime-path", str(path)]
    command += [
        "--artifact-on-success", "receiving/result.json",
        "--artifact-on-success", "receiving/receiving-summary.json",
        "--report-format", "summary", "--",
        value["python"], "-B", str(case / "run-receiving.py"),
        "--workspace", value["workspace"], "--node", value["node"],
        "--python", value["python"], "--terminal-python", value["terminal_python"],
        "--playwright", value["playwright"], "--chromium", value["chromium"],
    ]
    if "buyer_port" in value:
        command += ["--buyer-port", str(value["buyer_port"])]
    environment = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", SWARM_STATE_ROOT=value["state_root"])
    environment["PATH"] = str(Path(value["node"]).parent) + os.pathsep + environment.get("PATH", "")
    environment["SWARM_NODE24_BIN"] = str(Path(value["node"]).parent)
    print(json.dumps({"operation_id": OP, "phase": "original-native-launch",
                      "selection_sha256": selection_sha, "component_ref": COMPONENT_REF,
                      "controller_ref": CONTROLLER_REF}, sort_keys=True), flush=True)
    os.chdir(root)
    os.execvpe(command[0], command, environment)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)
    prepare_parser = subs.add_parser("prepare")
    prepare_parser.add_argument("--root", required=True, type=Path)
    prepare_parser.add_argument("--case-archive", required=True, type=Path)
    prepare_parser.add_argument("--controller-archive", required=True, type=Path)
    prepare_parser.add_argument("--controller-sha256", required=True)
    prepare_parser.add_argument("--node", required=True)
    prepare_parser.add_argument("--python", required=True)
    prepare_parser.add_argument("--terminal-python")
    prepare_parser.add_argument("--playwright", required=True)
    prepare_parser.add_argument("--chromium", required=True)
    prepare_parser.add_argument("--memory-reservations-root", required=True)
    prepare_parser.add_argument("--disk-reservations-root", required=True)
    prepare_parser.add_argument("--state-root", required=True)
    prepare_parser.add_argument("--buyer-port", type=int)
    run_parser = subs.add_parser("run")
    run_parser.add_argument("--selection", required=True, type=Path)
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args)
    else:
        run(args)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        print(json.dumps({"operation_id": OP, "phase": "receiving-selection",
                          "error": str(error)}, sort_keys=True), file=sys.stderr)
        raise SystemExit(2)
