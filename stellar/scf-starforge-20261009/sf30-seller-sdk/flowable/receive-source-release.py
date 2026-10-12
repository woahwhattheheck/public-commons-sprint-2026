#!/usr/bin/env python3
"""Receive the exact Flowable source, build its selected release, and continue native receiving."""
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

SCHEMA = "commons.flowable-build-source.v1"
RESULT_SCHEMA = "commons.flowable-build-receiving.v1"
DISTRIBUTION = "stellar/scf-starforge-20261009/distribution"
NATIVE = "stellar/scf-starforge-20261009/sf30-seller-sdk/flowable"
OPERATION = "FLOWABLE-PROCESS-OPERATIONS-D76C-20261012"


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


def run_json(command, log, phase):
    print(json.dumps({"phase": phase, "log": str(log)}), flush=True)
    with log.open("ab") as output:
        output.write(data({"phase": phase}))
        output.flush()
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=output, check=False)
        output.write(result.stdout)
        output.flush()
        os.fsync(output.fileno())
    need(result.returncode == 0, phase + " exited " + str(result.returncode) +
         "; continue the original operation using " + str(log))
    value = json.loads(result.stdout)
    need(isinstance(value, dict), "The original runtime command must return its complete result")
    return value



def inspect_runtime_preparation(root, source_root, node, target):
    # The original inspector first reads the complete plan/profile/state. A
    # PREPARED or interrupted INSTALLING/FAILED report is a readable installation,
    # even when its dependencies are not ready. Only structural preparation
    # failures select the maintained recover path below.
    inspector = source_root / DISTRIBUTION / "runtime-install.mjs"
    code = """
const { inspectRuntimeInstall } = await import(process.argv[1]);
const incomplete = new Set([
  'ENOENT', 'ENOTDIR', 'RUNTIME_REGULAR_FILE_REQUIRED',
  'RUNTIME_INSTALL_PLAN_INVALID', 'RUNTIME_PROFILE_CHANGED',
  'RUNTIME_INSTALL_IDENTITY_CHANGED', 'RUNTIME_PACKAGE_PLAN_CHANGED',
  'RUNTIME_SOURCE_MANIFEST_CHANGED', 'RUNTIME_INSTALL_STATE_INVALID',
  'RUNTIME_SOURCE_DECLARATIONS_CHANGED'
]);
try {
  const result = await inspectRuntimeInstall({
    directory: process.argv[2], load: false, source: false
  });
  process.stdout.write(JSON.stringify({
    readable: true, status: result.status, directory: result.directory,
    sourceCommit: result.sourceCommit, profileId: result.profileId,
    installationId: result.installationId
  }));
} catch (error) {
  if (!(error instanceof SyntaxError) && !incomplete.has(error.code)) throw error;
  process.stdout.write(JSON.stringify({
    readable: false, error: {
      code: error.code ?? error.name, message: error.message
    }
  }));
}
"""
    observed = run_json([node, "--input-type=module", "--eval", code,
                         inspector.as_uri(), str(target)],
                        root / "runtime-install.log", "inspect-retained-runtime-preparation")
    need(isinstance(observed.get("readable"), bool),
         "The original runtime preparation inspection returned no decision")
    if observed["readable"]:
        need(observed.get("status") in ("PREPARED", "INSTALLING", "FAILED", "READY") and
             observed.get("directory") == str(target),
             "The original runtime preparation inspection selected a different installation")
    return observed


def ready_installed_runtime(root, source_root, node, archive, archive_sha, original, manifest_sha):
    cli = source_root / DISTRIBUTION / "runtime-install-cli.mjs"
    target = root / "installed-runtime"
    # The maintained installer resumes dependency installation in the original
    # directory. Its documented preparation recovery owns a fresh directory
    # when extraction itself was interrupted, preserving each earlier attempt.
    prepared = False
    for attempt in range(32):
        if not target.exists():
            run([node, str(cli), "prepare", "--dir", str(target),
                 "--archive", str(archive), "--sha256", archive_sha,
                 "--feature", "mcp", "--operator"],
                root / "runtime-install.log", "prepare-original-selected-runtime")
        observed = inspect_runtime_preparation(root, source_root, node, target)
        if observed["readable"]:
            prepared = True
            break
        preparation_path = target / "preparation.json"
        need(preparation_path.is_file(), "The original runtime preparation identity is required: " + str(target))
        preparation = json.loads(preparation_path.read_bytes())
        need(preparation.get("archiveSha256") == archive_sha and
             preparation.get("selection", {}).get("features") == ["mcp"] and
             preparation.get("selection", {}).get("operator") is True,
             "The retained partial runtime belongs to different source or dependencies")
        previous = target
        target = root / ("installed-runtime-recovery-" + str(attempt + 1))
        if not target.exists():
            run([node, str(cli), "recover", "--from", str(previous), "--dir", str(target)],
                root / "runtime-install.log", "recover-original-runtime-preparation")
    need(prepared, "Continue the retained runtime preparation from the original recovery log")
    plan = json.loads((target / "runtime-install.json").read_bytes())
    profile = json.loads((target / "runtime-profile.json").read_bytes())
    need(plan.get("archiveSha256") == archive_sha and
         plan.get("source", {}).get("sourceCommit") == original["commit"] and
         profile.get("selection", {}).get("features") == ["mcp"] and
         profile.get("selection", {}).get("operator") is True,
         "The selected installed runtime changed")
    run([node, str(cli), "install", "--dir", str(target)],
        root / "runtime-install.log", "continue-original-selected-runtime")
    observed = run_json([node, str(cli), "inspect", "--dir", str(target), "--load", "--source"],
                       root / "runtime-install.log", "inspect-complete-original-runtime")
    need(observed.get("status") == "READY" and observed.get("ready") is True and
         observed.get("sourceVerified") is True and observed.get("lockMatches") is True and
         observed.get("sourceCommit") == original["commit"] and
         observed.get("sourceRoot") == str(target / "package/source"),
         "The original installed runtime must be complete and ready")
    native_manifest = target / "package/manifest.json"
    need(identity(native_manifest)["sha256"] == manifest_sha, "The installed selected manifest changed")
    retained = {"directory": str(target), "sourceRoot": observed["sourceRoot"],
                "sourceCommit": observed["sourceCommit"], "installationId": observed["installationId"],
                "profileId": observed["profileId"], "lockSha256": observed["lockSha256"],
                "manifestSha256": manifest_sha}
    immutable(root / "runtime-installation.json", data(retained))
    return retained


def source_archive(root, source_root, entries):
    archive = root / "flowable-complete-source.zip"
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
         "Keep the original Flowable source and company operation")
    original = packet["source"]
    need(original["repository"] == "woahwhattheheck/tjlabs-stellar-merchant-workspace",
         "Use the maintained Flowable merchant source repository")
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
                 DISTRIBUTION + "/runtime-unpack.py", DISTRIBUTION + "/selections/flowable-merchant.json",
                 NATIVE + "/flowable-native-host.py", NATIVE + "/native-journey.mjs"):
        need(path in decoded, "Complete source packet is missing " + path)
    binding = {"schema": RESULT_SCHEMA, "operation": OPERATION, "source": original,
               "packetSha256": hashlib.sha256(packet_bytes).hexdigest()}
    immutable(root / "operation.json", data(binding))
    toolkit = directory(root / "toolkit")
    receiver_path = toolkit / "git-object-receiving.py"
    immutable(receiver_path, decoded[DISTRIBUTION + "/git-object-receiving.py"], 0o700)
    receiver = module(receiver_path, "flowable_original_git_receiver")
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
               "--selection", "flowable-merchant", "--out", str(release_root), "--offline"]
    if release_root.exists():
        command.append("--resume")
    run(command, root / "release-build.log", "build-original-selected-release")
    receipt_path = release_root / "distribution.json"
    receipt = json.loads(receipt_path.read_bytes())
    release_archive = Path(receipt["archive"])
    need(receipt["status"] == "PACKAGED" and receipt["sourceCommit"] == original["commit"] and
         release_archive.parent == release_root, "Original selected release receipt differs")
    inspector = module(source_root / DISTRIBUTION / "runtime-unpack.py", "flowable_original_runtime_unpack")
    manifest, _, verified, manifest_sha = inspector.inspect(release_archive, receipt["sha256"])
    need(manifest["sourceCommit"] == original["commit"] and
         manifest.get("sourceSelection", {}).get("id") == "flowable-merchant", "Selected release identity differs")
    del verified
    source_zip = source_archive(root, source_root, entries)
    source_manifest = {"schema": "commons.flowable-source-release.v1",
                       "repository": original["repository"], "source_commit": original["commit"],
                       "files": [{"path": item["path"], "bytes": item["bytes"], "sha256": item["sha256"]}
                                 for item in sorted(entries, key=lambda value: value["path"])],
                       "archive": {**identity(source_zip), "prefix": ""}}
    source_manifest_path = root / "flowable-source-release.json"
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
        runtime = ready_installed_runtime(root, source_root, node, release_archive, receipt["sha256"],
                                          original, manifest_sha)
        command = [sys.executable, str(source_root / NATIVE / "flowable-native-host.py"),
                   "--source-root", str(source_root), "--source-revision", original["commit"],
                   "--runtime-directory", runtime["directory"], "--directory", str(Path(args.native_directory).absolute()), "--operation", OPERATION,
                   "--node", node, "--native-cpus", str(args.native_cpus)]
        for option, value in (("--java", args.java), ("--playwright-module", args.playwright_module),
                              ("--chromium", args.chromium), ("--java-heap-mib", str(args.java_heap_mib))):
            if value:
                command.extend([option, value])
        run(command, root / "native-receiving.log", "continue-original-native-flowable-operation")
        native_root = Path(args.native_directory).absolute()
        native_receiving = json.loads((native_root / "delivery.json").read_bytes())
        scope = native_receiving["scope"]
        need(native_receiving["state"] == "PASSED" and scope == "complete-native-process-history-and-cold-receiving" and
             native_receiving.get("nativeClose", {}).get("state") == "CLOSED" and
             native_receiving["operation"] == OPERATION and
             native_receiving["sourceRevision"] == original["commit"], "Original native receiving differs")
        journey_path = native_root / "journey/journey.json"
        journey_identity = identity(journey_path)
        state_file = native_receiving["nativeResult"]["stateFile"]
        need(journey_identity == {key: state_file[key] for key in ("bytes", "sha256")},
             "Keep the original completed native journey")
        journey = json.loads(journey_path.read_bytes())
        step_name = "complete-native-process-history-export-and-cold-receiving"
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
        result["runtimeInstallation"] = runtime
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
    parser.add_argument("--java")
    parser.add_argument("--playwright-module")
    parser.add_argument("--chromium")
    parser.add_argument("--java-heap-mib", type=int, choices=range(256, 8193), default=768)
    parser.add_argument("--native-cpus", type=int, choices=range(1, 9), default=2)
    args = parser.parse_args()
    need(not any((args.java, args.playwright_module, args.chromium)) or args.native_directory,
         "Native target/runtime options require the original native directory")
    receive(args)


if __name__ == "__main__":
    main()
