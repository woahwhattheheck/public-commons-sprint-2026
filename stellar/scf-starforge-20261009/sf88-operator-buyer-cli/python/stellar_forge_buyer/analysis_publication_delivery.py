"""Verified offline reading and complete download of saved publication files."""
from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import os
from pathlib import Path, PurePosixPath
import stat
import tempfile

from .analysis_publication import _id, _json, _need, _publish_bytes, _sha, _verified_file
from .storage import digest, parse, private_directory, read

SCHEMA = "stellar-forge.analysis-publication-delivery.v1"
_PACKAGE = "stellar-forge.analysis-dataset-publication-downloads.v1"
_SOURCE = "stellar-forge.analysis-publication-source-files.v1"
_MAX_INDEX = 20 * 1024 * 1024
_MAX_TOTAL = 512 * 1024 * 1024


def _relative(value):
    _need(isinstance(value, str) and 0 < len(value) <= 512 and "\\" not in value
          and not value.startswith("/") and "\x00" not in value, "DELIVERY_PATH_INVALID")
    parts = value.split("/")
    _need(all(p and p not in {".", ".."} and not any(ord(c) < 32 or ord(c) == 127 for c in p)
              for p in parts), "DELIVERY_PATH_INVALID")
    return PurePosixPath(value)


def _entries(index):
    _need(isinstance(index, dict) and index.get("schema") in {_PACKAGE, _SOURCE},
          "DELIVERY_INDEX_INVALID")
    _id(index.get("workspace_id")); _id(index.get("job_id"))
    checksum = _sha(index.get("index_sha256"))
    _need(digest(_json({k: v for k, v in index.items() if k != "index_sha256"})) == checksum,
          "DELIVERY_INDEX_CHANGED")
    files = index.get("files")
    _need(isinstance(files, list) and 1 <= len(files) <= 10000, "DELIVERY_FILES_REQUIRED")
    names, total, result = set(), 0, []
    for item in files:
        name = _relative(item.get("name")).as_posix()
        _need(name not in names and type(item.get("bytes")) is int and item["bytes"] >= 0,
              "DELIVERY_FILE_INVALID")
        names.add(name); total += item["bytes"]
        _need(total <= _MAX_TOTAL, "DELIVERY_TOO_LARGE")
        _sha(item.get("sha256"))
        result.append({k: item[k] for k in ("name", "bytes", "sha256", "mime", "visibility") if k in item})
    if index["schema"] == _PACKAGE:
        _need(names == {"datapackage.json", "data.json", "publication.zip", "recipe.json",
                        "manifest.json", "report.html"}, "DELIVERY_FILES_REQUIRED")
    else:
        _need({"manifest.json", "source.tar.gz"} <= names, "DELIVERY_FILES_REQUIRED")
    return result


@contextmanager
def _lock(directory):
    root = private_directory(directory)
    fd = os.open(root / ".download.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        _need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o077,
              "PRIVATE_FILE_REQUIRED")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield root
    finally:
        os.close(fd)


def _save(stream, destination, record):
    destination = Path(destination)
    parent = private_directory(destination.parent)
    if destination.exists() or destination.is_symlink():
        with _verified_file(destination, record):
            pass
        return
    fd, temporary = tempfile.mkstemp(prefix=".publication-", dir=parent)
    temp = Path(temporary)
    try:
        h, size = hashlib.sha256(), 0
        with os.fdopen(fd, "wb") as output:
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                _need(size <= record["bytes"], "DELIVERY_FILE_CHANGED")
                h.update(chunk); output.write(chunk)
            _need(size == record["bytes"] and h.hexdigest() == record["sha256"],
                  "DELIVERY_FILE_CHANGED")
            output.flush(); os.fsync(output.fileno())
        try:
            os.link(temp, destination, follow_symlinks=False)
        except FileExistsError:
            with _verified_file(destination, record):
                pass
        # Drop the temporary hardlink before native single-owner checks.
        temp.unlink()
        descriptor = os.open(parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        temp.unlink(missing_ok=True)


def download_file(owner, job_id, name, destination, *, expected_sha256=None):
    """Stream one original package or native-source member without re-encoding."""
    with owner.download(job_id, name, expected_sha256=expected_sha256) as (stream, record):
        _save(stream, Path(destination).expanduser().absolute(), record)
        return {"path": str(Path(destination).expanduser().absolute()),
                **{k: record[k] for k in ("name", "bytes", "sha256", "mime") if k in record}}


def download_publication(workspace, job_id, directory, *, source=False, expected_index_sha256=None):
    """Copy a complete, exact saved edition; restart reuses verified final files."""
    owner = workspace.publications.sources if source else workspace.publications
    _id(job_id)
    # The status response adds recipe/package display metadata. Transfer the
    # actual retained index file so its native digest covers precisely its bytes.
    index_name = "files-index.json" if source else "downloads.json"
    with owner.download(job_id, index_name,
                        expected_sha256=expected_index_sha256) as (stream, record):
        raw = stream.read(_MAX_INDEX + 1)
        _need(len(raw) <= _MAX_INDEX and len(raw) == record["bytes"]
              and digest(raw) == record["sha256"], "DELIVERY_INDEX_CHANGED")
        index = parse(raw)
        _need(isinstance(index, dict) and "index_sha256" not in index
              and index.get("workspace_id") == workspace.identity
              and index.get("job_id") == job_id
              and index.get("schema") == (_SOURCE if source else _PACKAGE),
              "DELIVERY_INDEX_CHANGED")
        index = {**index, "index_sha256": record["sha256"]}
    files = _entries(index)
    with _lock(Path(directory).expanduser().absolute()) as root:
        _publish_bytes(root / "index.json", _json(index))
        for item in files:
            relative = _relative(item["name"])
            destination = root / "files" / relative
            for parent in reversed(destination.parents):
                if parent == root or root in parent.parents:
                    private_directory(parent)
            if destination.exists() or destination.is_symlink():
                with _verified_file(destination, item):
                    pass
                continue
            with owner.download(job_id, item["name"], expected_sha256=item["sha256"]) as (stream, record):
                _need(record["bytes"] == item["bytes"] and record["sha256"] == item["sha256"],
                      "DELIVERY_FILE_CHANGED")
                _save(stream, destination, record)
        receipt = {"schema": SCHEMA, "workspace_id": index["workspace_id"], "job_id": job_id,
                   "kind": "native-source" if source else "package",
                   "index_sha256": index["index_sha256"], "index_file_sha256": digest(_json(index)),
                   "files": [{**item, "relative": "files/" + item["name"]} for item in files]}
        _publish_bytes(root / "delivery.json", _json(receipt))
        return {**receipt, "directory": str(root), "delivery_sha256": digest(_json(receipt))}


class DatasetPublication:
    """A verified local delivery; construction makes no network or database call."""
    def __init__(self, directory, *, expected_index_sha256=None):
        self.directory = private_directory(Path(directory).expanduser().absolute(), create=False)
        self._expected = expected_index_sha256
        self.inspect()

    def inspect(self):
        raw = read(self.directory / "delivery.json", _MAX_INDEX)
        receipt = parse(raw)
        _need(isinstance(receipt, dict) and receipt.get("schema") == SCHEMA, "DELIVERY_INVALID")
        index_raw = read(self.directory / "index.json", _MAX_INDEX)
        _need(digest(index_raw) == receipt.get("index_file_sha256"), "DELIVERY_INDEX_CHANGED")
        index = parse(index_raw); files = _entries(index)
        _need(receipt.get("workspace_id") == index["workspace_id"]
              and receipt.get("job_id") == index["job_id"]
              and receipt.get("index_sha256") == index["index_sha256"]
              and receipt.get("kind") == ("package" if index["schema"] == _PACKAGE else "native-source")
              and receipt.get("files") == [{**v, "relative": "files/" + v["name"]} for v in files],
              "DELIVERY_CHANGED")
        if self._expected is not None:
            _need(receipt["index_sha256"] == _sha(self._expected), "DELIVERY_INDEX_CHANGED")
        for item in receipt["files"]:
            with _verified_file(self.directory / _relative(item["relative"]), item):
                pass
        return {"receipt": receipt, "index": index, "delivery_sha256": digest(raw)}

    @contextmanager
    def file(self, name):
        selection = self.inspect()
        item = next((v for v in selection["receipt"]["files"] if v["name"] == name), None)
        _need(item is not None, "DELIVERY_FILE_NOT_FOUND")
        with _verified_file(self.directory / _relative(item["relative"]), item) as stream:
            yield stream, item
