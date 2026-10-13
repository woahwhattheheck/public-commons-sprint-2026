"""Receive original ZIP or immutable Git archive source through the source importer.

This module owns archive selection and its ordinary CLI. The original source
importer owns byte staging, create-only publication and unchanged-file reuse.
Git selection retains metadata; its receiving child streams the selected source.
The original native worker continues to own jobs, admission and applications.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib

import native_source_inputs as inputs

SCHEMA = "commons.archive-source-selection/v1"
BLOCK = 1024 * 1024
MAX_PLAN_BYTES = 32 * 1024 * 1024
DEFAULT_EXPANDED_LIMIT = 1024 * 1024 * 1024
SHA256 = re.compile(r"^[a-f0-9]{64}$")


class ArchiveSourceError(ValueError):
    pass


def need(value, message):
    if not value:
        raise ArchiveSourceError(message)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def relative(value, *, directory=False):
    need(isinstance(value, str) and value and "\0" not in value
         and "\\" not in value and not any(ord(c) < 32 for c in value),
         "Use original normalized relative archive paths")
    if directory:
        need(value.endswith("/"), "A directory member must end in /")
        value = value[:-1]
    parts = value.split("/")
    need(value and not value.startswith("/") and
         all(part not in ("", ".", "..") for part in parts)
         and ":" not in parts[0] and
         len(value.encode("utf-8")) <= 4096 and
         all(len(part.encode("utf-8")) <= 255 for part in parts),
         "The archive contains an unsupported or unsafe member path")
    return value


def prefix_value(value):
    need(isinstance(value, str), "The selected source prefix must be a string")
    if not value:
        return ""
    return relative(value.rstrip("/")) + "/"


def stamp(info):
    return (info.st_dev, info.st_ino, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def stable(stream, path, before):
    need(stamp(os.fstat(stream.fileno())) == stamp(before)
         and stamp(path.lstat()) == stamp(before),
         "The selected archive changed while it was being read")


@contextmanager
def archive_file(path):
    path = Path(path).expanduser().absolute()
    need(path.resolve(strict=True) == path, "Use the archive's actual ordinary path")
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode), "Select a complete ordinary ZIP file")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        need(stamp(os.fstat(stream.fileno())) == stamp(before),
             "The selected archive changed before opening")
        yield stream, path, before


def archive_identity(stream, before):
    digest = hashlib.sha256()
    blob = hashlib.sha1(("blob " + str(before.st_size) + "\0").encode())
    count = 0
    stream.seek(0)
    while block := stream.read(BLOCK):
        count += len(block)
        need(count <= before.st_size, "The selected archive grew while reading")
        digest.update(block)
        blob.update(block)
    need(count == before.st_size, "The selected archive ended before its full length")
    return {"bytes": count, "sha256": digest.hexdigest(),
            "git_blob_sha1": blob.hexdigest()}


def directory_set(files, explicit=()):
    names = set(explicit)
    for name in set(files).union(names):
        names.update(str(parent) for parent in PurePosixPath(name).parents
                     if str(parent) != ".")
    return sorted(names, key=lambda value: (value.count("/"), value))


def inventory(archive, prefix, limit):
    need(type(limit) is int and limit > 0,
         "Declare the complete positive expanded-source limit")
    entries = archive.infolist()
    need(len(entries) <= inputs.MAX_FILES * 4,
         "The archive directory has too many source entries")
    seen, chosen, explicit = set(), [], set()
    expanded = 0
    for info in entries:
        name = relative(info.filename, directory=info.is_dir())
        need(name not in seen, "The archive contains duplicate member paths")
        seen.add(name)
        if prefix and not (name == prefix[:-1] or name.startswith(prefix)):
            continue
        if name == prefix[:-1]:
            need(info.is_dir(), "The selected source prefix is a file")
            continue
        target = name[len(prefix):]
        kind = stat.S_IFMT(info.external_attr >> 16) if info.create_system == 3 else 0
        need(not info.flag_bits & 1, "Encrypted source members need their original receiving workflow")
        if info.is_dir():
            need(kind in (0, stat.S_IFDIR) and info.file_size == 0,
                 "The selected archive directory is not an ordinary empty directory entry")
            explicit.add(target)
            continue
        need(kind in (0, stat.S_IFREG),
             "The original source importer supports regular files; preserve this archive's special member explicitly")
        need(type(info.file_size) is int and info.file_size >= 0,
             "The archive member has an invalid complete length")
        expanded += info.file_size
        need(expanded <= limit, "The complete selected source exceeds --max-expanded-bytes")
        chosen.append((info, target, "100755" if info.create_system == 3 and (info.external_attr >> 16) & 0o111 else "100644"))
    need(chosen, "The complete selection contains no regular source files")
    need(len(chosen) <= inputs.MAX_FILES, "The original source importer accepts at most 16384 files")
    files = {target for _, target, _ in chosen}
    directories = directory_set(files, explicit)
    need(not files.intersection(directories), "An archive file is also a selected directory")
    return sorted(chosen, key=lambda row: row[1]), directories


def member_bytes(archive, info, output=None):
    digest = hashlib.sha256()
    blob = hashlib.sha1(("blob " + str(info.file_size) + "\0").encode())
    count = 0
    with archive.open(info, "r") as source:
        while block := source.read(min(BLOCK, info.file_size - count + 1)):
            count += len(block)
            need(count <= info.file_size, "An archive member exceeded its declared length")
            digest.update(block)
            blob.update(block)
            if output is not None:
                output.write(block)
    need(count == info.file_size, "An archive member ended before its complete length")
    return {"bytes": count, "sha256": digest.hexdigest(), "blob_sha": blob.hexdigest()}


def storage_plan(members, directories, archive_bytes):
    expanded = sum(row["bytes"] for row in members)
    largest = max(row["bytes"] for row in members)
    return {
        "archive_bytes": archive_bytes,
        "expanded_source_bytes": expanded,
        "largest_member_bytes": largest,
        "source_files": len(members),
        "source_directories": len(directories),
        # Importer fills one anonymous complete snapshot, then publishes output.
        # Only one archive member is separately expanded at a time.
        "staging_payload_peak_bytes": expanded + largest,
        "destination_payload_bytes": expanded,
        "conservative_additional_payload_bytes": 2 * expanded + largest,
        "existing_archive_counted_separately": True,
        "filesystem_metadata_additional": True,
        "native_job_created": False,
    }


def artifact_manifest(archive, members, destination=None):
    files, origins = [], {}
    container = {key: archive[key] for key in ("uri", "bytes", "sha256")}
    for row in members:
        entry = {"path": row["path"], "blob_sha": row["blob_sha"],
                 "size": row["bytes"], "mode": row["mode"]}
        if destination is not None:
            entry["source_file"] = str(destination / row["path"])
        files.append(entry)
        origins[row["path"]] = {
            "uri": archive["uri"], "member": row["member"],
            "bytes": row["bytes"], "sha256": row["sha256"],
            "container": dict(container),
        }
    result = {"schema": inputs.SCHEMA, "files": files, "origins": origins}
    inputs.normalized_request(result)
    return result


def select(path, uri, *, prefix="", expected_sha256=None, expected_bytes=None,
           max_expanded_bytes=DEFAULT_EXPANDED_LIMIT):
    need(isinstance(uri, str) and uri.strip() and len(uri) <= 4096 and
         not any(ord(c) < 32 for c in uri),
         "Retain the original archive URI or immutable provider file reference")
    prefix = prefix_value(prefix)
    if expected_sha256 is not None:
        need(isinstance(expected_sha256, str) and SHA256.fullmatch(expected_sha256),
             "Supply the original lowercase SHA-256")
    if expected_bytes is not None:
        need(type(expected_bytes) is int and expected_bytes >= 0,
             "Supply the original nonnegative byte count")
    with archive_file(path) as (stream, selected_path, before):
        identity = archive_identity(stream, before)
        need(expected_sha256 is None or expected_sha256 == identity["sha256"],
             "The complete original archive SHA-256 differs")
        need(expected_bytes is None or expected_bytes == identity["bytes"],
             "The complete original archive byte count differs")
        archive = {**identity, "uri": uri}
        with zipfile.ZipFile(stream) as zipped:
            entries, directories = inventory(zipped, prefix, max_expanded_bytes)
            members = []
            for info, target, mode in entries:
                members.append({"member": info.filename, "path": target, "mode": mode,
                                "crc32": f"{info.CRC:08x}", **member_bytes(zipped, info)})
        stable(stream, selected_path, before)
    manifest = artifact_manifest(archive, members)
    value = {"schema": SCHEMA, "archive": archive, "prefix": prefix,
             "members": members, "directories": directories,
             "source_selection_id": inputs.selection_identity(manifest),
             "storage": storage_plan(members, directories, archive["bytes"])}
    validate(value)
    return value


def validate(value):
    need(isinstance(value, dict) and value.get("schema") == SCHEMA and
         set(value) == {"schema", "archive", "prefix", "members", "directories",
                        "source_selection_id", "storage"},
         "Select the complete original archive-source selection")
    archive = value["archive"]
    need(isinstance(archive, dict) and
         set(archive) == {"uri", "bytes", "sha256", "git_blob_sha1"} and
         isinstance(archive["uri"], str) and archive["uri"].strip() and
         len(archive["uri"]) <= 4096 and not any(ord(c) < 32 for c in archive["uri"]) and
         type(archive["bytes"]) is int and archive["bytes"] >= 0 and
         isinstance(archive["sha256"], str) and SHA256.fullmatch(archive["sha256"]) and
         isinstance(archive["git_blob_sha1"], str) and
         re.fullmatch(r"[a-f0-9]{40}", archive["git_blob_sha1"]),
         "The original archive reference or complete byte identity is invalid")
    prefix = prefix_value(value["prefix"])
    need(prefix == value["prefix"], "The original prefix changed")
    members = value["members"]
    need(isinstance(members, list) and 0 < len(members) <= inputs.MAX_FILES,
         "Keep the full nonempty original source member selection")
    names, paths = set(), set()
    for row in members:
        need(isinstance(row, dict) and
             set(row) == {"member", "path", "mode", "crc32", "bytes", "sha256", "blob_sha"},
             "The selected source member record is incomplete")
        name, target = relative(row["member"]), relative(row["path"])
        need(name.startswith(prefix) and name[len(prefix):] == target,
             "The original member-to-source path mapping changed")
        need(name not in names and target not in paths, "The selection repeats a source member")
        names.add(name)
        paths.add(target)
        need(row["mode"] in ("100644", "100755") and
             type(row["bytes"]) is int and row["bytes"] >= 0 and
             isinstance(row["sha256"], str) and SHA256.fullmatch(row["sha256"]) and
             isinstance(row["blob_sha"], str) and re.fullmatch(r"[a-f0-9]{40}", row["blob_sha"]) and
             isinstance(row["crc32"], str) and re.fullmatch(r"[a-f0-9]{8}", row["crc32"]),
             "The selected member's complete bytes or mode are invalid")
    need(members == sorted(members, key=lambda row: row["path"]),
         "Keep the original ordered source member census")
    directories = value["directories"]
    need(isinstance(directories, list) and all(relative(name) == name for name in directories)
         and directories == directory_set(paths, directories) and
         not paths.intersection(directories),
         "Keep the complete source directory census")
    manifest = artifact_manifest(archive, members)
    need(value["source_selection_id"] == inputs.selection_identity(manifest),
         "The original artifact source selection changed")
    need(value["storage"] == storage_plan(members, directories, archive["bytes"]),
         "The complete source storage accounting changed")
    need(len(encoded(value)) <= MAX_PLAN_BYTES, "The complete source selection exceeds its metadata limit")
    return manifest


def read_selection(path):
    path = Path(path)
    need(stat.S_ISREG(path.lstat().st_mode), "The source selection must be an ordinary file")
    with path.open("rb") as stream:
        raw = stream.read(MAX_PLAN_BYTES + 1)
    need(len(raw) <= MAX_PLAN_BYTES, "The source selection is too large")
    value = json.loads(raw)
    if is_git_archive(value):
        return git_archive_selection(value)
    validate(value)
    return value


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_once(path, value):
    path = Path(path).expanduser().absolute()
    need(path.parent.resolve(strict=True) == path.parent,
         "Use an existing canonical metadata parent directory")
    raw = encoded(value)
    need(len(raw) <= MAX_PLAN_BYTES, "The complete source metadata exceeds its limit")
    if path.exists() or path.is_symlink():
        need(stat.S_ISREG(path.lstat().st_mode) and path.read_bytes() == raw,
             "The existing source metadata belongs to a different selection or destination")
        sync_directory(path.parent)
        return
    fd, temporary = tempfile.mkstemp(prefix=".archive-source-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            need(stat.S_ISREG(path.lstat().st_mode) and path.read_bytes() == raw,
                 "A different source metadata file was published concurrently")
        sync_directory(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def output_root(path):
    path = Path(path).expanduser().absolute()
    need(path.resolve() == path, "Use the receiving directory's canonical path")
    if path.exists():
        need(path.is_dir(), "The receiving destination must be a directory")
    return path


def check_directories(root, directories, *, create=False):
    for name in directories:
        target = root / name
        need(target.resolve() == target, "A selected source directory is now a symlink")
        if target.exists():
            need(target.is_dir(), "A selected source directory is occupied by a file")
        elif create:
            target.mkdir(parents=True, exist_ok=True)
            need(target.resolve() == target and target.is_dir(),
                 "The selected source directory changed during creation")


def sync_output(root, selection):
    for row in selection["members"]:
        fd = os.open(root / row["path"], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(fd)
            need(stat.S_ISREG(info.st_mode) and info.st_size == row["bytes"]
                 and stat.S_IMODE(info.st_mode) == int(row["mode"][-3:], 8),
                 "A received source file or mode changed before durable completion")
            os.fsync(fd)
        finally:
            os.close(fd)
    for name in reversed(selection["directories"]):
        sync_directory(root / name)
    sync_directory(root)
    # Importer may have created several receiving parents. Synchronize every
    # directory entry connecting that complete source to the filesystem root.
    for parent in root.parents:
        sync_directory(parent)


def summary(selection, root=None, **extra):
    if is_git_archive(selection):
        frozen = freeze_git_archive(selection)
        request = frozen["request"]
        return {"ok": True, "schema": GIT_ARCHIVE_SCHEMA,
                "source_selection_id": frozen["selection_id"],
                "repository": request["repository"], "ref": request["ref"],
                "source_files": frozen["files"], "source_bytes": frozen["bytes"],
                "storage": frozen["storage"],
                "max_archive_bytes": selection["max_archive_bytes"],
                "max_expanded_bytes": selection["max_expanded_bytes"],
                **({"output_directory": str(root)} if root is not None else {}), **extra}
    return {"ok": True, "schema": SCHEMA,
            "source_selection_id": selection["source_selection_id"],
            "archive": selection["archive"], "prefix": selection["prefix"],
            "storage": selection["storage"],
            **({"output_directory": str(root)} if root is not None else {}), **extra}


def receive(selection, archive_path, destination, *, staging_parent, source_request=None):
    manifest = validate(selection)
    root = output_root(destination)
    staging_parent = Path(staging_parent).expanduser().resolve(strict=True)
    need(staging_parent.is_dir(), "Use an existing declared staging directory")
    need(Path("/proc/self/fd").is_dir(), "Receive requires the original Linux /proc/self/fd source path")
    check_directories(root, selection["directories"])
    expected = selection["archive"]
    with archive_file(archive_path) as (stream, selected_path, before):
        observed = archive_identity(stream, before)
        need(all(observed[key] == expected[key] for key in observed),
             "The receiving archive differs from its original complete selection")
        with zipfile.ZipFile(stream) as archive:
            entries, directories = inventory(
                archive, selection["prefix"], max(1, selection["storage"]["expanded_source_bytes"]))
            census = [{"member": info.filename, "path": target, "mode": mode,
                       "bytes": info.file_size, "crc32": f"{info.CRC:08x}"}
                      for info, target, mode in entries]
            need(directories == selection["directories"] and
                 census == [{key: row[key] for key in ("member", "path", "mode", "bytes", "crc32")}
                            for row in selection["members"]],
                 "The complete archive source census differs")

            def original_entries():
                for (info, target, mode), selected in zip(entries, selection["members"]):
                    with tempfile.TemporaryFile(mode="w+b", dir=staging_parent) as output:
                        observed_member = member_bytes(archive, info, output)
                        output.flush()
                        need(all(observed_member[key] == selected[key] for key in observed_member),
                             "A complete archive member differs from its original selected bytes")
                        # The original same-process importer fully consumes this
                        # entry before the iterator advances. Linux proc reopens
                        # its ordinary anonymous inode at an independent offset.
                        source_file = "/proc/self/fd/" + str(output.fileno())
                        probe = os.open(source_file, os.O_RDONLY | os.O_NONBLOCK)
                        try:
                            need(stat.S_ISREG(os.fstat(probe).st_mode) and
                                 stamp(os.fstat(probe)) == stamp(os.fstat(output.fileno())),
                                 "Linux /proc/self/fd must expose the selected anonymous source inode")
                        finally:
                            os.close(probe)
                        yield {"path": target, "mode": mode, "blob_sha": selected["blob_sha"],
                               "source_file": source_file}
                # The original importer publishes only after fully exhausting
                # this iterator and validating its complete anonymous snapshot.
                stable(stream, selected_path, before)

            entries_iterator = original_entries()
            try:
                result = inputs.reuse.importer.materialize_entries(
                    entries_iterator, root, staging_directory=staging_parent)
            finally:
                entries_iterator.close()
    check_directories(root, selection["directories"], create=True)
    sync_output(root, selection)
    inputs.verify_materialized_origins(manifest, root)
    materialized = artifact_manifest(expected, selection["members"], root)
    if source_request is not None:
        write_once(source_request, materialized)
    return summary(selection, root, state="received", importer=result,
                   source_request=str(Path(source_request).absolute()) if source_request else None)


def reopen(selection, destination, *, source_request=None):
    manifest = validate(selection)
    root = output_root(destination)
    need(root.is_dir(), "The original receiving directory is missing")
    check_directories(root, selection["directories"])
    need(all((root / name).is_dir() for name in selection["directories"]),
         "An original selected source directory is missing")
    report = inputs.reuse.importer.inspect_materialized(manifest, root)
    need(report.get("ok") is True, "The original receiving source is incomplete or changed")
    inputs.verify_materialized_origins(manifest, root)
    materialized = artifact_manifest(selection["archive"], selection["members"], root)
    if source_request is not None:
        sync_output(root, selection)
        write_once(source_request, materialized)
    return summary(selection, root, state="reopened", importer=report,
                   source_request=str(Path(source_request).absolute()) if source_request else None)



# A Git archive is a transport for an already selected immutable file census.
# Its request uses the original Git selection identity; no source bodies are
# frozen into the native control record.
GIT_ARCHIVE_SCHEMA = "commons.github-archive-source/v1"
DEFAULT_ARCHIVE_LIMIT = 512 * 1024 * 1024


def is_git_archive(value):
    return isinstance(value, dict) and value.get("schema") == GIT_ARCHIVE_SCHEMA


def git_archive_selection(value):
    need(is_git_archive(value) and not set(value) - {
        "schema", "request", "max_archive_bytes", "max_expanded_bytes", "token_env"},
        "Use the complete Git archive source selection")
    request = inputs.source_request(value.get("request"))
    need(isinstance(request, dict) and not inputs.is_artifact(request),
         "A Git archive needs its original repository and immutable Git file selection")
    repository = inputs.reuse._repository(request.get("repository"))
    ref = inputs.reuse._sha(request.get("ref"), "source ref")
    entries = request.get("files")
    need(isinstance(entries, list) and 0 < len(entries) <= inputs.MAX_FILES,
         "Select the complete nonempty source census, at most 16384 files")
    need(all(isinstance(row, dict) and not set(row) - {
        "path", "blob_sha", "sha", "size", "mode", "type"} for row in entries),
        "Git archive requests retain file metadata; source bodies use the original source input")
    rows = inputs.reuse._requests(request)
    need(len(rows) == len(entries), "Select each original repository file once")
    files = []
    for row in rows:
        relative(row["path"])
        need(type(row["size"]) is int and row["size"] >= 0
             and row["mode"] in ("100644", "100755"),
             "Retain the original complete file size and Git executable mode")
        files.append({key: row[key] for key in ("path", "blob_sha", "size", "mode")})
    names = {row["path"] for row in files}
    need(not names.intersection(directory_set(names)),
         "A selected repository file is also a source directory")
    selected = {"schema": inputs.reuse.REQUEST_SCHEMA, "repository": repository,
                "ref": ref, "files": sorted(files, key=lambda row: row["path"])}
    if "tree_sha" in request:
        selected["tree_sha"] = inputs.reuse._sha(request["tree_sha"], "source tree")
    if "selected_paths" in request:
        need(isinstance(request["selected_paths"], list)
             and all(isinstance(path, str) for path in request["selected_paths"]),
             "Retain the original selected repository paths")
        selected["selected_paths"] = list(request["selected_paths"])
    archive_limit = value.get("max_archive_bytes", DEFAULT_ARCHIVE_LIMIT)
    expanded_limit = value.get("max_expanded_bytes", DEFAULT_EXPANDED_LIMIT)
    need(type(archive_limit) is int and archive_limit > 0
         and type(expanded_limit) is int and expanded_limit > 0,
         "Declare positive complete archive and expanded-source limits")
    total = sum(row["size"] for row in files)
    need(total <= expanded_limit, "The complete selected source exceeds max_expanded_bytes")
    token_env = value.get("token_env")
    need(token_env is None or isinstance(token_env, str)
         and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", token_env),
         "Name an existing child-only token environment variable, never its value")
    result = {"schema": GIT_ARCHIVE_SCHEMA, "request": selected,
              "max_archive_bytes": archive_limit, "max_expanded_bytes": expanded_limit}
    if token_env is not None:
        result["token_env"] = token_env
    need(len(encoded(result)) <= MAX_PLAN_BYTES,
         "The complete Git source selection exceeds its metadata limit")
    return result


def freeze_git_archive(value):
    selection = git_archive_selection(value)
    request = selection["request"]
    identity = inputs.selection_identity(request)
    return {"request": request, "selection_id": identity,
            "acquisition_selection_id": identity,
            "files": len(request["files"]),
            "bytes": sum(row["size"] for row in request["files"]),
            "archive": selection, "storage": "git-archive"}


def frozen_git_archive(value):
    need(isinstance(value, dict) and value.get("storage") == "git-archive",
         "Use the original frozen Git archive source command")
    frozen = freeze_git_archive(value.get("archive"))
    need(value == frozen, "The frozen Git archive source selection changed")
    return frozen["archive"], frozen["request"]


class GitArchiveHTTPError(ArchiveSourceError):
    def __init__(self, status, headers):
        self.code = "GIT_ARCHIVE_HTTP"
        self.status = status
        self.retry_after = headers.get("Retry-After")
        self.rate_limit_reset = headers.get("X-RateLimit-Reset")
        self.detail = "The selected Git archive provider returned HTTP " + str(status)
        super().__init__(self.detail)


class _ArchiveRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        target = urllib.parse.urlsplit(new_url)
        # GitHub's archive endpoint redirects to its own archive service. Do
        # not forward the inherited provider credential to another service.
        need(target.scheme == "https" and target.hostname in
             ("api.github.com", "codeload.github.com")
             and target.username is None and target.password is None
             and target.port in (None, 443),
             "The selected Git archive redirected outside its provider")
        redirected = super().redirect_request(request, fp, code, message, headers, new_url)
        if redirected is not None and target.hostname != urllib.parse.urlsplit(request.full_url).hostname:
            # The provider archive URL supplies its own signed authorization.
            # Do not carry an API credential across the hostname boundary.
            redirected.remove_header("Authorization")
        return redirected


class _ArchiveStream:
    def __init__(self, stream, maximum):
        self.stream, self.maximum, self.bytes_read = stream, maximum, 0

    def read(self, size=-1):
        remaining = self.maximum - self.bytes_read
        wanted = remaining + 1 if size is None or size < 0 else min(size, remaining + 1)
        data = self.stream.read(wanted)
        self.bytes_read += len(data)
        need(self.bytes_read <= self.maximum,
             "The Git archive transfer exceeds max_archive_bytes")
        return data


@contextmanager
def _git_archive_stream(selection):
    request = selection["request"]
    url = "https://api.github.com/repos/" + request["repository"] + "/tarball/" + request["ref"]
    headers = {"Accept": "application/vnd.github+json",
               "User-Agent": "commons-native-source"}
    token_env = selection.get("token_env")
    if token_env is not None:
        token = os.environ.get(token_env)
        need(isinstance(token, str) and token and "\r" not in token and "\n" not in token,
             "The selected child token environment variable is unavailable")
        headers["Authorization"] = "Bearer " + token
    opener = urllib.request.build_opener(_ArchiveRedirect())
    try:
        response = opener.open(urllib.request.Request(url, headers=headers), timeout=30)
    except urllib.error.HTTPError as exc:
        try:
            raise GitArchiveHTTPError(exc.code, exc.headers) from None
        finally:
            exc.close()
    try:
        need(response.getcode() == 200, "The Git archive request did not return a complete response")
        yield _ArchiveStream(response, selection["max_archive_bytes"])
    finally:
        response.close()


class _ExpandedArchiveStream:
    """Bound decompressed reads before the tar reader sees member metadata."""

    def __init__(self, stream, maximum):
        self.stream, self.maximum, self.bytes_read = stream, maximum, 0

    def read(self, size):
        need(type(size) is int and size >= 0,
             "The Git archive reader requires a bounded expanded read")
        if size == 0:
            return b""
        remaining = self.maximum - self.bytes_read
        need(remaining > 0,
             "The Git archive stream exceeds max_expanded_bytes before the selection is complete")
        data = self.stream.read(min(size, remaining, BLOCK))
        self.bytes_read += len(data)
        return data


def _receive_git_members(selection, stream, stage):
    wanted = {row["path"]: row for row in selection["request"]["files"]}
    found, archive_root, expanded, members_read = {}, None, 0, 0
    try:
        # gzip.GzipFile limits each decompressor output to the requested read.
        # tarfile's r|gz stream can inflate an entire compressed input block
        # into its retained buffer before returning even the first tar header.
        with gzip.GzipFile(fileobj=stream, mode="rb") as decompressed:
            bounded = _ExpandedArchiveStream(decompressed, selection["max_expanded_bytes"])
            archive = tarfile.open(fileobj=bounded, mode="r|", bufsize=BLOCK)
            with archive:
                for member in archive:
                    # Streaming tar readers before Python 3.13 still retain their
                    # member index. Exact selected names need no accumulated index.
                    archive.members.clear()
                    members_read += 1
                    expanded = max(expanded, member.offset_data + member.size)
                    need(expanded <= selection["max_expanded_bytes"],
                         "The Git archive stream exceeds max_expanded_bytes before the selection is complete")
                    name = member.name[:-1] if member.name.endswith("/") else member.name
                    root, separator, target = name.partition("/")
                    if archive_root is None:
                        relative(root)
                        archive_root = root
                    need(root == archive_root, "The Git archive contains more than one repository root")
                    if not separator or target not in wanted:
                        continue
                    # Only an exact previously validated selected path is written.
                    # Unselected archive paths never become filesystem operations.
                    need(target not in found, "The Git archive repeats a selected source path")
                    selected = wanted[target]
                    need(member.isfile() and not member.issym() and not member.islnk()
                         and getattr(member, "sparse", None) is None,
                         "The selected Git source must be an ordinary complete file")
                    need(member.size == selected["size"], "The Git archive member size differs: " + target)
                    mode = "100755" if member.mode & 0o111 else "100644"
                    need(mode == selected["mode"], "The Git archive executable mode differs: " + target)
                    destination = stage / target
                    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    checksum = hashlib.sha1(("blob " + str(member.size) + "\0").encode("ascii"))
                    count = 0
                    source = archive.extractfile(member)
                    need(source is not None, "The selected Git member has no readable bytes")
                    with source, destination.open("xb") as output:
                        while block := source.read(min(BLOCK, member.size - count + 1)):
                            count += len(block)
                            need(count <= member.size, "The Git archive member exceeded its full length")
                            checksum.update(block)
                            output.write(block)
                        need(count == member.size and checksum.hexdigest() == selected["blob_sha"],
                             "The complete Git archive source differs from its selected blob: " + target)
                        output.flush()
                        os.fsync(output.fileno())
                        os.fchmod(output.fileno(), int(mode[-3:], 8))
                    found[target] = {**selected, "source_file": str(destination)}
                    if len(found) == len(wanted):
                        # Every selected file has its original complete Git checksum.
                        # Later unselected members need no download or storage.
                        break
    except (tarfile.TarError, gzip.BadGzipFile, zlib.error, EOFError) as exc:
        raise ArchiveSourceError("The Git archive stream is incomplete or malformed: " + str(exc)) from exc
    need(set(found) == set(wanted),
         "The Git archive is missing selected source paths: "
         + ", ".join(sorted(set(wanted) - set(found))[:12]))
    return [found[row["path"]] for row in selection["request"]["files"]], {
        "archive_expanded_bytes": expanded, "archive_members_read": members_read,
        "archive_expanded_bytes_read": bounded.bytes_read}

def receive_git_archive(value, destination, *, staging_parent, source_request=None):
    """Stream exact Git source into the existing importer in one owning process."""
    selection = git_archive_selection(value)
    request = selection["request"]
    root = output_root(destination)
    parent = Path(staging_parent).expanduser().resolve(strict=True)
    need(parent.is_dir(), "Use the original invocation's declared staging directory")
    # All selected bytes remain private until the existing importer verifies
    # and publishes the whole selection. Same-device hard links retain one
    # payload; cross-device publication uses the importer's ordinary copy.
    with tempfile.TemporaryDirectory(prefix=".git-archive-source-", dir=parent) as temporary:
        stage = Path(temporary)
        with _git_archive_stream(selection) as stream:
            entries, archive_report = _receive_git_members(selection, stream, stage)
            downloaded = stream.bytes_read
        manifest = {**request, "files": entries}
        result = inputs.reuse.importer.materialize(
            manifest, root, staging_directory=parent, immutable_links=True,
            link_fallback="copy", link_anchors=())
        # Removing only this adapter's temporary names leaves independent
        # ordinary destination files before the application is entered.
    complete = inputs.reuse.importer.inspect_materialized(request, root)
    need(complete.get("ok") is True, "The received Git source differs from its complete selection")
    if source_request is not None:
        materialized = {**request, "files": [
            {**row, "source_file": str(root / row["path"])} for row in request["files"]]}
        write_once(source_request, materialized)
    return {"ok": True, "schema": GIT_ARCHIVE_SCHEMA, "state": "received",
            "source_selection_id": inputs.selection_identity(request),
            "repository": request["repository"], "ref": request["ref"],
            "output_directory": str(root), "source_files": len(request["files"]),
            "source_bytes": sum(row["size"] for row in request["files"]),
            "archive_bytes_read": downloaded, **archive_report, "staging_removed": True,
            "importer": result, "readback": complete}


def reopen_git_archive(value, destination, *, source_request=None):
    selection = git_archive_selection(value)
    request = selection["request"]
    root = output_root(destination)
    report = inputs.reuse.importer.inspect_materialized(request, root)
    need(report.get("ok") is True, "The reopened Git source differs from its complete selection")
    if source_request is not None:
        write_once(source_request, {**request, "files": [
            {**row, "source_file": str(root / row["path"])} for row in request["files"]]})
    return {"ok": True, "schema": GIT_ARCHIVE_SCHEMA, "state": "reopened",
            "source_selection_id": inputs.selection_identity(request),
            "repository": request["repository"], "ref": request["ref"],
            "output_directory": str(root), "source_files": len(request["files"]),
            "source_bytes": sum(row["size"] for row in request["files"]),
            "readback": report}



def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    prepare = actions.add_parser("prepare", help="Inspect all selected ZIP members and retain their original source selection")
    prepare.add_argument("--archive", required=True, type=Path)
    prepare.add_argument("--uri", required=True)
    prepare.add_argument("--selection", required=True, type=Path)
    prepare.add_argument("--prefix", default="")
    prepare.add_argument("--expected-sha256")
    prepare.add_argument("--expected-bytes", type=int)
    prepare.add_argument("--max-expanded-bytes", type=int, default=DEFAULT_EXPANDED_LIMIT)
    git = actions.add_parser("prepare-git", help="Retain immutable Git file metadata for streamed archive receiving")
    git.add_argument("--request", required=True, type=Path)
    git.add_argument("--selection", required=True, type=Path)
    git.add_argument("--max-archive-bytes", type=int, default=DEFAULT_ARCHIVE_LIMIT)
    git.add_argument("--max-expanded-bytes", type=int, default=DEFAULT_EXPANDED_LIMIT)
    git.add_argument("--token-env", help="optional inherited provider token environment variable name")
    for name in ("receive", "reopen"):
        command = actions.add_parser(name)
        command.add_argument("--selection", required=True, type=Path)
        command.add_argument("--destination", required=True, type=Path)
        command.add_argument("--source-request", type=Path)
        if name == "receive":
            command.add_argument("--archive", type=Path, help="complete local archive for an original ZIP selection")
            command.add_argument("--staging-parent", required=True, type=Path)
    show = actions.add_parser("info")
    show.add_argument("--selection", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.action == "prepare":
            selected = select(args.archive, args.uri, prefix=args.prefix,
                              expected_sha256=args.expected_sha256,
                              expected_bytes=args.expected_bytes,
                              max_expanded_bytes=args.max_expanded_bytes)
            write_once(args.selection, selected)
            result = summary(selected, state="selected",
                             selection_file=str(args.selection.absolute()))
        elif args.action == "prepare-git":
            need(stat.S_ISREG(args.request.lstat().st_mode), "Select an ordinary original Git source request")
            with args.request.open("rb") as stream:
                raw = stream.read(MAX_PLAN_BYTES + 1)
            need(len(raw) <= MAX_PLAN_BYTES, "The original Git source metadata exceeds its limit")
            selected = git_archive_selection({
                "schema": GIT_ARCHIVE_SCHEMA, "request": json.loads(raw),
                "max_archive_bytes": args.max_archive_bytes,
                "max_expanded_bytes": args.max_expanded_bytes,
                **({"token_env": args.token_env} if args.token_env is not None else {})})
            write_once(args.selection, selected)
            result = summary(selected, state="selected", selection_file=str(args.selection.absolute()))
        elif args.action == "info":
            result = summary(read_selection(args.selection), state="selected")
        else:
            selected = read_selection(args.selection)
            if is_git_archive(selected):
                if args.action == "receive":
                    need(args.archive is None, "The selected Git archive uses its immutable repository URL")
                    result = receive_git_archive(selected, args.destination,
                        staging_parent=args.staging_parent, source_request=args.source_request)
                else:
                    result = reopen_git_archive(selected, args.destination, source_request=args.source_request)
            elif args.action == "receive":
                need(args.archive is not None, "The original ZIP selection requires --archive")
                result = receive(selected, args.archive, args.destination,
                                 staging_parent=args.staging_parent,
                                 source_request=args.source_request)
            else:
                result = reopen(selected, args.destination, source_request=args.source_request)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        result = {"ok": False, "error": type(exc).__name__, "message": str(exc),
                  "native_job_created": False}
        if hasattr(exc, "code"):
            result["code"] = exc.code
        if hasattr(exc, "completed_files"):
            result["completed_files"] = exc.completed_files
        if isinstance(exc, GitArchiveHTTPError):
            result.update({key: getattr(exc, key) for key in
                           ("status", "retry_after", "rate_limit_reset")})
        print(json.dumps(result, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
