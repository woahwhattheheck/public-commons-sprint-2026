"""MIT. Resume a complete dataset-job delivery and reconstruct its original projects."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from application import Workspace, InputError, load_json, json_bytes, private_write, file_digest
from workspace import regular

BUNDLE = "stellar-forge.ndjson-file-job-bundle.v1"
MAX_ARCHIVE = 64 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024
HASH = re.compile(r"[0-9a-f]{64}\Z")
RESERVED = {"customer-workspace", ".receiving-tmp", "receiving-source.json", "receiving.json"}


def name_checked(name):
    path = PurePosixPath(name)
    if (not name or name != path.as_posix() or path.is_absolute() or
        any(part in {".", ".."} for part in path.parts) or
        any(ord(character) < 32 for character in name) or "\\" in name or ":" in name or
        path.parts[0] in RESERVED):
        raise InputError("Delivery contains an invalid or reserved file path")
    return path


def write_original(archive, info, destination, temporary, expected):
    if destination.exists():
        if destination.is_symlink() or destination.stat().st_size != expected["bytes"] or file_digest(destination, MAX_EXPANDED) != expected["sha256"]:
            raise InputError("A received original file differs from the selected delivery")
        return
    relative = destination.parent.relative_to(temporary.parent)
    parent = temporary.parent
    for part in relative.parts:
        parent = parent / part
        parent.mkdir(mode=0o700, exist_ok=True)
        if parent.is_symlink() or not parent.is_dir():
            raise InputError("Receiving directories must be real directories")
    partial = temporary / hashlib.sha256(info.filename.encode("utf-8")).hexdigest()
    if partial.exists():
        regular(partial, MAX_EXPANDED)
        partial.unlink()
    size, digest = 0, hashlib.sha256()
    with archive.open(info) as source, os.fdopen(os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
        while block := source.read(1024 * 1024):
            size += len(block)
            if size > expected["bytes"]:
                raise InputError("Delivery member exceeds its declared byte count")
            digest.update(block)
            out.write(block)
        out.flush()
        os.fsync(out.fileno())
    if size != expected["bytes"] or digest.hexdigest() != expected["sha256"]:
        raise InputError("Delivery member differs from its original manifest")
    os.replace(partial, destination)


def receive(file: Path, directory: Path, expected_sha256=None):
    directory = directory.expanduser().absolute()
    file = file.expanduser().absolute()
    descriptor = os.open(file, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_ARCHIVE:
            raise InputError("Choose a complete dataset-job ZIP within 64 MiB")
        digest = hashlib.sha256()
        while block := stream.read(1024 * 1024):
            digest.update(block)
        identity = {"bytes": before.st_size, "sha256": digest.hexdigest()}
        if expected_sha256 is not None and identity["sha256"] != expected_sha256:
            raise InputError("Downloaded delivery differs from its selected result SHA-256")
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive:
            infos = archive.infolist()
            names = [item.filename for item in infos]
            if len(infos) > 4096 or len(set(names)) != len(names) or "manifest.json" not in names:
                raise InputError("Delivery must contain one complete original manifest")
            if sum(item.file_size for item in infos) > MAX_EXPANDED:
                raise InputError("Expanded delivery exceeds 512 MiB")
            for item in infos:
                name_checked(item.filename)
                if (item.is_dir() or item.flag_bits & 1 or stat.S_ISLNK(item.external_attr >> 16) or
                    item.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED} or
                    item.file_size > MAX_EXPANDED):
                    raise InputError("Delivery contains an unsupported ZIP entry")
            manifest_info = archive.getinfo("manifest.json")
            if manifest_info.file_size > 2 * 1024 * 1024:
                raise InputError("Delivery manifest exceeds 2 MiB")
            manifest_bytes = archive.read("manifest.json")
            manifest = load_json(manifest_bytes)
            if (not isinstance(manifest, dict) or manifest.get("schema") != BUNDLE or
                not isinstance(manifest.get("files"), dict) or
                set(names) != set(manifest["files"]) | {"manifest.json"}):
                raise InputError("Delivery does not match the complete dataset-job format")
            for name, item in manifest["files"].items():
                if (not isinstance(item, dict) or set(item) != {"bytes", "sha256"} or
                    type(item["bytes"]) is not int or item["bytes"] < 0 or
                    item["bytes"] != archive.getinfo(name).file_size or
                    not isinstance(item["sha256"], str) or not HASH.fullmatch(item["sha256"])):
                    raise InputError("Delivery contains an invalid original file identity")
            identity.update(schema="stellar-forge.ndjson-file-job-receiving-source.v1",
                            jobId=manifest["jobId"], attemptId=manifest["attemptId"],
                            manifestSha256=hashlib.sha256(manifest_bytes).hexdigest())
            directory.mkdir(mode=0o700, parents=False, exist_ok=True)
            info = directory.lstat()
            if directory.resolve() != directory or not stat.S_ISDIR(info.st_mode) or os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
                raise InputError("Choose a private operator-owned receiving directory")
            marker = directory / "receiving-source.json"
            if marker.exists():
                regular(marker, 65536)
                if load_json(marker.read_bytes()) != identity:
                    raise InputError("Receiving directory belongs to a different original delivery")
            elif any(directory.iterdir()):
                raise InputError("Choose an empty receiving directory")
            if not marker.exists():
                private_write(marker, json_bytes(identity))
            workspace_path = directory / "customer-workspace"
            with Workspace(workspace_path, create=not workspace_path.exists()) as workspace:
                temporary = directory / ".receiving-tmp"
                temporary.mkdir(mode=0o700, exist_ok=True)
                if temporary.is_symlink():
                    raise InputError("Receiving temporary directory changed")
                entries = {**manifest["files"], "manifest.json": {
                    "bytes": len(manifest_bytes), "sha256": identity["manifestSha256"]}}
                for name, expected in sorted(entries.items()):
                    write_original(archive, archive.getinfo(name), directory / name, temporary, expected)
                result = load_json((directory / "result.json").read_bytes())
                request = load_json((directory / "request.json").read_bytes())
                if (result.get("schema") != "stellar-forge.ndjson-file-job-result.v1" or
                    result.get("jobId") != identity["jobId"] or result.get("attemptId") != identity["attemptId"] or
                    result.get("status") != manifest.get("status") or
                    not isinstance(result.get("editions"), dict) or
                    set(result["editions"]) - {"source", "baseline"}):
                    raise InputError("Delivery result and original manifest disagree")
                received = {"schema": "stellar-forge.ndjson-file-job-receiving.v1", "source": identity,
                            "status": result["status"], "editions": {}, "comparison": None,
                            "issues": result.get("issues", [])}
                for slot, edition in result["editions"].items():
                    if edition.get("projectFile") != f"editions/{slot}/project.zip":
                        raise InputError("Delivery edition points outside its original project")
                    imported = workspace.import_packet(directory / edition["projectFile"])
                    if imported["build"]["id"] != edition["build"]["id"]:
                        raise InputError("Received project differs from its selected original build")
                    original_query = load_json((directory / f"editions/{slot}/query.json").read_bytes())
                    if original_query.get("response", {}).get("status") == 200:
                        params = load_json(request["input"].get("queryJson", '{"limit":"50"}'))
                        query = workspace.query(imported["build"]["id"], params)
                        if query["response"] != original_query["response"]:
                            raise InputError("Customer query differs from the original delivered query")
                    received["editions"][slot] = {"source": imported["source"], "plan": imported["plan"],
                        "build": imported["build"]["id"], "snapshot": imported["build"]["native"]["snapshot"],
                        "rows": imported["build"]["rowCount"], "reconstructed": True}
                if result.get("comparison"):
                    compared = workspace.compare(received["editions"]["baseline"]["build"],
                                                 received["editions"]["source"]["build"])
                    original = result["comparison"]["summary"]
                    if compared != original:
                        raise InputError("Customer comparison differs from the delivered complete comparison")
                    received["comparison"] = compared
            with Workspace(workspace_path) as reopened:
                for item in received["editions"].values():
                    if reopened.build_view(item["build"])["native"]["snapshot"] != item["snapshot"]:
                        raise InputError("Reopened customer workspace changed its received edition")
                received["workspaceReopened"] = True
                received["receivedBuilds"] = len({item["build"] for item in received["editions"].values()})
            after = os.fstat(stream.fileno())
            if any(getattr(before, key) != getattr(after, key) for key in ["st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns"]):
                raise InputError("Original delivery changed during receiving")
            output = directory / "receiving.json"
            body = json_bytes(received)
            if output.exists():
                regular(output, 2 * 1024 * 1024)
                if output.read_bytes() != body:
                    raise InputError("Existing receiving result differs from this reconstructed delivery")
            else:
                private_write(output, body)
            return received


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Receive a complete NDJSON dataset job and reopen its original projects")
    parser.add_argument("--file", required=True, type=Path)
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--sha256")
    args = parser.parse_args()
    try:
        print(json.dumps(receive(args.file, args.directory, args.sha256), ensure_ascii=False), flush=True)
    except (InputError, OSError, zipfile.BadZipFile) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr, flush=True)
        raise SystemExit(1)
