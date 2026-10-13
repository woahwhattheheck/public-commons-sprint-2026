"""Independent, deduplicated receiving for completed regional inputs and outputs.

A session owns one private receiving directory. It hashes each original regular
file once, rechecks its identity on reuse and before publishing, and verifies
every new retained copy. Native objects are addressed by their complete file
inventory so several result bindings can share one received native directory.
"""
from __future__ import annotations

from collections import Counter
import errno
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile

from .store import ScenarioError, digest, file_hash, source_family

try:
    import fcntl
except ImportError:
    fcntl = None

_UNSUPPORTED_CLONE = {errno.EXDEV, errno.EINVAL, errno.ENOTTY, errno.ENOSYS,
                      errno.EOPNOTSUPP, errno.EBADF}


def _identity(path: Path) -> tuple:
    observed = path.lstat()
    if not stat.S_ISREG(observed.st_mode):
        raise ScenarioError(f"Receiving needs an original regular file: {path}")
    return (observed.st_dev, observed.st_ino, observed.st_size,
            observed.st_mtime_ns, observed.st_ctime_ns)


def _tree(source: Path) -> dict[str, tuple]:
    if source.is_symlink() or not source.is_dir():
        raise ScenarioError(f"Native workspace is not a regular directory: {source}")
    result = {}
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise ScenarioError(f"Native workspace contains a symbolic link: {path}")
        if path.is_file():
            result[path.relative_to(source).as_posix()] = _identity(path)
    return result


def _independent_copy(source: Path, target: Path, unavailable: set) -> str:
    """Use the platform FICLONE constant, then the standard file-copy fallback.

    The target is a private temporary file. Both methods create a separate inode;
    subsequent sender/receiver writes cannot change the other file's bytes.
    ENOSPC, EDQUOT and real I/O errors propagate with their original context.
    """
    operation = getattr(fcntl, "FICLONE", None) if sys.platform == "linux" else None
    pair = (source.stat().st_dev, target.stat().st_dev)
    if operation is not None and pair not in unavailable:
        with source.open("rb") as src, target.open("wb") as dst:
            try:
                fcntl.ioctl(dst.fileno(), operation, src.fileno())
            except OSError as exc:
                if exc.errno not in _UNSUPPORTED_CLONE:
                    raise
                if exc.errno == errno.EXDEV:
                    unavailable.add(pair)
            else:
                dst.flush()
                os.fsync(dst.fileno())
                return "reflink"
    shutil.copyfile(source, target)
    with target.open("rb") as dst:
        os.fsync(dst.fileno())
    return "copy"


class RetentionSession:
    """Retain exact original bodies within one create-only receiving operation."""

    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        self._sources = {}
        self._datasets = {}
        self._retained = {}
        self._directories = {}
        self._native_objects = {}
        self._unavailable = set()
        self._counts = Counter()

    def _source(self, source: Path) -> dict:
        source = Path(source).absolute()
        key = str(source)
        observed = _identity(source)
        previous = self._sources.get(key)
        if previous is not None:
            if observed != previous["identity"]:
                raise ScenarioError(f"Original file changed during receiving: {source}")
            return previous
        sha256 = file_hash(source)
        if _identity(source) != observed:
            raise ScenarioError(f"Original file changed while being read: {source}")
        record = {"path": source, "identity": observed, "bytes": observed[2],
                  "sha256": sha256}
        self._sources[key] = record
        self._counts["source_files_hashed"] += 1
        self._counts["source_bytes_hashed"] += observed[2]
        return record

    def _dataset(self, source: Path) -> dict:
        source = Path(source).absolute()
        family = source_family(source)
        names = tuple(str(path.absolute()) for path in family)
        key = str(source)
        previous = self._datasets.get(key)
        if previous is not None and previous["members"] != names:
            raise ScenarioError(f"Original dataset membership changed: {source}")
        files = [self._source(path) for path in family]
        if previous is None:
            previous = {"source": source, "members": names, "files": files,
                        "sha256": digest({item["path"].name: item["sha256"] for item in files})}
            self._datasets[key] = previous
        return previous

    def source_hash(self, source: Path) -> str:
        """Return the original primary-file SHA using this operation's cache."""
        return self._source(source)["sha256"]

    def dataset_hash(self, source: Path) -> str:
        """Use the unchanged store.dataset_hash name/body identity."""
        return self._dataset(source)["sha256"]

    def _retain_file(self, source: dict, target: Path) -> dict:
        target = Path(target)
        if not target.resolve().is_relative_to(self.root):
            raise ScenarioError("Retained file leaves the receiving directory")
        key = str(target.absolute())
        previous = self._retained.get(key)
        if previous is not None:
            if (_identity(target) != previous["identity"] or
                    previous["sha256"] != source["sha256"]):
                raise ScenarioError(f"Retained file changed during receiving: {target}")
            return {k: previous[k] for k in ("path", "bytes", "sha256")}
        method = None
        if target.exists() or target.is_symlink():
            if (_identity(target)[2] != source["bytes"] or
                    file_hash(target) != source["sha256"]):
                raise ScenarioError(f"Existing retained file differs: {target}")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary_name = tempfile.mkstemp(prefix=".receiving-", dir=target.parent)
            os.close(fd)
            temporary = Path(temporary_name)
            try:
                method = _independent_copy(source["path"], temporary, self._unavailable)
                if (_identity(temporary)[2] != source["bytes"] or
                        file_hash(temporary) != source["sha256"]):
                    raise ScenarioError(f"Original file changed during copy: {source['path']}")
                if _identity(source["path"]) != source["identity"]:
                    raise ScenarioError(f"Original file changed during receiving: {source['path']}")
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)
        observed = _identity(target)
        if (observed[0], observed[1]) == source["identity"][:2]:
            raise ScenarioError("A received copy must be independent of its original inode")
        result = {"path": target.relative_to(self.root).as_posix(),
                  "bytes": source["bytes"], "sha256": source["sha256"]}
        self._retained[key] = {**result, "identity": observed}
        if method:
            self._counts[method + "_files"] += 1
            self._counts[method + "_logical_bytes"] += source["bytes"]
        return result

    def retain_file(self, source: Path, relative: str, *, declared=None) -> dict:
        """Preserve an original relative layout while sharing hashing and copies."""
        member = Path(relative)
        if (member.is_absolute() or not member.parts or ".." in member.parts or
                member.as_posix() != relative or "\\" in relative):
            raise ScenarioError("Retained member needs a portable relative path")
        record = self._source(source)
        if declared is not None and (
                declared["bytes"] != record["bytes"] or declared["sha256"] != record["sha256"]):
            raise ScenarioError(f"Registered native file differs from its retained bytes: {relative}")
        target = self.root / member
        previous = str(target.absolute()) in self._retained
        result = self._retain_file(record, target)
        self._counts["relative_file_requests"] += 1
        if previous:
            self._counts["relative_file_reuses"] += 1
        return result

    def retain_tree(self, source: Path, relative: str) -> list[dict]:
        """Keep every original file beneath a recorded source-relative directory."""
        source = Path(source).absolute()
        if self.root.is_relative_to(source.resolve()):
            raise ScenarioError("Receiving must be outside every original native workspace")
        observed = _tree(source)
        previous = self._directories.get(str(source))
        if previous is not None and previous["identity"] != observed:
            raise ScenarioError(f"Original native directory changed: {source}")
        inventory, files = [], []
        for name, identity in observed.items():
            item = self._source(source / name)
            if item["identity"] != identity:
                raise ScenarioError(f"Original native directory changed: {source}")
            files.append({"path": name, "bytes": item["bytes"], "sha256": item["sha256"]})
            inventory.append(self.retain_file(source / name, (Path(relative) / name).as_posix()))
        if _tree(source) != observed:
            raise ScenarioError(f"Original native directory changed during receiving: {source}")
        self._directories[str(source)] = {"source": source, "identity": observed, "files": files}
        self._counts["relative_tree_requests"] += 1
        return inventory

    def snapshot(self, source: Path) -> tuple[str, list[dict]]:
        """Keep the original inputs/<dataset hash>/<filename> public layout."""
        self._counts["input_dataset_requests"] += 1
        source = Path(source).absolute()
        previous = str(source) in self._datasets
        dataset = self._dataset(source)
        if previous:
            self._counts["input_dataset_reuses"] += 1
        folder = self.root / "inputs" / dataset["sha256"]
        inventory = [self._retain_file(item, folder / item["path"].name)
                     for item in dataset["files"]]
        return (folder / source.name).relative_to(self.root).as_posix(), inventory

    def native_directory(self, source: Path) -> dict:
        """Retain one complete native object for every distinct exact file tree."""
        source = Path(source).absolute()
        if self.root.is_relative_to(source.resolve()):
            raise ScenarioError("Receiving must be outside every original native workspace")
        observed = _tree(source)
        key = str(source)
        previous = self._directories.get(key)
        if previous is not None:
            if observed != previous["identity"]:
                raise ScenarioError(f"Original native directory changed: {source}")
            files = previous["files"]
        else:
            files = []
            for relative, identity in observed.items():
                item = self._source(source / relative)
                if item["identity"] != identity:
                    raise ScenarioError(f"Original native directory changed: {source}")
                files.append({"path": relative, "bytes": item["bytes"],
                              "sha256": item["sha256"]})
            if _tree(source) != observed:
                raise ScenarioError(f"Original native directory changed while being read: {source}")
            self._directories[key] = {"source": source, "identity": observed, "files": files}
        directory_id = digest(files)
        logical_bytes = sum(item["bytes"] for item in files)
        self._counts["native_directory_requests"] += 1
        self._counts["native_logical_bytes_requested"] += logical_bytes
        existing = self._native_objects.get(directory_id)
        folder = self.root / "native-objects" / directory_id
        folder.mkdir(parents=True, exist_ok=True)
        for item in files:
            self._retain_file(self._source(source / item["path"]), folder / item["path"])
        if existing is None:
            existing = {"path": folder.relative_to(self.root).as_posix(),
                        "directory_sha256": directory_id, "files": files,
                        "logical_bytes": logical_bytes}
            self._native_objects[directory_id] = existing
            self._counts["native_unique_directories"] += 1
            self._counts["native_logical_bytes_retained"] += logical_bytes
        else:
            self._counts["native_directory_reuses"] += 1
            self._counts["native_logical_bytes_avoided"] += logical_bytes
        return {**existing, "files": [dict(item) for item in existing["files"]]}

    def verify(self) -> dict:
        """Confirm cached sources, complete memberships and retained files persist."""
        for source in self._sources.values():
            if _identity(source["path"]) != source["identity"]:
                raise ScenarioError(f"Original file changed during receiving: {source['path']}")
        for dataset in self._datasets.values():
            members = tuple(str(path.absolute()) for path in source_family(dataset["source"]))
            if members != dataset["members"]:
                raise ScenarioError(f"Original dataset membership changed: {dataset['source']}")
        for source in self._directories.values():
            if _tree(source["source"]) != source["identity"]:
                raise ScenarioError(f"Original native directory changed: {source['source']}")
        for path, retained in self._retained.items():
            if _identity(Path(path)) != retained["identity"]:
                raise ScenarioError(f"Retained file changed during receiving: {path}")
        return self.summary()

    def summary(self) -> dict:
        fields = ("source_files_hashed", "source_bytes_hashed", "input_dataset_requests",
                  "input_dataset_reuses", "native_directory_requests", "native_unique_directories",
                  "native_directory_reuses", "native_logical_bytes_requested",
                  "native_logical_bytes_retained", "native_logical_bytes_avoided",
                  "reflink_files", "reflink_logical_bytes", "copy_files", "copy_logical_bytes",
                  "relative_file_requests", "relative_file_reuses", "relative_tree_requests")
        return {"schema": "upstate.receiving-storage/v1",
                **{name: self._counts[name] for name in fields},
                "retained_files": len(self._retained),
                "retained_logical_bytes": sum(item["bytes"] for item in self._retained.values()),
                "native_directory_layout": "native-objects/<complete-file-inventory-sha256>",
                "copy_independence": "separate inodes; filesystem reflink or regular byte copy",
                "byte_measure": "logical file bytes; reflink counts do not measure physical disk savings"}
