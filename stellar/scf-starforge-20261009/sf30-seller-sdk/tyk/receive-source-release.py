#!/usr/bin/env python3
"""Receive the exact Tyk source, build its selected release, and continue native receiving."""
from __future__ import annotations
import argparse
import base64
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import uuid
import zipfile

SCHEMA = "commons.tyk-build-source.v1"
RESULT_SCHEMA = "commons.tyk-build-receiving.v1"
DISTRIBUTION = "stellar/scf-starforge-20261009/distribution"
NATIVE = "stellar/scf-starforge-20261009/sf30-seller-sdk/tyk"
OPERATION = "TYK-API-MIGRATION-ROLLOUT-D76C-20261012"


def need(value, message):
    if not value:
        raise ValueError(message)


def data(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def identity(path):
    with path.open("rb") as stream:
        value = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"bytes": path.stat().st_size, "sha256": value}


def directory(path):
    path = Path(path).absolute()
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and path.resolve() == path,
         "Use a canonical owned receiving directory")
    need(not info.st_mode & 0o077, "The receiving directory must be private")
    return path


def immutable(path, content, mode=0o600):
    if path.exists() or path.is_symlink():
        info = path.lstat()
        need(stat.S_ISREG(info.st_mode) and not path.is_symlink() and
             path.read_bytes() == content, "Preserve original receiving bytes: " + str(path))
        return
    temporary = path.with_name(path.name + ".pending-" + uuid.uuid4().hex)
    try:
        with temporary.open("xb") as stream:
            stream.write(content)
            stream.flush()
            os.fchmod(stream.fileno(), mode)
            os.fsync(stream.fileno())
        os.link(temporary, path, follow_symlinks=False)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        temporary.unlink(missing_ok=True)


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    need(spec is not None and spec.loader is not None, "Original Python source is required")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def run(command, log, phase):
    print(json.dumps({"phase": phase, "log": str(log)}), flush=True)
    with log.open("ab") as output:
        output.write(data({"phase": phase}))
        output.flush()
        result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, check=False)
        output.flush()
        os.fsync(output.fileno())
    need(result.returncode == 0, phase + " exited " + str(result.returncode) +
         "; continue the same operation using " + str(log))


def source_archive(root, source_root, entries):
    archive = root / "tyk-complete-source.zip"
    temporary = archive.with_name(archive.name + ".pending-" + uuid.uuid4().hex)
    try:
        with zipfile.ZipFile(temporary, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as target:
            for item in sorted(entries, key=lambda value: value["path"]):
                path = source_root / item["path"]
                info = path.lstat()
                need(stat.S_ISREG(info.st_mode) and not path.is_symlink(), "Original source must remain regular")
                entry = zipfile.ZipInfo(item["path"], date_time=(1980, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.create_system = 3
                entry.external_attr = (stat.S_IFREG | int(item["mode"], 8) & 0o777) << 16
                digest = hashlib.sha256()
                count = 0
                with path.open("rb") as source, target.open(entry, "w") as output:
                    for block in iter(lambda: source.read(256 * 1024), b""):
                        count += len(block)
                        digest.update(block)
                        output.write(block)
                need(count == item["bytes"] and digest.hexdigest() == item["sha256"],
                     "Materialized source changed: " + item["path"])
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        if archive.exists() or archive.is_symlink():
            need(archive.is_file() and not archive.is_symlink() and
                 identity(archive) == identity(temporary), "Keep the original complete source archive")
        else:
            os.link(temporary, archive, follow_symlinks=False)
        return archive
    finally:
        temporary.unlink(missing_ok=True)


def receive(args):
    os.umask(0o077)
    root = directory(args.directory)
    lock = os.open(root / "receiving.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return receive_locked(args, root)
    finally:
        os.close(lock)


def receive_locked(args, root):
    packet_path = Path(args.packet).absolute()
    info = packet_path.lstat()
    need(stat.S_ISREG(info.st_mode) and not packet_path.is_symlink() and info.st_size <= 32 * 1024 * 1024,
         "Supply the complete retained source packet")
    packet_bytes = packet_path.read_bytes()
    packet = json.loads(packet_bytes)
    need(packet.get("schema") == SCHEMA and packet.get("operation") == OPERATION,
         "Keep the original Tyk source and company operation")
    original = packet["source"]
    need(original["repository"] == "woahwhattheheck/tjlabs-stellar-merchant-workspace",
         "Use the maintained Tyk merchant source repository")
    entries = packet["files"]
    need(isinstance(entries, list) and entries, "Complete original source members required")
    by_path = {item["path"]: item for item in entries}
    need(len(by_path) == len(entries), "Duplicate source member")
    tree = packet["tree"]
    need(tree.get("truncated") is False and tree.get("sha") == original["tree"],
         "Complete original tree required")
    by_tree = {item["path"]: item for item in tree["tree"]}
    total = 0
    decoded = {}
    for path, item in by_path.items():
        parts = path.split("/")
        need(path and not path.startswith("/") and "\\" not in path and
             all(part and part not in (".", "..") for part in parts) and
             not any(ord(char) < 32 or ord(char) == 127 for char in path), "Invalid original source path")
        need(item["encoding"] == "base64" and item["mode"] in ("100644", "100755"), "Regular source required")
        content = base64.b64decode(item["content"], validate=True)
        total += len(content)
        need(len(content) == item["bytes"] and len(content) <= 2 * 1024 * 1024 and
             total <= 128 * 1024 * 1024, "Original source size mismatch")
        need(hashlib.sha256(content).hexdigest() == item["sha256"], "Original source digest mismatch: " + path)
        blob = hashlib.sha1(b"blob " + str(len(content)).encode("ascii") + b"\0" + content).hexdigest()
        native = by_tree.get(path)
        need(native and native["type"] == "blob" and native["sha"] == blob == item["gitBlob"] and
             native["mode"] == item["mode"] and native["size"] == len(content), "Original Git source mismatch: " + path)
        decoded[path] = content
    for path in ("LICENSE", DISTRIBUTION + "/git-object-receiving.py", DISTRIBUTION + "/build.mjs",
                 DISTRIBUTION + "/runtime-unpack.py", DISTRIBUTION + "/selections/tyk-merchant.json",
                 NATIVE + "/gateway-native-host.py", NATIVE + "/native-journey.mjs"):
        need(path in decoded, "Complete source packet is missing " + path)
    binding = {"schema": RESULT_SCHEMA, "operation": OPERATION, "source": original,
               "packetSha256": hashlib.sha256(packet_bytes).hexdigest()}
    immutable(root / "operation.json", data(binding))
    toolkit = directory(root / "toolkit")
    receiver_path = toolkit / "git-object-receiving.py"
    immutable(receiver_path, decoded[DISTRIBUTION + "/git-object-receiving.py"], 0o700)
    receiver = module(receiver_path, "tyk_original_git_receiver")
    commit_text = receiver.github_commit_text(packet["commit"], original)
    metadata = {"schema": receiver.SCHEMA, "source": original, "commitText": commit_text,
                "tree": tree, "requiredPaths": sorted(by_path)}
    receiver.validate_metadata(metadata)
    metadata_path = root / "source-metadata.json"
    immutable(metadata_path, data(metadata))
    incoming = directory(root / "incoming")
    for item in entries:
        immutable(incoming / (item["gitBlob"] + ".blob"), decoded[item["path"]])
    decoded.clear()
    cache = root / "source-cache"
    source_root = root / "source"
    run([sys.executable, str(receiver_path), "--metadata", str(metadata_path),
         "--commit", original["commit"], "--directory", str(cache),
         "--incoming", str(incoming), "--materialize", str(source_root)],
        root / "source-receiving.log", "receive-original-git-source")
    # The maintained receiver has now retained every exact object in its cache.
    # These operation-owned incoming copies are reproducible from that cache.
    for item in entries:
        (incoming / (item["gitBlob"] + ".blob")).unlink(missing_ok=True)
    node = args.node or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
    need(node, "Use the existing Node24 runtime")
    release_root = root / "release"
    command = [node, str(source_root / DISTRIBUTION / "build.mjs"),
               "--repo", str(cache / "repository.git"), "--ref", original["commit"],
               "--selection", "tyk-merchant", "--out", str(release_root), "--offline"]
    if release_root.exists():
        command.append("--resume")
    run(command, root / "release-build.log", "build-original-selected-release")
    receipt_path = release_root / "distribution.json"
    receipt = json.loads(receipt_path.read_bytes())
    release_archive = Path(receipt["archive"])
    need(receipt["status"] == "PACKAGED" and receipt["sourceCommit"] == original["commit"] and
         release_archive.parent == release_root, "Original selected release receipt differs")
    inspector = module(source_root / DISTRIBUTION / "runtime-unpack.py", "tyk_original_runtime_unpack")
    manifest, _, verified, manifest_sha = inspector.inspect(release_archive, receipt["sha256"])
    need(manifest["sourceCommit"] == original["commit"] and
         manifest.get("sourceSelection", {}).get("id") == "tyk-merchant", "Selected release identity differs")
    del verified
    source_zip = source_archive(root, source_root, entries)
    source_manifest = {"schema": "commons.tyk-source-release.v1",
                       "repository": original["repository"], "source_commit": original["commit"],
                       "files": [{"path": item["path"], "bytes": item["bytes"], "sha256": item["sha256"]}
                                 for item in sorted(entries, key=lambda value: value["path"])],
                       "archive": {**identity(source_zip), "prefix": ""}}
    source_manifest_path = root / "tyk-source-release.json"
    immutable(source_manifest_path, data(source_manifest))
    result = {**binding, "status": "SOURCE_AND_RELEASE_RECEIVED",
              "sourceDirectory": str(source_root), "gitRepository": str(cache / "repository.git"),
              "sourceArchive": {"path": str(source_zip), **identity(source_zip)},
              "sourceManifest": {"path": str(source_manifest_path), **identity(source_manifest_path)},
              "selectedRelease": {"path": str(release_archive), **identity(release_archive),
                                  "receipt": {"path": str(receipt_path), **identity(receipt_path)},
                                  "manifestSha256": manifest_sha, "sourceFiles": len(manifest["files"]),
                                  "sourceSelection": manifest["sourceSelection"]}}
    immutable(root / "source-release-result.json", data(result))
    if args.native_directory:
        command = [sys.executable, str(source_root / NATIVE / "gateway-native-host.py"),
                   "--source-root", str(source_root), "--source-revision", original["commit"],
                   "--directory", str(Path(args.native_directory).absolute()), "--operation", OPERATION,
                   "--node", node, "--native-cpus", str(args.native_cpus)]
        for option, value in (("--redis-server", args.redis_server), ("--playwright-module", args.playwright_module),
                              ("--chromium", args.chromium), ("--dashboard-config", args.dashboard_config),
                              ("--return-directory", args.return_directory)):
            if value:
                command.extend([option, value])
        run(command, root / "native-receiving.log", "continue-original-native-tyk-operation")
        native_root = Path(args.native_directory).absolute()
        native_receiving = json.loads((native_root / "delivery.json").read_bytes())
        scope = native_receiving["scope"]
        need(native_receiving["state"] == "PASSED" and scope in ("gateway", "all") and
             native_receiving["operation"] == OPERATION and
             native_receiving["sourceRevision"] == original["commit"], "Original native receiving differs")
        journey_path = native_root / "journey/journey.json"
        journey_identity = identity(journey_path)
        state_file = native_receiving["nativeResult"]["stateFile"]
        need(journey_identity == {key: state_file[key] for key in ("bytes", "sha256")},
             "Keep the original completed native journey")
        journey = json.loads(journey_path.read_bytes())
        step_name = ("gateway-complete-native-history-export-and-cold-receiving" if scope == "gateway"
                     else "complete-commissioning-history-export-and-cold-receiving")
        if journey.get("summary", {}).get("gatewayCommissioning"):
            step_name = "complete-gateway-cohort-history-export-and-cold-receiving"
        step = journey["steps"][step_name]
        need(journey["operation"] == OPERATION and journey["state"] == "PASSED" and
             journey["scope"] == scope and step["completedAt"], "Original workspace receiving is incomplete")
        later = step["value"]["laterDownload"]
        workspace_path = Path(later["path"])
        need(workspace_path.is_file() and not workspace_path.is_symlink() and
             workspace_path.resolve().is_relative_to(native_root / "journey/downloads") and
             identity(workspace_path) == {key: later[key] for key in ("bytes", "sha256")},
             "The original later native workspace export differs")
        complete = native_receiving["completeReceiving"]
        need(identity(Path(complete["path"])) == {key: complete[key] for key in ("bytes", "sha256")},
             "The original complete native receiving archive differs")
        result["nativeReceiving"] = native_receiving
        result["nativeWorkspace"] = {
            "path": str(workspace_path), **identity(workspace_path), "scope": scope,
            "exportReference": step["value"]["second"], "receivingReference": step["value"]["laterReceiving"],
            "journey": {"path": str(journey_path), **journey_identity, "step": step_name}}
        result["status"] = "SOURCE_RELEASE_AND_NATIVE_RECEIVED"
        immutable(root / ("native-receiving-" + scope + ".json"), data(result))
    print(json.dumps(result, separators=(",", ":")), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--node")
    parser.add_argument("--native-directory")
    parser.add_argument("--redis-server")
    parser.add_argument("--playwright-module")
    parser.add_argument("--chromium")
    parser.add_argument("--dashboard-config")
    parser.add_argument("--return-directory")
    parser.add_argument("--native-cpus", type=int, choices=range(1, 9), default=2)
    args = parser.parse_args()
    need(not any((args.redis_server, args.playwright_module, args.chromium, args.dashboard_config,
                  args.return_directory)) or args.native_directory,
         "Native target/runtime options require the original native directory")
    receive(args)


if __name__ == "__main__":
    main()
