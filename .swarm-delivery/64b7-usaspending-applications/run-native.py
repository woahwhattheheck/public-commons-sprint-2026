#!/usr/bin/env python3
"""Continue the same original USAspending receiving operation with its saved Application."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import zipfile

OPERATION = "SCF-USASPENDING-AWARD-TRANSACTIONS-64B7-20261012"
ENTRY = "stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/application-native.mjs"

def require(value, message):
    if not value:
        raise ValueError(message)

def original_directory(path):
    require(path.is_dir() and not path.is_symlink() and path.resolve() == path,
            "Use the same existing original receiving directory: " + str(path))
    return path

def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", required=True, type=Path)
    parser.add_argument("--directory", required=True, type=Path,
                        help="Same ROOT created by the original USAspending source receiving materializer")
    parser.add_argument("--node", default="node")
    parser.add_argument("--runtime", type=Path,
                        help="An actual READY runtime containing this contribution; otherwise source application mode runs")
    args = parser.parse_args()
    root = original_directory(args.directory.absolute())
    source_root = original_directory(root / "source")
    received = original_directory(root / "native")
    require((received / "receiving-result.json").is_file(),
            "Finish the already accepted original transaction receiving operation in ROOT/native first")
    packet_bytes = args.packet.read_bytes()
    packet = json.loads(packet_bytes)
    require(packet.get("schema") == "usaspending.application-native-source.v1"
            and packet.get("operation") == OPERATION and isinstance(packet.get("files"), list),
            "The original Applications source packet is required")
    prepared = []
    names = set()
    for item in packet["files"]:
        path, content, expected = item.get("path"), item.get("content"), item.get("git_blob")
        require(isinstance(path, str) and path and "\\" not in path and not path.startswith("/")
                and all(part not in ("", ".", "..") for part in path.split("/")) and path not in names,
                "Invalid or duplicate original source path")
        names.add(path)
        require(isinstance(content, str) and isinstance(expected, str)
                and re.fullmatch("[a-f0-9]{40}", expected), "Invalid source content or Git identity")
        data = content.encode("utf-8")
        require(git_blob(data) == expected, "Original source Git blob differs: " + path)
        target = source_root / path
        parent = source_root
        for part in Path(path).parts[:-1]:
            parent = parent / part
            if parent.exists() or parent.is_symlink():
                original_directory(parent)
        if target.exists() or target.is_symlink():
            require(target.is_file() and not target.is_symlink()
                    and target.resolve() == target and target.read_bytes() == data,
                    "Existing original source differs from this retained overlay: " + path)
        prepared.append((path, target, data, expected))
    require(ENTRY in names, "Complete original native application receiver is missing")
    for path, target, data, expected in prepared:
        target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        if not target.exists():
            with target.open("xb") as stream:
                stream.write(data)
            target.chmod(0o644)
        require(git_blob(target.read_bytes()) == expected, "Materialized source differs: " + path)
    version = subprocess.run([args.node, "--version"], check=True, text=True, capture_output=True).stdout.strip()
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", version)
    require(match and (int(match[1]), int(match[2])) >= (22, 13),
            "Use the original Node 22.13 or newer runtime with node:sqlite")
    mode = "managed" if args.runtime else "source"
    output = root / ("applications-" + mode)
    require(not output.exists(), "Reopen the original existing Applications output before another launch: " + str(output))
    prefix = root / ("applications-" + mode + "-receiver")
    receipt_path = prefix.with_suffix(".json")
    require(not receipt_path.exists(), "This original Applications receiving operation already has its receipt")
    command = [args.node, str(source_root / ENTRY), "--received", str(received),
               "--out", str(output), "--operation", OPERATION]
    if args.runtime:
        command += ["--runtime", str(args.runtime.absolute())]
    with prefix.with_suffix(".stdout.log").open("xb") as stdout, prefix.with_suffix(".stderr.log").open("xb") as stderr:
        stdout_name, stderr_name = stdout.name, stderr.name
        os.chmod(stdout_name, 0o600)
        os.chmod(stderr_name, 0o600)
        completed = subprocess.run(command, cwd=source_root, stdout=stdout, stderr=stderr, check=False)
    receipt = {
        "schema": "usaspending.application-native-materialization.v1", "operation": OPERATION,
        "sourceCommit": packet["source_commit"], "mergedCommit": packet["merged_commit"],
        "packetSha256": hashlib.sha256(packet_bytes).hexdigest(), "files": len(prepared),
        "sourceRoot": str(source_root), "originalReceivingDirectory": str(received),
        "mode": mode, "node": version, "command": command, "exitCode": completed.returncode,
        "stdout": stdout_name, "stderr": stderr_name,
        "result": str(output / "application-receiving-result.json"),
    }
    with receipt_path.open("x", encoding="utf-8") as stream:
        json.dump(receipt, stream, indent=2)
        stream.write("\n")
    receipt_path.chmod(0o600)
    archive = root / ("USAspending_Applications_" + mode + "_64B7.zip")
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr("original-applications-source-packet.json", packet_bytes)
        for path, target, data, expected in prepared:
            bundle.writestr("source/" + path, data)
        for path in (receipt_path, Path(stdout_name), Path(stderr_name)):
            bundle.write(path, path.name)
        if output.exists():
            for path in sorted(output.rglob("*")):
                if path.is_file() and not path.is_symlink():
                    bundle.write(path, "applications-" + mode + "/" + str(path.relative_to(output)))
    archive.chmod(0o600)
    print(json.dumps({**receipt, "archive": str(archive)}, indent=2))
    if completed.returncode:
        sys.stderr.write(Path(stderr_name).read_text(encoding="utf-8", errors="replace")[-8000:])
    return completed.returncode

if __name__ == "__main__":
    sys.exit(main())
