#!/usr/bin/env python3
"""Receive the retained GIS source and customer, then run their original operation."""
from __future__ import annotations

import argparse
import ast
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import tempfile
import tomllib
import urllib.request
import zipfile

OPERATION = "SCF-DUCKDB-GIS-CUSTOMER-5EEE-20261012"
SOURCE_COMMIT = "ba078c26cf05dda1f44044eaaecb948971caaae9"
SOURCE_SHA256 = "6cb31aecf95d5a4b6eafb3879066e80332dbcb8c0b2f552dec029f1d3f2ece66"
CUSTOMER_SHA256 = "50ea5a14216db46bdb8d31980ce9d7fc7f45cd4897184a3befa88ed72004f369"
WAREHOUSE_SHA256 = "aa7182fee4cbfc5dd4e56468bab2ab5734682f2db5af0adc79884f9e310ee656"
CUSTOMER_ROOT = "SCF_DuckDB_Customer_Receiving_20261012"
EXTENSION_URL = "https://extensions.duckdb.org/v1.5.6/linux_amd64/spatial.duckdb_extension.gz"


def private(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("Receiving directory must be private: " + str(path))
    return path


def identity(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise RuntimeError("Expected a regular source file")
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
        after = os.fstat(stream.fileno())
        if (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
            raise RuntimeError("Source changed during receiving")
        return {"bytes": info.st_size, "sha256": digest}


def publish(path, content):
    private(path.parent)
    if path.exists() or path.is_symlink():
        if identity(path) != {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}:
            raise RuntimeError("Existing receiving source differs: " + str(path))
        return
    fd, temporary = tempfile.mkstemp(prefix=".source-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path, follow_symlinks=False)
    finally:
        os.unlink(temporary)


def save(path, value):
    private(path.parent)
    if path.exists():
        before = json.loads(path.read_text())
        if before.get("operation") != OPERATION:
            raise RuntimeError("Receiving record belongs to another operation")
    fd, temporary = tempfile.mkstemp(prefix=".record-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def relative(name):
    path = PurePosixPath(name)
    if not name or "\\" in name or path.is_absolute() or ".." in path.parts or str(path) != name.rstrip("/"):
        raise RuntimeError("Invalid receiving member path")
    return path


def receive_source(capsule, package):
    if identity(capsule) != {"bytes": 1450855, "sha256": SOURCE_SHA256}:
        raise RuntimeError("Original source capsule differs")
    payload = json.loads(capsule.read_text(encoding="utf-8"))
    if (payload.get("schema"), payload.get("operation_id"), payload.get("repository"), payload.get("source_commit")) != (
            "scf.portable-python-source/1", OPERATION, "woahwhattheheck/public-commons-sprint-2026", SOURCE_COMMIT):
        raise RuntimeError("Original source identity differs")
    files = payload["files"]
    if len(files) != 67 or len({item["path"] for item in files}) != 67:
        raise RuntimeError("Complete original source inventory required")
    for item in files:
        name = relative(item["path"])
        raw = item["content"].encode("utf-8")
        if item["encoding"] != "utf-8" or len(raw) != item["bytes"] or hashlib.sha256(raw).hexdigest() != item["sha256"]:
            raise RuntimeError("Source file digest differs")
        if hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() != item["git_blob_sha"]:
            raise RuntimeError("Source Git blob differs")
        if name.suffix == ".py":
            ast.parse(item["content"], filename=item["path"])
        publish(package / str(name), raw)
    project = tomllib.loads((package / "pyproject.toml").read_text())
    if "duckdb==1.5.6" not in project["project"]["optional-dependencies"]["duckdb"]:
        raise RuntimeError("Pinned native engine declaration differs")
    return {"commit": SOURCE_COMMIT, "capsule": identity(capsule), "files": len(files)}


def receive_customer(archive, destination):
    if identity(archive) != {"bytes": 282686, "sha256": CUSTOMER_SHA256}:
        raise RuntimeError("Original customer archive differs")
    with zipfile.ZipFile(archive) as source:
        members = source.infolist()
        if len(members) != 48 or len({item.filename for item in members}) != 48:
            raise RuntimeError("Original customer member inventory differs")
        if sum(item.file_size for item in members) > 512 * 1024 * 1024:
            raise RuntimeError("Customer archive exceeds receiving budget")
        for item in members:
            name = relative(item.filename)
            mode = item.external_attr >> 16
            if name.parts[0] != CUSTOMER_ROOT or stat.S_ISLNK(mode) or item.flag_bits & 1:
                raise RuntimeError("Invalid original customer member")
            target = destination / str(name)
            if item.is_dir():
                private(target)
            else:
                publish(target, source.read(item))
    original = destination / CUSTOMER_ROOT / "arcgis" / "workspace"
    record = identity(original / "warehouse.duckdb")
    if record != {"bytes": 11808768, "sha256": WAREHOUSE_SHA256}:
        raise RuntimeError("Original closed ArcGIS warehouse differs")
    return original, {"archive": identity(archive), "warehouse": record, "members": len(members)}


def engine(python):
    try:
        result = subprocess.run([python, "-B", "-c",
            "import sys,duckdb,json; print(json.dumps({'python':sys.version.split()[0],'duckdb':duckdb.__version__}))"],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30)
        value = json.loads(result.stdout)
        if result.returncode == 0 and value.get("duckdb") == "1.5.6" and tuple(map(int, value["python"].split(".")[:2])) >= (3, 11):
            return value
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return None


def download_extension(target):
    private(target.parent)
    if target.exists():
        return identity(target)
    request = urllib.request.Request(EXTENSION_URL, headers={"Accept-Encoding": "identity"})
    fd, temporary = tempfile.mkstemp(prefix=".spatial-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as output, urllib.request.urlopen(request, timeout=180) as response:
            if response.status != 200 or not response.geturl().startswith("https://extensions.duckdb.org/"):
                raise RuntimeError("Official extension response differs")
            declared = response.headers.get("Content-Length")
            total = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > 128 * 1024 * 1024:
                    raise RuntimeError("Compressed extension exceeds receiving budget")
                output.write(chunk)
            if not total or (declared is not None and total != int(declared)):
                raise RuntimeError("Incomplete official extension")
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, target, follow_symlinks=False)
        return identity(target)
    finally:
        os.unlink(temporary)


def unpack_extension(compressed, target):
    fd, temporary = tempfile.mkstemp(prefix=".extension-", dir=target.parent)
    try:
        total = 0
        with os.fdopen(fd, "wb") as output, gzip.open(compressed, "rb") as source:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > 512 * 1024 * 1024:
                    raise RuntimeError("Spatial extension exceeds receiving budget")
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        record = identity(Path(temporary))
        if target.exists() or target.is_symlink():
            if identity(target) != record:
                raise RuntimeError("Existing signed extension differs")
        else:
            os.link(temporary, target, follow_symlinks=False)
        return record
    finally:
        os.unlink(temporary)


def deliver(root, package, original_archive, extension, compressed, capsule):
    """Retain the complete received product after its native processes have closed."""
    selected = {}
    for base, prefix in ((package, "python"), (root / "operation", "operation")):
        for directory, directories, filenames in os.walk(base, followlinks=False):
            for name in directories:
                if (Path(directory) / name).is_symlink():
                    raise RuntimeError("Delivery directory changed to a link")
            for name in filenames:
                path = Path(directory) / name
                if name.endswith(".lock") or name in {".lock", "duckdb-launch.json"}:
                    continue
                selected[prefix + "/" + path.relative_to(base).as_posix()] = path
    selected["inputs/" + original_archive.name] = original_archive
    selected["receiving/source-capsule.json"] = capsule
    for name in ("native_spatial_receive.py", "native_spatial_foreground.py", "native_spatial_setup.py", "NATIVE_GIS_RECEIVING.md"):
        helper = Path(__file__).parent / name
        if helper.exists():
            selected["receiving/" + name] = helper
    selected["runtime/" + ("spatial.duckdb_extension.gz" if compressed else "spatial.duckdb_extension")] = compressed or extension
    records = [{"name": name, **identity(path)} for name, path in sorted(selected.items())]
    native = json.loads((root / "operation" / "native-gis-result.json").read_text())
    if native.get("state") != "COMPLETE" or native.get("operation") != OPERATION:
        raise RuntimeError("Complete original native result is required for delivery")
    manifest = {"schema": "stellar-forge.duckdb-gis.received-product.v1", "operation": OPERATION,
                "source_commit": SOURCE_COMMIT, "source_capsule_sha256": SOURCE_SHA256,
                "original_customer_sha256": CUSTOMER_SHA256, "signed_extension": identity(extension),
                "duckdb": "1.5.6", "files": records}
    raw_manifest = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
    content_id = hashlib.sha256(raw_manifest).hexdigest()
    destination = private(root / "delivery")
    archive = destination / ("SCF_DuckDB_GIS_Customer_" + content_id[:16] + ".zip")
    manifest_path = destination / ("SCF_DuckDB_GIS_Customer_" + content_id[:16] + ".json")
    if archive.exists():
        if manifest_path.read_bytes() != raw_manifest:
            raise RuntimeError("Existing GIS delivery inventory differs")
        with zipfile.ZipFile(archive) as existing:
            if existing.read("manifest.json") != raw_manifest or existing.testzip() is not None:
                raise RuntimeError("Existing GIS delivery differs")
        return {"path": str(archive), **identity(archive), "manifest_sha256": content_id, "reused": True}
    fd, temporary = tempfile.mkstemp(prefix=".delivery-", dir=destination)
    os.close(fd)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
            for record in records:
                path = selected[record["name"]]
                item = zipfile.ZipInfo(record["name"], date_time=(1980, 1, 1, 0, 0, 0))
                item.external_attr = (stat.S_IFREG | 0o600) << 16
                item.compress_type = zipfile.ZIP_STORED if path.name.endswith(".gz") else zipfile.ZIP_DEFLATED
                count, digest = 0, hashlib.sha256()
                source_fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(source_fd, "rb") as source, output.open(item, "w", force_zip64=True) as member:
                    while True:
                        chunk = source.read(1024 * 1024)
                        if not chunk:
                            break
                        count += len(chunk)
                        digest.update(chunk)
                        member.write(chunk)
                if count != record["bytes"] or digest.hexdigest() != record["sha256"]:
                    raise RuntimeError("GIS delivery source changed during capture")
            output.writestr("manifest.json", raw_manifest)
        with open(temporary, "rb") as complete:
            os.fsync(complete.fileno())
        os.link(temporary, archive, follow_symlinks=False)
        publish(manifest_path, raw_manifest)
    finally:
        os.unlink(temporary)
    return {"path": str(archive), **identity(archive), "manifest_sha256": content_id, "files": len(records)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--source-capsule", required=True)
    parser.add_argument("--customer-zip", required=True)
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--install-runtime", action="store_true")
    parser.add_argument("--spatial-gzip")
    parser.add_argument("--spatial-extension")
    parser.add_argument("--acquire-spatial", action="store_true")
    parser.add_argument("--chromium")
    parser.add_argument("--node")
    parser.add_argument("--playwright")
    args = parser.parse_args()
    root = private(Path(args.root).absolute())
    result = {"schema": "stellar-forge.duckdb-gis.receiving.v1", "operation": OPERATION,
              "source_commit": SOURCE_COMMIT, "started_at": datetime.now(timezone.utc).isoformat()}
    try:
        package = private(root / "python")
        result["source"] = receive_source(Path(args.source_capsule), package)
        original, result["customer"] = receive_customer(Path(args.customer_zip), private(root / "customer"))
        python = args.python
        runtime = engine(python)
        if runtime is None and args.install_runtime:
            venv = root / "runtime" / "python"
            private(venv.parent)
            if not (venv / "bin" / "python").exists():
                subprocess.run([python, "-m", "venv", str(venv)], check=True, timeout=120)
            python = str(venv / "bin" / "python")
            if engine(python) is None:
                subprocess.run([python, "-m", "pip", "--disable-pip-version-check", "install",
                                "--no-input", "--no-cache-dir", "--only-binary=:all:", "duckdb==1.5.6"],
                               check=True, timeout=600)
            runtime = engine(python)
        if runtime is None:
            raise RuntimeError("Python3.11+ with DuckDB1.5.6 is required")
        result["runtime"] = {"executable": python, **runtime}
        native_directory = private(root / "runtime")
        compressed = None
        if args.spatial_extension:
            extension = Path(args.spatial_extension).absolute()
        else:
            compressed = Path(args.spatial_gzip) if args.spatial_gzip else native_directory / "spatial.duckdb_extension.gz"
            if not compressed.exists():
                if not args.acquire_spatial:
                    raise RuntimeError("Original signed spatial extension is required")
                download_extension(compressed)
            result["compressed_extension"] = {"source_url": EXTENSION_URL, **identity(compressed)}
            extension = native_directory / "spatial.duckdb_extension"
            unpack_extension(compressed, extension)
        result["extension"] = {"path": str(extension), **identity(extension)}
        signed_load = subprocess.run([python, "-B", "-c",
            "import duckdb,sys; c=duckdb.connect(); c.execute(\"LOAD '\"+sys.argv[1].replace(\"'\",\"''\")+\"'\"); print(duckdb.__version__)",
            str(extension)], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=90)
        if signed_load.returncode:
            raise RuntimeError("Native signed extension LOAD failed: " + signed_load.stderr[-5000:])
        result["signed_load"] = signed_load.stdout.strip()
        if args.node:
            subprocess.run([args.node, "--check", str(package / "examples" / "native_spatial_browser.mjs")],
                           check=True, timeout=30)
        operation = private(root / "operation")
        command = [python, "-B", str(package / "examples" / "native_spatial_operation.py"),
                   "--package", str(package), "--original-workspace", str(original),
                   "--operation-dir", str(operation), "--spatial-extension", str(extension)]
        for name in ("chromium", "node", "playwright"):
            value = getattr(args, name)
            if value:
                command.extend(["--" + name, value])
        result.update(state="RECEIVED", command=command)
        save(root / "receiving.json", result)
        print(json.dumps({"state": "RECEIVED", "record": str(root / "receiving.json")}), flush=True)
        completed = subprocess.run(command)
        result.update(state="COMPLETE" if completed.returncode == 0 else "INTERRUPTED",
                      exit_code=completed.returncode, native_result=str(operation / "native-gis-result.json"),
                      finished_at=datetime.now(timezone.utc).isoformat())
        if completed.returncode == 0:
            result["delivery"] = deliver(root, package, Path(args.customer_zip), extension, compressed, Path(args.source_capsule))
        save(root / "receiving.json", result)
        print(json.dumps({"state": result["state"], "record": str(root / "receiving.json"),
                          "delivery": result.get("delivery")}), flush=True)
        return completed.returncode
    except Exception as error:
        result.update(state="INTERRUPTED", error={"type": type(error).__name__, "detail": str(error)},
                      updated_at=datetime.now(timezone.utc).isoformat())
        save(root / "receiving.json", result)
        print(json.dumps({"state": "INTERRUPTED", "record": str(root / "receiving.json"), "error": result["error"]}), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
