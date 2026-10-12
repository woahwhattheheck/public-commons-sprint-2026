#!/usr/bin/env python3
"""Continue the retained USAspending operation through its original merchant tools."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
from datetime import datetime, timezone
import zipfile

OPERATION = "SCF-USASPENDING-AWARD-TRANSACTIONS-64B7-20261012"
PACKET_BLOB = "02a73125b410bcf0265e75f6b2cf7fc77ed48bf3"
BASE_BLOB = "9cfce7aae075c3c5f4cbc470bd85fd447e6aeacc"
ENTRYPOINT = "stellar-forge/mcp-merchant-operator/examples/usaspending-transactions-native.mjs"

def git_blob(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()

def relative_path(value):
    relative = PurePosixPath(value)
    if not relative.parts or relative.is_absolute() or ".." in relative.parts or str(relative) != value or "\\" in value:
        raise ValueError("Invalid original source path: " + str(value))
    return relative

def source_entries(packet):
    seen = set()
    for entry in packet["files"]:
        relative = relative_path(entry["path"])
        if str(relative) in seen:
            raise ValueError("Repeated original source path: " + str(relative))
        seen.add(str(relative))
        raw = entry["content"].encode("utf-8")
        if git_blob(raw) != entry["git_blob"]:
            raise ValueError("Original Git blob mismatch: " + str(relative))
        yield relative, raw

def inside(directory, relative):
    destination = directory.joinpath(*relative.parts)
    current = directory
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Source path is a symbolic link: " + str(current))
    return destination

def preserve(path, raw):
    if path.is_symlink():
        raise ValueError("Retained path is a symbolic link: " + str(path))
    if path.exists():
        if path.read_bytes() != raw:
            raise ValueError("Retained content changed: " + str(path))
        return
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + ".mcp-next")
    if temporary.is_symlink():
        raise ValueError("Temporary source path is a symbolic link")
    temporary.write_bytes(raw)
    temporary.chmod(0o600)
    os.replace(temporary, path)

def archive_result(root):
    archive = root / "USAspending_MCP_Receiving_64B7.zip"
    temporary = archive.with_suffix(".zip.next")
    # Keep the original receiving archive intact; avoid recursively packaging archives.
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for path in sorted(root.rglob("*")):
            if path.is_file() and not path.is_symlink() and path != temporary and path.suffix not in (".zip", ".lock"):
                bundle.write(path, path.relative_to(root).as_posix())
    temporary.chmod(0o600)
    os.replace(temporary, archive)
    return {"archivePath": str(archive), "archiveBytes": archive.stat().st_size,
            "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest()}

def continue_native(args):
    root = Path(args.directory).absolute()
    source, received, out = root / "source", root / "native", root / "mcp-native"
    if not root.is_dir() or any(path.is_symlink() or not path.is_dir() for path in (source, received)):
        raise ValueError("Use the existing ROOT containing the original source and native receiving directories")
    with (root / ".usaspending-mcp-native.lock").open("a", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("The same native continuation is already running in this ROOT") from None
        raw_packet = Path(args.packet).read_bytes()
        if git_blob(raw_packet) != PACKET_BLOB:
            raise ValueError("Use the exact retained 104-file native source packet " + PACKET_BLOB)
        packet = json.loads(raw_packet)
        if packet.get("schema") != "usaspending.native-merchant-source.v1" or packet.get("operation_id") != OPERATION or packet.get("entrypoint") != ENTRYPOINT:
            raise ValueError("Native packet operation or entrypoint changed")
        raw_base = (root / "original-source-packet.json").read_bytes()
        if git_blob(raw_base) != BASE_BLOB or packet.get("base_source_packet_git_blob") != BASE_BLOB:
            raise ValueError("Use the existing original receiving source packet " + BASE_BLOB)
        base = json.loads(raw_base)
        if base.get("schema") != "usaspending.complete-native-source.v1" or base.get("operation") != OPERATION:
            raise ValueError("Original receiving operation changed")
        original_bytes = (received / "receiving-result.json").read_bytes()
        original = json.loads(original_bytes)
        if original.get("schema") != "usaspending-transactions.native-receiving.v1":
            raise ValueError("Original native receiving has not completed")
        for name in ("award-only-workspace.json", "transaction-capture.json"):
            matches = [item for item in original["artifacts"] if PurePosixPath(item["path"]).name == name]
            raw = (received / name).read_bytes()
            if len(matches) != 1 or len(raw) != matches[0]["bytes"] or hashlib.sha256(raw).hexdigest() != matches[0]["sha256"]:
                raise ValueError("Original receiving artifact changed: " + name)
        base_entries, additions = list(source_entries(base)), list(source_entries(packet))
        if len(additions) != 104:
            raise ValueError("The complete 104-file native overlay is required")
        for relative, raw in base_entries:
            if inside(source, relative).read_bytes() != raw:
                raise ValueError("Original source changed: " + str(relative))
        for relative, raw in additions:
            path = inside(source, relative)
            if path.exists() and path.read_bytes() != raw:
                raise ValueError("Existing native source changed: " + str(relative))
        for relative, raw in additions:
            preserve(inside(source, relative), raw)
        preserve(root / "native-merchant-source.json", raw_packet)
        if out.is_symlink():
            raise ValueError("Native output is a symbolic link")
        journal_path = out / "operation.json"
        journal = json.loads(journal_path.read_bytes()) if journal_path.exists() else None
        expected_binding = {
            "result": hashlib.sha256(original_bytes).hexdigest(),
            "award": hashlib.sha256((received / "award-only-workspace.json").read_bytes()).hexdigest(),
            "capture": hashlib.sha256((received / "transaction-capture.json").read_bytes()).hexdigest(),
        }
        if journal and (journal.get("operationId") != OPERATION or journal.get("source") != expected_binding):
            raise ValueError("Existing native continuation belongs to different original input")
        if journal and journal.get("status") == "complete":
            print(json.dumps({"operation": OPERATION, "status": "complete", "continuedExistingResult": True,
                              "journal": str(journal_path), **archive_result(root)}), flush=True)
            return 0
        if not args.node:
            raise ValueError("An existing Node 22.13+ executable is required")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        stdout_path, stderr_path = root / ("mcp-native." + stamp + ".stdout"), root / ("mcp-native." + stamp + ".stderr")
        command = [args.node, str(source / ENTRYPOINT), "--received", str(received), "--out", str(out), "--operation", OPERATION]
        print(json.dumps({"operation": OPERATION, "sourceCommit": packet["source_commit"], "sourceFilesAdded": len(additions),
                          "directory": str(root), "resuming": journal is not None, "nativeCommand": command}), flush=True)
        with stdout_path.open("x", encoding="utf-8") as stdout, stderr_path.open("x", encoding="utf-8") as stderr:
            completed = subprocess.run(command, cwd=source, text=True, encoding="utf-8", stdout=stdout, stderr=stderr)
        stdout_path.chmod(0o600)
        stderr_path.chmod(0o600)
        print(stdout_path.read_text(encoding="utf-8"), end="", flush=True)
        print(stderr_path.read_text(encoding="utf-8"), end="", file=sys.stderr, flush=True)
        journal = json.loads(journal_path.read_bytes()) if journal_path.exists() else {}
        result = {"operation": OPERATION, "exitCode": completed.returncode, "status": journal.get("status", "interrupted"),
                  "journal": str(journal_path) if journal_path.exists() else None,
                  "stdout": str(stdout_path), "stderr": str(stderr_path), **archive_result(root)}
        print(json.dumps(result), flush=True)
        return completed.returncode if completed.returncode else (0 if journal.get("status") == "complete" else 1)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", required=True, help="Exact native-merchant-source.json blob 02a73125")
    parser.add_argument("--directory", required=True, help="Existing ROOT from the original receiving driver")
    parser.add_argument("--node", default=shutil.which("node"))
    args = parser.parse_args()
    try:
        return continue_native(args)
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"operation": OPERATION, "status": "interrupted", "error": str(error)}), file=sys.stderr, flush=True)
        return 1

if __name__ == "__main__":
    sys.exit(main())
