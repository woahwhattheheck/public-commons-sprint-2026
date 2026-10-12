#!/usr/bin/env python3
"""Materialize and run the complete retained USAspending receiving operation."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import zipfile

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--node", default=shutil.which("node"))
    args = parser.parse_args()
    if not args.node:
        parser.error("An existing Node 22.13+ executable is required")
    raw_packet = Path(args.packet).read_bytes()
    packet = json.loads(raw_packet)
    if packet.get("schema") != "usaspending.complete-native-source.v1":
        raise ValueError("Use the complete original USAspending source packet")
    root = Path(args.directory).absolute()
    root.mkdir(parents=True, mode=0o700, exist_ok=False)
    source = root / "source"
    source.mkdir(mode=0o700)
    seen = set()
    for entry in packet["files"]:
        relative = PurePosixPath(entry["path"])
        if relative.is_absolute() or ".." in relative.parts or not relative.parts or str(relative) in seen:
            raise ValueError("Invalid or repeated original source path")
        seen.add(str(relative))
        raw = entry["content"].encode("utf-8")
        digest = hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()
        if digest != entry["git_blob"]:
            raise ValueError("Original Git blob mismatch: " + str(relative))
        destination = source.joinpath(*relative.parts)
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with destination.open("xb") as handle:
            handle.write(raw)
        destination.chmod(0o600)
    (root / "original-source-packet.json").write_bytes(raw_packet)
    original = root / "original-input.json"
    original.write_text(json.dumps(packet["original_input"], ensure_ascii=False), encoding="utf-8")
    original.chmod(0o600)
    result_directory = root / "native"
    entrypoint = source / "stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/transactions/run-native.mjs"
    command = [args.node, str(entrypoint), "--source", str(original), "--out", str(result_directory)]
    print(json.dumps({"operation": packet["operation"], "sourceCommit": packet["source_commit"], "sourceFiles": len(seen), "directory": str(root), "nativeCommand": command}), flush=True)
    completed = subprocess.run(command, cwd=source, text=True, encoding="utf-8", stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    (root / "native.stdout").write_text(completed.stdout, encoding="utf-8")
    (root / "native.stderr").write_text(completed.stderr, encoding="utf-8")
    if completed.stdout:
        print(completed.stdout, end="", flush=True)
    if completed.stderr:
        print(completed.stderr, end="", file=sys.stderr, flush=True)
    archive = root / "USAspending_Original_Receiving_64B7.zip"
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for path in sorted(root.rglob("*")):
            if path.is_file() and path != archive:
                bundle.write(path, path.relative_to(root).as_posix())
    original_result = result_directory / "receiving-result.json"
    print(json.dumps({"operation": packet["operation"], "exitCode": completed.returncode, "resultPath": str(original_result) if original_result.exists() else None, "archivePath": str(archive), "archiveBytes": archive.stat().st_size, "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest()}), flush=True)
    return completed.returncode

if __name__ == "__main__":
    sys.exit(main())
