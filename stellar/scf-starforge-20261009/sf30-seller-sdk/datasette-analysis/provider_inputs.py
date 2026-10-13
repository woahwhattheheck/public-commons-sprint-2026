"""Retain complete browser-selected files for the installed provider workflows.

This intake owns raw bytes and resumable transport only. The original provider
receivers, preparation CLIs and Workflow/Analysis importers validate and apply
the selected source. Completed inputs never replace an earlier input.
"""
from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile

from workflow_engine import WorkflowError, atomic_json, canonical, digest, file_descriptor, now, read_json

SCHEMA = "stellar-forge.provider-input.v1"
REQUEST_SCHEMA = "stellar-forge.provider-input-intent.v1"
CHUNK_BYTES = 8 * 1024 * 1024
COPY_BYTES = 1024 * 1024
KINDS = {"provider-handover", "handover", "contacts", "native-result", "native-delivery", "decisions"}
IDENTIFIER = re.compile(r"received-[a-f0-9]{32}")
SHA256 = re.compile(r"[a-f0-9]{64}")


def need(value, code, message):
    if not value:
        raise WorkflowError("PROVIDER_INPUT_" + code, message)


def identifier(value):
    need(isinstance(value, str) and IDENTIFIER.fullmatch(value),
         "ID", "Retain the original received- followed by 32 hexadecimal characters.")
    return value


def plain_name(value):
    need(isinstance(value, str) and value not in {"", ".", ".."} and len(value.encode("utf-8")) <= 240
         and "/" not in value and "\\" not in value
         and all(ord(c) >= 32 and ord(c) != 127 for c in value),
         "NAME", "Use the original plain filename, without a directory.")
    return value


def regular(path):
    path = Path(path)
    need(path.absolute() == path.resolve(strict=True), "PATH", "Retain the original private source path.")
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "FILE", "Retain an ordinary original input file.")
    return path


def directory(path, *, create=False):
    path = Path(path).expanduser().absolute()
    if create:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
    need(path.resolve(strict=True) == path and stat.S_ISDIR(path.lstat().st_mode),
         "DIRECTORY", "Use the original private input directory.")
    return path


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class ProviderInputs:
    """One original workflow workspace's immutable inputs and pending uploads."""

    def __init__(self, workspace, workspace_id):
        self.workspace = directory(workspace)
        need(isinstance(workspace_id, str) and workspace_id, "WORKSPACE", "Select the original workflow workspace.")
        self.workspace_id = workspace_id
        self.root = directory(self.workspace / "provider-workflows" / "received-inputs", create=True)

    def _root(self, ident, *, create=False):
        path = self.root / identifier(ident)
        need(create or path.exists() or path.is_symlink(), "NOT_FOUND",
             "This original input is not present in the selected workspace.")
        return directory(path, create=create)

    @contextmanager
    def _lock(self, ident, *, create=False):
        root = self._root(ident, create=create)
        fd = os.open(root / "input.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(fd)
            need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "LOCK", "Use the original private input lock.")
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise WorkflowError("PROVIDER_INPUT_BUSY", "This original input is receiving a chunk; reopen its status.") from None
            yield root
        finally:
            os.close(fd)

    def _intent(self, request):
        need(isinstance(request, dict)
             and set(request) <= {"inputId", "kind", "fileName", "title", "bytes", "sha256"},
             "INTENT", "Submit the complete original file selection.")
        ident = identifier(request.get("inputId"))
        filename = plain_name(request.get("fileName"))
        size = request.get("bytes")
        need(type(size) is int and 0 <= size <= 9007199254740991,
             "SIZE", "Supply the exact nonnegative original byte count.")
        kind = request.get("kind")
        need(kind in KINDS, "KIND", "Select an original provider handover, contacts, decisions or native result/delivery.")
        expected = request.get("sha256")
        need(expected is None or isinstance(expected, str) and SHA256.fullmatch(expected),
             "HASH", "Use the full original SHA-256 when one is supplied.")
        title = request.get("title", filename)
        need(isinstance(title, str) and 0 < len(title) <= 300
             and all(ord(c) >= 32 and ord(c) != 127 for c in title),
             "TITLE", "Use a readable file title of at most 300 characters.")
        return {"inputId": ident, "fileName": filename, "title": title, "kind": kind,
                "bytes": size, "sha256": expected}

    def _load(self, root):
        need((root / "intent.json").exists() or (root / "intent.json").is_symlink(),
             "NOT_FOUND", "This original file selection has not yet been retained.")
        record = read_json(regular(root / "intent.json"))
        intent = self._intent(record.get("intent"))
        need(record.get("schema") == REQUEST_SCHEMA and record.get("workspaceId") == self.workspace_id
             and intent["inputId"] == root.name and record.get("intentSha256") == digest(intent),
             "IDENTITY", "Retain this workspace's original input and complete selection.")
        return record

    def _progress(self, root, record):
        path = root / "progress.json"
        if path.exists():
            progress = read_json(regular(path))
        else:
            progress = {"schema": SCHEMA, "inputId": root.name, "intentSha256": record["intentSha256"],
                        "chunks": [], "receivedBytes": 0, "updatedAt": record["createdAt"]}
        need(progress.get("schema") == SCHEMA and progress.get("inputId") == root.name
             and progress.get("intentSha256") == record["intentSha256"]
             and isinstance(progress.get("chunks"), list),
             "PROGRESS", "Continue the original input's retained progress.")
        offset, total = 0, record["intent"]["bytes"]
        for item in progress["chunks"]:
            need(isinstance(item, dict) and set(item) == {"offset", "bytes", "sha256"}
                 and type(item["offset"]) is int and item["offset"] == offset
                 and type(item["bytes"]) is int and 0 < item["bytes"] <= CHUNK_BYTES
                 and item["bytes"] == min(CHUNK_BYTES, total - offset)
                 and isinstance(item["sha256"], str) and SHA256.fullmatch(item["sha256"]),
                 "PROGRESS", "Retain every complete original chunk in order.")
            offset += item["bytes"]
        need(type(progress.get("receivedBytes")) is int and progress["receivedBytes"] == offset <= total,
             "PROGRESS", "The original input's received length differs.")
        return progress

    def _completed(self, root, record, progress):
        marker = root / "complete.json"
        if not marker.exists():
            return None
        # The final marker follows the final atomic progress publication. Reopen
        # that progress if a reader raced the last accepted chunk/completion.
        final_progress = self._progress(root, record)
        progress.clear()
        progress.update(final_progress)
        value = read_json(regular(marker))
        need(value.get("schema") == SCHEMA and value.get("inputId") == root.name
             and value.get("workspaceId") == self.workspace_id
             and value.get("intentSha256") == record["intentSha256"]
             and value.get("chunksSha256") == digest(progress["chunks"])
             and value.get("bytes") == record["intent"]["bytes"] == progress["receivedBytes"]
             and isinstance(value.get("sha256"), str) and SHA256.fullmatch(value["sha256"]),
             "COMPLETION", "Retain the exact completed original input.")
        if record["intent"]["sha256"] is not None:
            need(value["sha256"] == record["intent"]["sha256"],
                 "COMPLETION", "The completed source differs from the supplied original hash.")
        need(regular(root / "content.bin").stat().st_size == value["bytes"],
             "COMPLETION", "Restore the complete original input bytes.")
        return value

    def _public(self, record, progress, completed, *, chunks=True):
        intent = record["intent"]
        result = {"schema": SCHEMA, "id": intent["inputId"], "inputId": intent["inputId"],
                  "workspaceId": self.workspace_id, "origin": "browser-upload",
                  "title": intent["title"], "kind": intent["kind"], "fileName": intent["fileName"],
                  "name": intent["fileName"], "bytes": intent["bytes"],
                  "expectedSha256": intent["sha256"], "sha256": completed["sha256"] if completed else None,
                  "status": "COMPLETE" if completed else "UPLOADING",
                  "receivedBytes": progress["receivedBytes"], "offset": progress["receivedBytes"],
                  "readyToComplete": progress["receivedBytes"] == intent["bytes"],
                  "available": completed is not None,
                  "createdAt": record["createdAt"],
                  "updatedAt": completed["completedAt"] if completed else progress["updatedAt"],
                  "chunkBytes": CHUNK_BYTES, "chunkCount": len(progress["chunks"])}
        if chunks:
            result["chunks"] = progress["chunks"]
        return result

    def status(self, ident):
        # Atomic manifests can be read while the original chunk writer is live.
        root = self._root(ident)
        record = self._load(root)
        progress = self._progress(root, record)
        if (root / "complete.json").exists():
            # A completion can follow the atomic progress read; receive its final
            # original progress before checking the completed manifest.
            progress = self._progress(root, record)
        completed = self._completed(root, record, progress)
        return self._public(record, progress, completed)

    def list(self):
        rows = []
        for root in sorted(self.root.iterdir()):
            if not IDENTIFIER.fullmatch(root.name):
                continue
            need(not root.is_symlink() and root.is_dir(), "DIRECTORY", "Retain the original received-input directory.")
            if not (root / "intent.json").exists():
                continue
            record = self._load(root)
            progress = self._progress(root, record)
            if (root / "complete.json").exists():
                progress = self._progress(root, record)
            completed = self._completed(root, record, progress)
            rows.append(self._public(record, progress, completed, chunks=False))
        rows.sort(key=lambda item: (item["createdAt"], item["id"]), reverse=True)
        return {"schema": SCHEMA, "workspaceId": self.workspace_id, "inputs": rows, "chunkBytes": CHUNK_BYTES}

    def begin(self, request):
        intent = self._intent(request)
        with self._lock(intent["inputId"], create=True) as root:
            if (root / "intent.json").exists():
                record = self._load(root)
                need(record["intent"] == intent, "INTENT_CHANGED", "Resume this exact file selection, or choose a new input ID.")
            else:
                # An interrupted original atomic_json may leave its own uncommitted
                # temporary file before publishing intent.json. Preserve that file,
                # but permit replay of the still-uncommitted original begin request.
                for pending in root.iterdir():
                    if pending.name == "input.lock":
                        continue
                    need(pending.name.startswith(".workflow-"), "PENDING",
                         "Retain the existing original input directory.")
                    regular(pending)
                record = {"schema": REQUEST_SCHEMA, "workspaceId": self.workspace_id,
                          "intent": intent, "intentSha256": digest(intent), "createdAt": now()}
                atomic_json(root / "intent.json", record)
            progress = self._progress(root, record)
            if not (root / "progress.json").exists():
                atomic_json(root / "progress.json", progress)
            return self._public(record, progress, self._completed(root, record, progress))

    def chunk(self, ident, *, offset, length, sha256, source):
        """Consume exactly one binary request body; never buffer a whole source."""
        need(type(offset) is int and offset >= 0 and offset % CHUNK_BYTES == 0
             and type(length) is int and 0 < length <= CHUNK_BYTES
             and isinstance(sha256, str) and SHA256.fullmatch(sha256),
             "CHUNK", "Supply the exact offset, byte count and SHA-256 of one complete original chunk.")
        with self._lock(ident) as root:
            record = self._load(root)
            progress = self._progress(root, record)
            completed = self._completed(root, record, progress)
            total = record["intent"]["bytes"]
            need(offset < total and length == min(CHUNK_BYTES, total - offset),
                 "CHUNK_POSITION", "Send the original fixed-size chunk, or its final remaining bytes.")
            index = offset // CHUNK_BYTES
            need(index <= len(progress["chunks"]), "CHUNK_GAP", "Continue from the retained original offset.")
            selected = {"offset": offset, "bytes": length, "sha256": sha256}
            replay = index < len(progress["chunks"])
            if replay:
                need(progress["chunks"][index] == selected, "CHUNK_CHANGED", "The selected file differs from this input's original chunk.")
            else:
                need(completed is None and offset == progress["receivedBytes"],
                     "COMPLETE", "A completed input is immutable; select a new input ID for another file.")
            # Read/verify even a replay so the request cannot acknowledge different
            # bytes under a copied digest header or leave an unread HTTP body.
            fd, tmp = tempfile.mkstemp(prefix=".chunk-", dir=root)
            try:
                hasher, remaining = hashlib.sha256(), length
                with os.fdopen(fd, "wb") as stream:
                    while remaining:
                        block = source.read(min(COPY_BYTES, remaining))
                        need(isinstance(block, bytes) and block, "CHUNK_INCOMPLETE", "Send the complete original chunk.")
                        need(len(block) <= remaining, "CHUNK_LENGTH", "The source exceeded its declared chunk length.")
                        stream.write(block)
                        hasher.update(block)
                        remaining -= len(block)
                    stream.flush()
                    os.fsync(stream.fileno())
                need(hasher.hexdigest() == sha256, "CHUNK_HASH", "The transferred chunk differs from the selected original bytes.")
                if not replay:
                    incoming = root / "incoming.bin"
                    if incoming.exists():
                        regular(incoming)
                    mode = os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW
                    dest_fd = os.open(incoming, mode, 0o600)
                    try:
                        info = os.fstat(dest_fd)
                        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                             and info.st_size >= progress["receivedBytes"],
                             "SOURCE_CHANGED", "Restore the original accepted source prefix.")
                        # Only bytes beyond the committed prefix belong to an
                        # interrupted write by this same input; accepted bytes stay.
                        os.ftruncate(dest_fd, progress["receivedBytes"])
                        os.lseek(dest_fd, offset, os.SEEK_SET)
                        with open(tmp, "rb") as read:
                            while block := read.read(COPY_BYTES):
                                view = memoryview(block)
                                while view:
                                    written = os.write(dest_fd, view)
                                    need(written > 0, "WRITE", "The original input could not be written completely.")
                                    view = view[written:]
                        os.fsync(dest_fd)
                    finally:
                        os.close(dest_fd)
                    progress["chunks"].append(selected)
                    progress["receivedBytes"] += length
                    progress["updatedAt"] = now()
                    atomic_json(root / "progress.json", progress)
                value = self._public(record, progress, completed, chunks=False)
                value["replayed"] = replay
                value["chunk"] = selected
                return value
            finally:
                Path(tmp).unlink(missing_ok=True)

    def _verify_full(self, path, record, progress):
        whole = hashlib.sha256()
        with regular(path).open("rb") as stream:
            for item in progress["chunks"]:
                hasher, remaining = hashlib.sha256(), item["bytes"]
                while remaining:
                    block = stream.read(min(COPY_BYTES, remaining))
                    need(block, "SOURCE_INCOMPLETE", "Restore the original complete input.")
                    whole.update(block)
                    hasher.update(block)
                    remaining -= len(block)
                need(hasher.hexdigest() == item["sha256"], "SOURCE_CHANGED", "An accepted original chunk has changed.")
            need(not stream.read(1), "SOURCE_LENGTH", "The source differs from the retained exact byte count.")
        result = {"bytes": record["intent"]["bytes"], "sha256": whole.hexdigest()}
        if record["intent"]["sha256"] is not None:
            need(result["sha256"] == record["intent"]["sha256"],
                 "SOURCE_HASH", "The complete source differs from its original expected SHA-256.")
        return result

    def complete(self, ident, request=None):
        request = {} if request is None else request
        need(isinstance(request, dict) and set(request) <= {"sha256"},
             "COMPLETE_REQUEST", "Complete the original input without changing its selection.")
        expected = request.get("sha256")
        need(expected is None or isinstance(expected, str) and SHA256.fullmatch(expected),
             "HASH", "Use the complete original SHA-256.")
        with self._lock(ident) as root:
            record = self._load(root)
            progress = self._progress(root, record)
            need(progress["receivedBytes"] == record["intent"]["bytes"],
                 "INCOMPLETE", "Send every original chunk before completing the input.")
            completed = self._completed(root, record, progress)
            if completed is not None:
                selected = file_descriptor(regular(root / "content.bin"),
                                           expected_bytes=completed["bytes"], expected_sha256=completed["sha256"])
                need(expected is None or expected == selected["sha256"],
                     "SOURCE_HASH", "The completed input differs from that original SHA-256.")
                return self._public(record, progress, completed)
            content = root / "content.bin"
            incoming = root / "incoming.bin"
            if not content.exists():
                if not incoming.exists() and record["intent"]["bytes"] == 0:
                    fd = os.open(incoming, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                    os.fsync(fd)
                    os.close(fd)
                selected = self._verify_full(incoming, record, progress)
                need(expected is None or expected == selected["sha256"],
                     "SOURCE_HASH", "The complete source differs from the selected original SHA-256.")
                os.replace(incoming, content)
                sync_directory(root)
            else:
                # Recovery after rename but before the completion receipt.
                need(not incoming.exists(), "SOURCE_CHANGED", "Retain the one original completed source.")
                selected = self._verify_full(content, record, progress)
                need(expected is None or expected == selected["sha256"],
                     "SOURCE_HASH", "The complete source differs from the selected original SHA-256.")
            completed = {"schema": SCHEMA, "workspaceId": self.workspace_id, "inputId": ident,
                         "intentSha256": record["intentSha256"], "chunksSha256": digest(progress["chunks"]),
                         **selected, "completedAt": now()}
            atomic_json(root / "complete.json", completed)
            return self._public(record, progress, completed)

    def selected(self, ident):
        root = self._root(ident)
        record = self._load(root)
        progress = self._progress(root, record)
        completed = self._completed(root, record, progress)
        need(completed is not None, "INCOMPLETE", "Complete this original file before selecting it for a provider operation.")
        selected = file_descriptor(regular(root / "content.bin"), name=record["intent"]["fileName"],
                                   expected_bytes=completed["bytes"], expected_sha256=completed["sha256"])
        return {"id": ident, "title": record["intent"]["title"], "kind": record["intent"]["kind"],
                "fileName": record["intent"]["fileName"], "origin": "browser-upload",
                "inputRecord": {"workspaceId": self.workspace_id, "inputId": ident,
                                "intentSha256": record["intentSha256"],
                                "chunksSha256": completed["chunksSha256"]}, **selected}

    def file(self, ident):
        selected = self.selected(ident)
        content_type = "application/zip" if selected["kind"] in {"provider-handover", "handover", "native-delivery"} else "application/json"
        return Path(selected["path"]), {**selected, "contentType": content_type}
