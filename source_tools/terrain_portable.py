"""Complete terrain data packets: retained originals, outputs and editable plan."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import zipfile

from .terrain_io import (TerrainError, atomic_json, canonical, describe, file_sha,
                         identity, read_json, relative_path, sync_directory, verify, publish_directory)
from .terrain_prepare import _plan

HEADER = "terrain-package.json"
SCHEMA = "upstate.terrain-package/v1"


def packet_members(root, plan_id):
    root = Path(root).resolve()
    _plan(root, plan_id)
    manifest = root/("sources-"+plan_id+".json")
    selected = read_json(manifest)
    if selected.get("schema") != "upstate.sources/v1" or len(selected.get("entries", [])) != 1:
        raise TerrainError("Select a completed terrain source manifest")
    entry = selected["entries"][0]
    if entry.get("preparation_sha256") != plan_id:
        raise TerrainError("Source manifest belongs to a different terrain plan")
    result = {manifest.name: describe(root, manifest)}
    for member in [entry] + entry["companions"]:
        path = verify(root, member)
        value = describe(root, path)
        if value["path"] in result and result[value["path"]] != value:
            raise TerrainError("Conflicting terrain packet members")
        result[value["path"]] = value
    return sorted(result.values(), key=lambda item: item["path"])


def pack(root, plan_id, destination):
    """Write a create-only ZIP64 packet; transient chunks/caches are unnecessary."""
    root, destination = Path(root).resolve(), Path(destination).absolute()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise TerrainError("Choose a new terrain packet filename")
    members = packet_members(root, plan_id)
    total = sum(member["bytes"] for member in members)
    if shutil.disk_usage(destination.parent).free < total + 16*1024*1024:
        raise OSError("Insufficient output space for a complete terrain packet")
    header = {"schema": SCHEMA, "plan_id":plan_id, "files":members,
              "source_manifest":"sources-"+plan_id+".json",
              "source_entry":"source-entry-"+plan_id+".json",
              "complete_originals":True,
              "receiving":"Create a separate independently editable terrain store; reuse original Workspace.import_sources"}
    header["content_sha256"] = identity(header)
    fd, name = tempfile.mkstemp(prefix=".terrain-packet-", suffix=".zip", dir=destination.parent)
    os.close(fd)
    pending = Path(name)
    try:
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6,
                             allowZip64=True, strict_timestamps=False) as archive:
            archive.writestr(HEADER, canonical(header))
            for member in members:
                source = verify(root, member)
                # Stream from the retained source; do not hold national rasters in RAM.
                info = zipfile.ZipInfo(member["path"], date_time=(1980,1,1,0,0,0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                h, count = hashlib.sha256(), 0
                with source.open("rb") as stream, archive.open(info, "w", force_zip64=True) as out:
                    for block in iter(lambda:stream.read(1024*1024), b""):
                        out.write(block)
                        h.update(block)
                        count += len(block)
                if count != member["bytes"] or h.hexdigest() != member["sha256"]:
                    raise TerrainError("Original source changed during packet writing: "+member["path"])
        with pending.open("rb") as stream:
            os.fsync(stream.fileno())
        os.link(pending, destination)
        sync_directory(destination.parent)
    finally:
        pending.unlink(missing_ok=True)
    return {"packet":str(destination), "bytes":destination.stat().st_size, "sha256":file_sha(destination),
            "content_sha256":header["content_sha256"], "plan_id":plan_id,
            "files":len(members), "uncompressed_bytes":total}


def _checked_header(archive):
    infos = archive.infolist()
    if len({item.filename for item in infos}) != len(infos):
        raise TerrainError("Duplicate terrain archive members")
    by_name = {item.filename:item for item in infos}
    if HEADER not in by_name or by_name[HEADER].file_size > 16*1024*1024:
        raise TerrainError("Missing or oversized terrain package descriptor")
    header = json.loads(archive.read(HEADER))
    expected = header.pop("content_sha256", None)
    if header.get("schema") != SCHEMA or identity(header) != expected:
        raise TerrainError("Terrain package descriptor differs")
    header["content_sha256"] = expected
    if not isinstance(header.get("files"), list) or not header["files"]:
        raise TerrainError("Terrain package has no original files")
    names = {item["path"] for item in header["files"]}
    if len(names) != len(header["files"]) or names | {HEADER} != set(by_name):
        raise TerrainError("Terrain archive and its complete file inventory disagree")
    if header.get("source_manifest") not in names or header.get("source_entry") not in names:
        raise TerrainError("Terrain package lacks its native source manifest or entry")
    for record in header["files"]:
        info = by_name[record["path"]]
        mode = info.external_attr >> 16
        if (info.is_dir() or stat.S_ISLNK(mode) or (mode and stat.S_IFMT(mode) not in (0,stat.S_IFREG))
                or info.flag_bits & 1 or info.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED)):
            raise TerrainError("Unsupported terrain package member type")
        if (isinstance(record["bytes"],bool) or not isinstance(record["bytes"],int) or record["bytes"] < 0
                or info.file_size != record["bytes"]):
            raise TerrainError("Terrain package member length disagrees")
        digest = record["sha256"]
        if len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
            raise TerrainError("Invalid terrain package member hash")
    return header


def receive(archive_path, destination, *, expected_sha256=None):
    """Verify every retained byte and publish a complete create-only receiving."""
    archive_path, destination = Path(archive_path).resolve(strict=True), Path(destination).absolute()
    if expected_sha256 and file_sha(archive_path) != expected_sha256:
        raise TerrainError("Terrain packet differs from the sender's selected SHA-256")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise TerrainError("Receive a terrain project into a new directory")
    staging = Path(tempfile.mkdtemp(prefix=".terrain-receive-", dir=destination.parent))
    try:
        with zipfile.ZipFile(archive_path) as archive:
            header = _checked_header(archive)
            # Validate all paths before extracting any original body.
            for record in header["files"]:
                relative_path(staging, record["path"], exists=False)
            total = sum(record["bytes"] for record in header["files"])
            if shutil.disk_usage(staging).free < total + 16*1024*1024:
                raise OSError("Insufficient space to receive every original terrain file")
            for record in header["files"]:
                target = relative_path(staging, record["path"], exists=False)
                target.parent.mkdir(parents=True, exist_ok=True)
                h, count = hashlib.sha256(), 0
                with archive.open(record["path"]) as src, target.open("xb") as out:
                    for block in iter(lambda:src.read(1024*1024),b""):
                        count += len(block)
                        if count > record["bytes"]:
                            raise TerrainError("Terrain archive member exceeds its declared length")
                        out.write(block)
                        h.update(block)
                    out.flush()
                    os.fsync(out.fileno())
                if count != record["bytes"] or h.hexdigest() != record["sha256"]:
                    raise TerrainError("Terrain archive member differs: "+record["path"])
        # Validate the original plan and complete manifest relationships before publication.
        _plan(staging, header["plan_id"])
        actual_members = packet_members(staging, header["plan_id"])
        if actual_members != header["files"]:
            raise TerrainError("Received source manifest differs from the sender's file closure")
        atomic_json(staging/HEADER,header,immutable=True)
        publish_directory(staging,destination)
        return {"state":"received", "directory":str(destination), "plan_id":header["plan_id"],
                "manifest":str(destination/header["source_manifest"]), "files":len(actual_members),
                "uncompressed_bytes":total, "content_sha256":header["content_sha256"]}
    finally:
        shutil.rmtree(staging,ignore_errors=True)
