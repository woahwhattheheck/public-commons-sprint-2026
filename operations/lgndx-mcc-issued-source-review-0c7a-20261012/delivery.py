#!/usr/bin/env python3
"""Read the exact completed LGNDX delivery as the original MCC baseline."""
import hashlib, io, json, stat, zipfile
from pathlib import Path, PurePosixPath

BASELINE_REF = "8505a3ec99d584261754a2edcfca4113766dcc5b"
LIBRARY_FILE_ID = "libfile_518f91738b2c8191a2e9cc143b89cb07"
FILE_ID = "file_000000006fa881f59b5754acc3a68560"
DELIVERY = {
    "bytes": 6032266,
    "sha256": "ee1b02586058a80985672ffd160a6f88c84bcdd1ca1ea67879e28d4dd9bec5e3",
}
SOURCE_ARCHIVE = {
    "bytes": 233798,
    "sha256": "ec7b4967fc62ae3c30fb703b01bb1c91fcfffd6ad24c143f8f59854084a13596",
}
PORTABLE = {
    "bytes": 14822528,
    "sha256": "9512b0bf69c34748df36bdc08f8b2aa0b06117eaacbafb6d38e035f5dd797140",
}
SOURCE_FILES = 36
SOURCE_BYTES = 776223

def sha(body):
    return hashlib.sha256(body).hexdigest()

def git(body):
    return hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest()

def relative(value):
    if not isinstance(value, str):
        raise RuntimeError("A retained delivery path must be a string")
    path = PurePosixPath(value)
    if not value or path.is_absolute() or ".." in path.parts or str(path) != value:
        raise RuntimeError("A retained delivery path changed")
    return value

def entries(archive):
    result = {}
    for item in archive.infolist():
        name = item.filename[:-1] if item.is_dir() else item.filename
        relative(name)
        if item.filename in result:
            raise RuntimeError("A retained delivery member is duplicated")
        mode = item.external_attr >> 16
        if stat.S_ISLNK(mode):
            raise RuntimeError("Retained delivery members must be ordinary files")
        result[item.filename] = item
    return {name: item for name, item in result.items() if not item.is_dir()}

def matching_manifest(value):
    if not isinstance(value, dict) or not isinstance(value.get("files"), list):
        return False
    if len(value["files"]) != SOURCE_FILES:
        return False
    if any(not isinstance(item, dict) or type(item.get("bytes")) is not int
           for item in value["files"]):
        return False
    published = value.get("publishedSourceRef")
    return (published is None or published == BASELINE_REF) and sum(
        item["bytes"] for item in value["files"]) == SOURCE_BYTES

def read_sources(archive, members, manifest, nested=False):
    files = {}
    retained = []
    for item in manifest["files"]:
        if not isinstance(item, dict):
            raise RuntimeError("The retained source manifest changed")
        path = relative(item.get("path"))
        if path in files:
            raise RuntimeError("A retained source path is duplicated")
        size = item.get("bytes")
        if type(size) is not int or size < 0 or size > SOURCE_BYTES:
            raise RuntimeError("A retained source byte count changed")
        expected_sha = item.get("sha256")
        expected_git = item.get("git_blob")
        if not isinstance(expected_sha, str) or len(expected_sha) != 64:
            raise RuntimeError("A retained source SHA-256 is missing")
        if not isinstance(expected_git, str) or len(expected_git) != 40:
            raise RuntimeError("A retained source Git identity is missing")
        if nested:
            names = ["source/" + path] if "source/" + path in members else []
        else:
            names = sorted(name for name, info in members.items()
                           if info.file_size == size and (name == path or name.endswith("/" + path)))
        matches = []
        for name in names:
            body = archive.read(members[name])
            if len(body) == size and sha(body) == expected_sha and git(body) == expected_git:
                matches.append((name, body))
        if not matches:
            raise RuntimeError("The exact retained source is absent: " + path)
        body = matches[0][1]
        if any(other != body for _, other in matches):
            raise RuntimeError("The retained source selection is ambiguous: " + path)
        files[path] = body
        retained.append({"path": path, "member": matches[0][0], "bytes": size,
                         "sha256": expected_sha, "git_blob": expected_git})
    if len(files) != SOURCE_FILES or sum(map(len, files.values())) != SOURCE_BYTES:
        raise RuntimeError("The complete retained source closure changed")
    return files, retained

def read_delivery(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("The selected original delivery must be an ordinary file")
    body = path.read_bytes()
    if len(body) != DELIVERY["bytes"] or sha(body) != DELIVERY["sha256"]:
        raise RuntimeError("The exact completed LGNDX delivery changed")
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        members = entries(archive)
        portable_members = []
        for name, item in members.items():
            if item.file_size != PORTABLE["bytes"]:
                continue
            portable = archive.read(item)
            if len(portable) == PORTABLE["bytes"] and sha(portable) == PORTABLE["sha256"]:
                portable_members.append(name)
        if len(portable_members) != 1:
            raise RuntimeError("The unique original revision-133 portable is absent")
        nested_sources = []
        for name, item in members.items():
            if item.file_size != SOURCE_ARCHIVE["bytes"]:
                continue
            candidate = archive.read(item)
            if sha(candidate) == SOURCE_ARCHIVE["sha256"]:
                nested_sources.append((name, candidate))
        if len(nested_sources) > 1:
            raise RuntimeError("The retained source archive is duplicated")
        if nested_sources:
            source_member, raw_source = nested_sources[0]
            with zipfile.ZipFile(io.BytesIO(raw_source)) as source:
                source_members = entries(source)
                manifest_raw = source.read("SOURCE_MANIFEST.json")
                manifest = json.loads(manifest_raw)
                if not matching_manifest(manifest):
                    raise RuntimeError("The retained source edition changed")
                files, retained = read_sources(source, source_members, manifest, nested=True)
            manifest_member = source_member + "!/SOURCE_MANIFEST.json"
            source_mode = "original_source_archive"
        else:
            candidates = []
            for name, item in members.items():
                if not name.lower().endswith(".json") or item.file_size > 262144:
                    continue
                raw = archive.read(item)
                try:
                    value = json.loads(raw)
                except (ValueError, UnicodeError):
                    continue
                if matching_manifest(value):
                    candidates.append((name, raw, value))
            if len(candidates) != 1:
                raise RuntimeError("The unique retained source manifest is absent")
            manifest_member, manifest_raw, manifest = candidates[0]
            files, retained = read_sources(archive, members, manifest)
            source_mode = "retained_source_files"
    return {
        "manifest": manifest,
        "files": files,
        "handoff": {"path": str(path), **DELIVERY, "kind": "completed_lgndx_delivery",
                    "library_file_id": LIBRARY_FILE_ID, "file_id": FILE_ID},
        "portable": {"member": portable_members[0], **PORTABLE},
        "source_receipt": {
            "kind": source_mode, "library_file_id": LIBRARY_FILE_ID, "file_id": FILE_ID,
            "bytes": DELIVERY["bytes"], "sha256": DELIVERY["sha256"],
            "source_ref": BASELINE_REF, "source_manifest_member": manifest_member,
            "source_manifest_sha256": sha(manifest_raw), "source_files": SOURCE_FILES,
            "source_bytes": SOURCE_BYTES, "members": retained,
        },
    }
