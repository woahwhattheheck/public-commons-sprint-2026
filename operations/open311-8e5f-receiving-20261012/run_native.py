#!/usr/bin/env python3
"""Receive the complete original Open311 operation in one native process lifetime."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import zipfile

OPERATION = "SCF-OPEN311-OPERATIONS-8E5F-20261012"

def safe_path(value):
    path = PurePosixPath(value)
    if not value or path.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")):
        raise ValueError("Invalid packet path: " + value)
    return path

def run(packet, directory, node, packet_sha=None):
    if packet.get("schema") != "commons.open311.native-source.v1" or packet.get("operationId") != OPERATION:
        raise ValueError("Use the original complete Open311 source packet.")
    root = Path(directory)
    if not root.is_absolute():
        raise ValueError("The operation directory must be absolute.")
    files, seen = packet["files"], set()
    for item in files:
        path = safe_path(item["path"])
        if str(path) in seen:
            raise ValueError("Duplicate source packet member.")
        seen.add(str(path))
        body = item["content"].encode("utf-8")
        digest = hashlib.sha1(b"blob " + str(len(body)).encode("ascii") + b"\0" + body).hexdigest()
        if len(body) != item["bytes"] or digest != item["gitSha1"]:
            raise ValueError("Source file differs from its Git object: " + str(path))
    retained = packet["retained"]
    retained_bytes = retained["content"].encode("utf-8")
    if len(retained_bytes) != retained["bytes"] or hashlib.sha256(retained_bytes).hexdigest() != retained["sha256"]:
        raise ValueError("Original Helsinki response manifest differs.")
    if packet["entry"] not in seen or packet["selection"]["connection"] not in seen:
        raise ValueError("Source packet is missing its entry or original connection.")
    version = subprocess.check_output([node, "--version"], text=True).strip()
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", version)
    if not match or tuple(map(int, match.groups())) < (22, 16, 0):
        raise ValueError("Open311 requires installed Node 22.16 or newer; observed " + version)
    root.mkdir(mode=0o700, exist_ok=False)
    source = root / "source"
    source.mkdir(mode=0o700)
    for item in files:
        target = source.joinpath(*safe_path(item["path"]).parts)
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with target.open("xb") as handle:
            handle.write(item["content"].encode("utf-8"))
        target.chmod(0o600)
    input_path = root.joinpath(*safe_path(retained["path"]).parts)
    input_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    input_path.write_bytes(retained_bytes)
    input_path.chmod(0o600)
    manifest = {key: value for key, value in packet.items() if key not in ("files", "retained")}
    manifest["packetGitSha1"] = packet_sha
    manifest["files"] = [{key: value for key, value in item.items() if key != "content"} for item in files]
    manifest["retained"] = {key: value for key, value in retained.items() if key != "content"}
    (root / "source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    output = root / "commissioned"
    command = [node, str(source / packet["entry"]), "--connection",
               str(source / packet["selection"]["connection"]), "--start", packet["selection"]["start"],
               "--end", packet["selection"]["end"], "--output", str(output), "--retained", str(input_path)]
    with (root / "native.stdout").open("wb") as stdout, (root / "native.stderr").open("wb") as stderr:
        completed = subprocess.run(command, cwd=source, stdout=stdout, stderr=stderr, check=False)
    journey_path = output / "journey.json"
    journey = json.loads(journey_path.read_text(encoding="utf-8")) if journey_path.is_file() else {
        "state": "failed", "error": {"message": (root / "native.stderr").read_text(encoding="utf-8")}}
    execution = {"operationId": OPERATION, "nodeVersion": version, "returncode": completed.returncode,
                 "command": command, "source": packet["source"], "packetGitSha1": packet_sha}
    (root / "native-execution.json").write_text(json.dumps(execution, indent=2) + "\n", encoding="utf-8")
    archive_path = root.with_name(root.name + ".zip")
    with zipfile.ZipFile(archive_path, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(root).as_posix())
    archive_bytes = archive_path.read_bytes()
    result = {**execution, "journey": journey, "stdout": (root / "native.stdout").read_text(encoding="utf-8"),
              "stderr": (root / "native.stderr").read_text(encoding="utf-8"),
              "archive": {"filename": archive_path.name, "bytes": len(archive_bytes),
                          "sha256": hashlib.sha256(archive_bytes).hexdigest(),
                          "base64": base64.b64encode(archive_bytes).decode("ascii")}}
    print(json.dumps(result, separators=(",", ":")), flush=True)
    return completed.returncode if completed.returncode else (0 if journey.get("state") == "passed" else 1)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", type=Path, required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--node", default=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE", "node"))
    args = parser.parse_args()
    body = args.packet.read_bytes()
    packet_sha = hashlib.sha1(b"blob " + str(len(body)).encode("ascii") + b"\0" + body).hexdigest()
    return run(json.loads(body), args.directory, args.node, packet_sha)

if __name__ == "__main__":
    sys.exit(main())
