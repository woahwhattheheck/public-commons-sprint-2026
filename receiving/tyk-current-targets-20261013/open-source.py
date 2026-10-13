#!/usr/bin/env python3
"""Verify this layered Tyk edition and delegate to the unchanged original source receiver."""
from __future__ import annotations
import argparse, base64, gzip, hashlib, json, os, stat, sys, uuid
from pathlib import Path

OPERATION = "TYK-API-MIGRATION-ROLLOUT-D76C-20261012"
BASE = "b8004ce3e455925a27dcb79770e14285689eb497"
COMPOSED = "477a52054957f384cbadd804ec906d45db977c44"
PACKET_SHA = "9d39e582c6e47557b5c2a64b0dcf544a4f3083251ce4e6e71a10e9c62153c95a"
PACKET_BYTES = 18573554
BASE_SHA = "52c2efa2af3359505bcd8270e402de0b5036e3bc5d53bfd127bdf181a8fd3a82"
BASE_BYTES = 18415813
RECEIVER = "stellar/scf-starforge-20261009/sf30-seller-sdk/tyk/receive-source-release.py"

def need(ok, message):
    if not ok:
        raise ValueError(message)

def sha(value):
    return hashlib.sha256(value).hexdigest()

def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

def regular(path):
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and not path.is_symlink(), "Expected an original regular file: " + str(path))
    return path.read_bytes()

def retain(root, name, content):
    path = root / name
    if path.exists() or path.is_symlink():
        need(regular(path) == content, "Preserve the original bound receiving edition: " + str(path))
        return
    temporary = root / (name + ".pending-" + uuid.uuid4().hex)
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            need(regular(path) == content, "A concurrent receiver selected another edition")
        parent = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        temporary.unlink(missing_ok=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--envelope", required=True)
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
    envelope = json.loads(regular(Path(args.envelope).absolute()))
    need(envelope.get("schema") == "commons.tyk-build-source-envelope.v1" and envelope.get("codec") == "gzip+base64",
         "Supply this complete original source envelope")
    raw = gzip.decompress(base64.b64decode(envelope["payload_base64"], validate=True))
    need(len(raw) == envelope["bytes"] == PACKET_BYTES and sha(raw) == envelope["sha256"] == PACKET_SHA,
         "The complete composed source packet differs")
    packet = json.loads(raw)
    need(packet["operation"] == OPERATION and packet["source"]["commit"] == COMPOSED, "Keep the original operation and exact composed source")
    composition = packet["composition"]
    need(composition["kind"] == "LOCAL_REPRODUCIBLE_SOURCE_COMPOSITION" and composition["base"]["commit"] == BASE,
         "The original source authority is missing")
    original_files = {item["path"]: item for item in composition["originalFiles"]}
    original_rows = {item["path"]: item for item in composition["originalTreeRows"]}
    need(len(original_files) == 5 and len(packet["files"]) == 1134 and composition["unchangedFiles"] == 1129,
         "Expected the exact five-file continuation of the original complete source")
    original = {"schema": packet["schema"], "operation": packet["operation"], "source": composition["base"],
                "commit": composition["baseCommit"],
                "tree": {**composition["originalTreeMetadata"],
                         "tree": [original_rows.get(row["path"], row) for row in packet["tree"]["tree"]]},
                "files": [original_files.get(row["path"], row) for row in packet["files"]]}
    original_raw = json_bytes(original)
    need(len(original_raw) == BASE_BYTES and sha(original_raw) == BASE_SHA,
         "The complete signed baseline cannot be recovered byte-for-byte")
    member = next(item for item in packet["files"] if item["path"] == RECEIVER)
    original_member = next(item for item in original["files"] if item["path"] == RECEIVER)
    need(member == original_member, "The original source receiver must remain unchanged")
    receiver = base64.b64decode(member["content"], validate=True)
    need(len(receiver) == member["bytes"] and sha(receiver) == member["sha256"], "Original receiver source differs")
    os.umask(0o077)
    root = Path(args.directory).absolute()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = root.lstat()
    need(stat.S_ISDIR(info.st_mode) and not root.is_symlink() and root.resolve() == root and not info.st_mode & 0o077,
         "Select an owned canonical private source-edition directory")
    retain(root, "source.json", raw)
    retain(root, "original-b8004-source.json", original_raw)
    retain(root, "source-composition.json", json_bytes(composition))
    retain(root, "receive-source-release.py", receiver)
    command = [sys.executable, str(root / "receive-source-release.py"), "--packet", str(root / "source.json"),
               "--directory", str(root / "receiving"), "--native-cpus", str(args.native_cpus)]
    for name in ("node", "native_directory", "redis_server", "playwright_module", "chromium",
                 "dashboard_config", "return_directory"):
        value = getattr(args, name)
        if value:
            command.extend(["--" + name.replace("_", "-"), value])
    os.execv(sys.executable, command)

if __name__ == "__main__":
    main()
