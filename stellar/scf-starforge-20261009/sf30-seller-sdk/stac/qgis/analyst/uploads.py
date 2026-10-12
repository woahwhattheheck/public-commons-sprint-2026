# SPDX-License-Identifier: MIT
"""Resumable exact-byte intake into one original analyst workspace."""
from __future__ import annotations
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import tempfile
import uuid

from starforge_stac.model import (require, member, relative_name, descriptor, read_json,
    json_bytes, retain_bytes, file_digest, HASH, REQUEST)

UPLOAD_SCHEMA = "starforge.stac-qgis-analyst-upload.v1"
MAX_CHUNK = 8 * 1024 * 1024
MAX_UPLOAD = 1024 ** 4


class Uploads:
    def __init__(self, workspace):
        self.workspace = workspace

    def root(self, identity):
        require(isinstance(identity, str) and REQUEST.fullmatch(identity),
                "ANALYST_UPLOAD_ID", "Use the original upload identity.")
        root = member(self.workspace.root, "analyst/uploads/" + identity + "/manifest.json", existing=False).parent
        return root

    @contextmanager
    def lock(self, identity):
        import fcntl
        root = self.root(identity)
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd = os.open(root / "upload.lock", os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield root
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)

    def create(self, value):
        require(isinstance(value, dict) and set(value) <= {"uploadId", "kind", "files"},
                "ANALYST_UPLOAD", "Use a complete upload manifest.")
        identity = value.get("uploadId")
        require(value.get("kind") in ("source", "project", "field") and isinstance(value.get("files"), list) and
                0 < len(value["files"]) <= 100000, "ANALYST_UPLOAD",
                "Select an original source folder, returned field folder or one complete project ZIP.")
        files, seen, total = [], set(), 0
        for raw in value["files"]:
            require(isinstance(raw, dict) and set(raw) <= {"path", "bytes", "sha256"},
                    "ANALYST_UPLOAD_FILE", "Retain each file's relative name and exact byte count.")
            name = relative_name(raw.get("path"))
            require(name not in seen and type(raw.get("bytes")) is int and 0 <= raw["bytes"] <= MAX_UPLOAD,
                    "ANALYST_UPLOAD_FILE", "Each original upload file must have a unique path and supported size.")
            require(raw.get("sha256") is None or isinstance(raw["sha256"], str) and HASH.fullmatch(raw["sha256"]),
                    "ANALYST_UPLOAD_HASH", "Use the original SHA-256 when one is available.")
            seen.add(name)
            files.append({"path": name, "bytes": raw["bytes"], "sha256": raw.get("sha256")})
            total += raw["bytes"]
        for name in seen:
            parent = name.rpartition("/")[0]
            while parent:
                require(parent not in seen, "ANALYST_UPLOAD_FILE",
                        "An upload file cannot also be another member's directory.", path=name, parent=parent)
                parent = parent.rpartition("/")[0]
        require(total <= MAX_UPLOAD, "ANALYST_UPLOAD_SIZE", "This upload exceeds the supported one-terabyte file set.")
        if value["kind"] == "project":
            require(len(files) == 1 and files[0]["path"].lower().endswith(".zip"),
                    "ANALYST_PROJECT_UPLOAD", "Select one complete original project archive.")
        elif value["kind"] == "source":
            require(bool({"qgis-receiving.json", "vector-export.json", "postgis-receiving.json"} & seen),
                    "ANALYST_SOURCE_UPLOAD", "Select the complete original receiving folder, including its manifest.")
        manifest = {"schema": UPLOAD_SCHEMA, "uploadId": identity, "kind": value["kind"],
                    "workspaceId": self.workspace.read()["id"], "files": files, "totalBytes": total}
        with self.lock(identity) as root:
            retain_bytes(root, "manifest.json", json_bytes(manifest))
            if manifest["kind"] == "field":
                base = member(self.workspace.root.parent, self.workspace.root.name + "-field-intake/.location", existing=False).parent
                base.mkdir(mode=0o700, exist_ok=True)
                require(not (base.stat().st_mode & 0o077), "ANALYST_UPLOAD_PRIVATE",
                        "Keep the returned field intake private.")
                (base / identity).mkdir(mode=0o700, exist_ok=True)
            self.content_root(manifest).mkdir(mode=0o700, parents=True, exist_ok=True)
        return self.status(identity)

    def manifest(self, identity):
        value, _ = read_json(self.root(identity) / "manifest.json", limit=32 * 1024 * 1024)
        require(value.get("schema") == UPLOAD_SCHEMA and
                value.get("workspaceId") == self.workspace.read()["id"],
                "ANALYST_UPLOAD_IDENTITY", "The upload belongs to another original workspace.")
        return value


    def content_root(self, manifest):
        identity = manifest["uploadId"]
        if manifest["kind"] == "field":
            # Original field receiving takes a saved device copy outside the active office.
            # Only our own retained upload identity selects this private sibling directory.
            name = self.workspace.root.name + "-field-intake/" + identity + "/content"
            root = member(self.workspace.root.parent, name + "/.location", existing=False).parent
        else:
            root = self.root(identity) / "content"
        return root

    def status(self, identity):
        manifest = self.manifest(identity)
        complete_path = self.root(identity) / "completed.json"
        complete = read_json(complete_path)[0] if complete_path.is_file() else None
        files = []
        for raw in manifest["files"]:
            path = member(self.content_root(manifest), raw["path"], existing=False)
            size = path.stat().st_size if path.is_file() else 0
            require(size <= raw["bytes"], "ANALYST_UPLOAD_SIZE", "An uploaded file exceeds its original size.")
            files.append({**raw, "offset": size})
        return {**manifest, "files": files, "completed": complete}

    def chunk(self, identity, name, offset, body, expected_chunk_sha):
        require(type(offset) is int and offset >= 0 and isinstance(body, bytes) and
                len(body) <= MAX_CHUNK and HASH.fullmatch(expected_chunk_sha or ""),
                "ANALYST_UPLOAD_CHUNK", "Use the exact offset and SHA-256 for this byte chunk.")
        require(hashlib.sha256(body).hexdigest() == expected_chunk_sha,
                "ANALYST_UPLOAD_CHUNK_HASH", "The byte chunk differs from its transfer identity.")
        with self.lock(identity) as root:
            manifest = self.manifest(identity)
            row = next((item for item in manifest["files"] if item["path"] == name), None)
            require(row is not None, "ANALYST_UPLOAD_FILE", "This file is not in the original upload manifest.")
            path = member(self.content_root(manifest), name, existing=False)
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            size = path.stat().st_size if path.exists() else 0
            require(offset <= size and offset + len(body) <= row["bytes"],
                    "ANALYST_UPLOAD_OFFSET", "Resume from the actual retained byte offset.", offset=size)
            if offset < size:
                require(offset + len(body) <= size, "ANALYST_UPLOAD_OFFSET",
                        "A retried chunk crosses the retained byte boundary.", offset=size)
                with path.open("rb") as source:
                    source.seek(offset)
                    require(source.read(len(body)) == body, "ANALYST_UPLOAD_REPLAY_CHANGED",
                            "This prior byte range belongs to a different original chunk.")
            else:
                require(not (root / "completed.json").exists(), "ANALYST_UPLOAD_COMPLETED",
                        "Reopen the completed original upload.")
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0), 0o600)
                with os.fdopen(fd, "ab") as target:
                    target.write(body)
                    target.flush()
                    os.fsync(target.fileno())
                size = offset + len(body)
            return {"uploadId": identity, "path": name, "offset": size, "bytes": row["bytes"]}

    def finish(self, identity):
        with self.lock(identity) as root:
            manifest = self.manifest(identity)
            if (root / "completed.json").is_file():
                result, _ = read_json(root / "completed.json")
                for row in result["files"]:
                    file_digest(member(self.content_root(manifest), row["path"]), expected=row)
                return result
            files = []
            for raw in manifest["files"]:
                path = member(self.content_root(manifest), raw["path"], existing=False)
                if raw["bytes"] == 0 and not path.exists():
                    retain_bytes(self.content_root(manifest), raw["path"], b"")
                measured = file_digest(path)
                require(measured["bytes"] == raw["bytes"] and
                        (raw.get("sha256") is None or measured["sha256"] == raw["sha256"]),
                        "ANALYST_UPLOAD_FILE_HASH", "An original upload file is incomplete or changed.",
                        path=raw["path"])
                files.append({"path": raw["path"], **measured})
            result = {"uploadId": identity, "kind": manifest["kind"],
                      "directory": str(self.content_root(manifest)), "files": files}
            if manifest["kind"] == "project":
                result.update(file=str(self.content_root(manifest) / files[0]["path"]), sha256=files[0]["sha256"])
            retain_bytes(root, "completed.json", json_bytes(result))
            return result
