#!/usr/bin/env python3
"""Run the retained Service receiving entrypoint with an explicitly selected host runtime."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import threading

PACKET_SHA256 = "7a098fefcb5ad745810602f5d994a723f0e10317acb27bd85db2ac4f723a1fa0"
SOURCE_COMMIT = "fe7329e0595d7ab77eddc832bee27785f13e9a4d"
OPERATION = "SCF-SUPPORT-SERVICE-COMMITMENTS-24EA-20261012"


def emit(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)


def write_json(path, value):
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def read_existing(path):
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        return None
    value = json.loads(data)
    if value.get("operationId") != OPERATION:
        raise RuntimeError("The existing native record belongs to a different operation: " + str(path))
    return {"path": str(path), "sha256": hashlib.sha256(data).hexdigest(), "value": value}


def executable(value):
    selected = shutil.which(value) if "/" not in value else value
    path = Path(selected or value).expanduser().resolve()
    if not path.is_file() or not os.access(path, os.X_OK):
        raise RuntimeError("Selected native executable is unavailable: " + str(path))
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, help="Original persistent native case/checkpoint directory.")
    parser.add_argument("--work-dir", required=True, help="Host-local directory for the verified source and browser profile.")
    parser.add_argument("--node", required=True, help="Installed Node executable or command.")
    parser.add_argument("--chromium", required=True, help="Installed Chromium executable.")
    parser.add_argument("--playwright-module", required=True, help="Installed Playwright JavaScript module.")
    parser.add_argument("--node-modules", required=True, help="Existing application dependency directory.")
    parser.add_argument("--source-packet", default="-", help="Exact source-map.json file; '-' reads its bytes from stdin.")
    parser.add_argument("--inspect", action="store_true", help="Read the original native checkpoint/result without writing or launching.")
    args = parser.parse_args()
    packet_bytes = sys.stdin.buffer.read() if args.source_packet == "-" else Path(args.source_packet).read_bytes()
    if hashlib.sha256(packet_bytes).hexdigest() != PACKET_SHA256:
        raise RuntimeError("Original Service source packet bytes differ")
    packet = json.loads(packet_bytes)
    if packet.get("operationId") != OPERATION or packet.get("authoredCommit") != SOURCE_COMMIT or len(packet["files"]) != 118:
        raise RuntimeError("Unexpected Service receiving source")
    if set(packet["files"]) != set(packet["file_blobs"]):
        raise RuntimeError("The complete source and original blob index differ")

    root = Path(args.work_dir).expanduser().resolve()
    source = root / "source"
    native = Path(args.directory).expanduser().resolve()
    if native == root or native == source:
        raise RuntimeError("Select separate native case and source directories")
    existing = []
    for name in ("service-receiving-checkpoint.json", "service-native-run.json"):
        item = read_existing(native / name)
        if item:
            value = item["value"]
            if value.get("directory") != str(native):
                raise RuntimeError("Retain the original native directory recorded in " + str(item["path"]) + ": " + str(value.get("directory")))
            existing.append({key: item[key] for key in ("path", "sha256")} | {
                "caseId": value.get("caseId"), "result": value.get("result"),
                "completedAt": value.get("completedAt"), "phases": value.get("phases", {}),
                "sourceSelections": value.get("sourceSelections", []),
            })
    if len({item["caseId"] for item in existing}) > 1:
        raise RuntimeError("The original checkpoint and completed result contain different cases")
    emit({"event": "service-existing-native-read", "operationId": OPERATION,
          "directory": str(native), "records": existing, "nativeChildStarted": False})
    if args.inspect:
        return 0

    node, chromium = executable(args.node), executable(args.chromium)
    deps = Path(args.node_modules).expanduser().resolve()
    playwright = Path(args.playwright_module).expanduser().resolve()
    if not deps.is_dir() or not playwright.is_file():
        raise RuntimeError("Select the existing application dependencies and Playwright module")

    for path in (root, source, native):
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name, content in packet["files"].items():
        parts = PurePosixPath(name)
        if parts.is_absolute() or ".." in parts.parts or "\\" in name:
            raise RuntimeError("Unsafe source path")
        data = content.encode("utf-8")
        observed = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if observed != packet["file_blobs"][name]:
            raise RuntimeError("Source blob mismatch " + name)
        target = source.joinpath(*parts.parts)
        if not target.resolve().is_relative_to(source) or target.is_symlink():
            raise RuntimeError("The selected source path leaves its retained source directory")
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if target.exists():
            if target.read_bytes() != data:
                raise RuntimeError("Different selected source already exists " + name)
        else:
            with target.open("xb") as stream:
                stream.write(data)
            target.chmod(0o600)

    entry = source / packet["nativeEntry"]
    if packet["nativeEntry"] not in packet["files"] or not entry.is_file():
        raise RuntimeError("The original native entrypoint is absent")
    modules = source / "node_modules"
    if modules.exists() or modules.is_symlink():
        if modules.resolve() != deps:
            raise RuntimeError("The existing source dependency selection differs")
    else:
        modules.symlink_to(deps, target_is_directory=True)
    browser = root / "browser"
    browser.mkdir(exist_ok=True, mode=0o700)
    browser_link = native / "browser"
    if not browser_link.exists() and not browser_link.is_symlink():
        browser_link.symlink_to(browser, target_is_directory=True)
    elif browser_link.is_symlink() and not browser_link.exists():
        raise RuntimeError("Retain or restore the existing browser-profile destination")

    selection = {
        "operationId": OPERATION, "commit": SOURCE_COMMIT, "packetSha256": PACKET_SHA256,
        "source": str(source), "native": str(native), "files": packet["file_blobs"],
        "browserProfile": str(browser_link.resolve()),
        "runtime": {"node": str(node), "chromium": str(chromium),
                    "playwrightModule": str(playwright), "nodeModules": str(deps)},
    }
    for path in (root / "source-selection.json", native / "runtime-custody.json"):
        prior = read_existing(path)
        if prior and prior["value"].get("packetSha256") != PACKET_SHA256:
            raise RuntimeError("The existing runtime custody selects a different original source")
    write_json(root / "source-selection.json", selection)
    write_json(native / "runtime-custody.json", {key: value for key, value in selection.items() if key != "files"})
    emit({"event": "service-source-ready", "commit": SOURCE_COMMIT, "files": len(packet["files"]),
          "native": str(native), "sharedFreeBytes": shutil.disk_usage(native).free,
          "sourceFreeBytes": shutil.disk_usage(source).free})
    argv = [str(node), str(entry), "--directory", str(native), "--source-commit", SOURCE_COMMIT,
            "--chromium", str(chromium), "--playwright-module", str(playwright)]
    log = native / "service-native-output.log"
    with log.open("ab", buffering=0) as output:
        child = subprocess.Popen(argv, cwd=str(source), stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        emit({"event": "service-original-native-started", "pid": child.pid, "argv": argv})

        def pump():
            echo = True
            for block in iter(lambda: child.stdout.read1(16384), b""):
                output.write(block)
                if echo:
                    try:
                        sys.stdout.buffer.write(block)
                        sys.stdout.buffer.flush()
                    except BrokenPipeError:
                        echo = False

        reader = threading.Thread(target=pump, daemon=True)
        reader.start()
        try:
            code = child.wait()
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
            reader.join(timeout=5)
    emit({"event": "service-original-native-completed", "pid": child.pid, "exitCode": code,
          "checkpoint": str(native / "service-receiving-checkpoint.json"),
          "result": str(native / "service-native-run.json")})
    return code if code >= 0 else 128 - code


if __name__ == "__main__":
    sys.exit(main())
