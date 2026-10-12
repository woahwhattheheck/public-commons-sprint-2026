#!/usr/bin/env python3
"""MIT. Receive the two original merchant-console journeys from pinned source."""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tempfile

SELECTED = {
    "console": {
        "blob": "52de0bf92238763c33ca9e17dd3907503f4f94ca",
        "commit": "ab1215ca9610b1a932e5f510f8b51249c99553ae",
        "entry": "stellar-forge/mcp-merchant-operator/receiving/console-journey.mjs",
        "operation": "merchant-operator-console-native-ee290-20261012",
        "files": 437,
    },
    "host-review": {
        "blob": "5970ed8537ebf934735960e2748291364b2121cb",
        "commit": "d9d8272c1792e1a0e0058cfdcbcd73ed0e153c5c",
        "entry": "stellar-forge/mcp-merchant-operator/receiving/host-review.mjs",
        "operation": "merchant-operator-host-review-native-ee290-20261012",
        "files": 494,
    },
}
PEERS = {
    "@x402/core": "2.28.0",
    "@x402/stellar": "2.28.0",
    "@x402/extensions": "2.28.0",
}

def need(value, message):
    if not value:
        raise ValueError(message)

def git_blob(body):
    return hashlib.sha1(b"blob " + str(len(body)).encode("ascii") + b"\0" + body).hexdigest()

def emit(stage, **values):
    print(json.dumps({"stage": stage, **values}, separators=(",", ":")), flush=True)

def source_packet(path, selected):
    raw = path.read_bytes()
    need(len(raw) <= 64 * 1024 * 1024, "Use the original source packet.")
    value = json.loads(raw)
    # Both forms are original Git transport envelopes, decoded exactly once.
    if isinstance(value, dict) and value.get("encoding") in ("base64", "utf-8") and "content" in value:
        need(value.get("sha") == selected["blob"], "The Git envelope selects another source packet.")
        raw = (base64.b64decode("".join(value["content"].split()), validate=True)
               if value["encoding"] == "base64" else value["content"].encode("utf-8"))
        value = json.loads(raw)
    need(git_blob(raw) == selected["blob"], "The complete source packet differs from the pinned Git blob.")
    need(value["repository"] == "woahwhattheheck/public-commons-sprint-2026", "Use the original repository.")
    need(value["commit"] == selected["commit"], "Use the selected receiving source commit.")
    files, manifest = value["files"], value["manifest"]
    need(manifest["commit"] == selected["commit"], "The source manifest selects another commit.")
    need(set(files) == set(manifest["files"]), "Every source file needs its original Git identity.")
    need(len(files) == selected["files"], "The original source selection is incomplete.")
    for name, text in files.items():
        path = PurePosixPath(name)
        need(not path.is_absolute() and all(part not in ("", ".", "..") for part in path.parts)
             and "\\" not in name and "\0" not in name, "Invalid selected source path.")
        need(isinstance(text, str), "Source files must retain their original UTF-8 text.")
        need(git_blob(text.encode("utf-8")) == manifest["files"][name], "Source differs from Git: " + name)
    return value, raw

def private_directory(path):
    need(path.is_absolute(), "Supply an absolute private directory.")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    need(path.resolve() == path and not path.is_symlink(), "Use the original real directory.")
    if os.name != "nt":
        info = path.stat()
        need(info.st_mode & 0o077 == 0, "The receiving source directory must be private.")
        need(info.st_uid == os.getuid(), "Keep the original directory owner.")

def save_exact(path, body):
    if path.exists() or path.is_symlink():
        need(path.is_file() and not path.is_symlink(), "An existing selected source path is not a regular file.")
        need(path.read_bytes() == body, "Preserve the existing different source: " + str(path))
        return
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".source-writing-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as file:
            file.write(body)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def materialize(packet, directory, selected):
    private_directory(directory)
    marker = directory / ".receiving-source.json"
    identity = {"repository": packet["repository"], "commit": selected["commit"],
                "sourceBlob": selected["blob"], "operation": selected["operation"]}
    if marker.exists():
        need(json.loads(marker.read_text()) == identity, "This source directory belongs to another selection.")
    else:
        need(not any(directory.iterdir()), "Choose an empty private source directory.")
        save_exact(marker, (json.dumps(identity, sort_keys=True) + "\n").encode())
    for name, text in packet["files"].items():
        target = directory.joinpath(*PurePosixPath(name).parts)
        need(target.parent.resolve().is_relative_to(directory), "Keep selected source inside its original root.")
        save_exact(target, text.encode("utf-8"))
    manifest_path = directory / ".receiving-source-manifest.json"
    save_exact(manifest_path, (json.dumps(packet["manifest"], sort_keys=True) + "\n").encode())
    return manifest_path

def dependencies(source, supplied):
    modules = supplied.resolve(strict=True)
    need(modules.is_dir(), "Supply the original installed node_modules directory.")
    for name, version in PEERS.items():
        metadata = json.loads((modules / name / "package.json").read_text())
        need(metadata.get("name") == name and metadata.get("version") == version,
             "Use the original installed dependency: " + name + "@" + version)
    stellar = json.loads((modules / "@stellar/stellar-sdk/package.json").read_text())
    version = stellar.get("version", "").split(".")
    need(stellar.get("name") == "@stellar/stellar-sdk" and len(version) == 3
         and version[0] == "16" and version[1].isdigit() and version[2].isdigit() and int(version[1]) >= 3,
         "Use the original @stellar/stellar-sdk ^16.3.0 installation.")
    target = source / "node_modules"
    if target.exists() or target.is_symlink():
        need(target.resolve(strict=True) == modules, "Preserve this source directory's original dependency selection.")
    else:
        target.symlink_to(modules, target_is_directory=True)
    return {"directory": str(modules), **PEERS, "@stellar/stellar-sdk": stellar["version"]}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--journey", choices=SELECTED, required=True)
    parser.add_argument("--source-packet", type=Path, required=True)
    parser.add_argument("--source-directory", type=Path, required=True)
    parser.add_argument("--directory", type=Path)
    parser.add_argument("--console-receiving", type=Path)
    parser.add_argument("--node", default=shutil.which("node"))
    parser.add_argument("--dependencies", type=Path)
    parser.add_argument("--chromium", type=Path)
    parser.add_argument("--playwright-module")
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    selected = SELECTED[args.journey]
    packet, raw = source_packet(args.source_packet, selected)
    manifest = materialize(packet, args.source_directory, selected)
    emit("ORIGINAL_SOURCE_READY", **selected, directory=str(args.source_directory),
         packetBytes=len(raw), packetSha256=hashlib.sha256(raw).hexdigest())
    if args.prepare_only:
        return 0
    need(args.node and args.dependencies and args.directory and args.chromium and args.playwright_module,
         "Supply the existing Node 24, compatible dependencies, Chromium, Playwright and receiving directory.")
    need(args.directory.is_absolute() and args.chromium.is_absolute(), "Use absolute original runtime/receiving paths.")
    if args.journey == "host-review":
        need(args.console_receiving and args.console_receiving.is_absolute(),
             "Select the completed original console receiving directory.")
        report = json.loads((args.console_receiving / "console-native-run.json").read_text())
        need(report.get("result") == "PASS", "Continue the original console receiving through completion first.")
    version = subprocess.check_output([args.node, "--version"], text=True).strip()
    need(int(version.lstrip("v").split(".", 1)[0]) >= 24, "The original source requires Node 24 or later.")
    dependency = dependencies(args.source_directory, args.dependencies)
    command = [args.node, str(args.source_directory / selected["entry"]),
               "--directory", str(args.directory),
               "--chromium", str(args.chromium),
               "--playwright-module", args.playwright_module,
               "--source-commit", selected["commit"]]
    if args.journey == "host-review":
        command.extend(["--console-receiving", str(args.console_receiving),
                        "--source-manifest", str(manifest)])
    emit("ORIGINAL_RECEIVING_STARTED", operation=selected["operation"], node=version,
         sourceCommit=selected["commit"], dependencies=dependency, command=command)
    result = subprocess.run(command, cwd=args.source_directory)
    emit("ORIGINAL_RECEIVING_RETURNED", operation=selected["operation"], exitCode=result.returncode,
         directory=str(args.directory))
    return result.returncode

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        emit("ORIGINAL_RECEIVING_ERROR", error=type(error).__name__, message=str(error))
        raise SystemExit(1)
