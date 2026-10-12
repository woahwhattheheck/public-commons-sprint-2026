#!/usr/bin/env python3
"""MIT. Receive the original locked native MPP runtime with a streamed installer."""
from __future__ import annotations
import argparse
import base64
import contextlib
import email.utils
import errno
import fcntl
import hashlib
import http.client
import json
import os
import platform
import re
import resource
import shutil
import socket
import stat
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath

VERSIONS = {"@stellar/mpp": "0.7.1", "mppx": "0.6.29", "@stellar/stellar-sdk": "15.1.0"}
SCHEMA = "stellar-forge.mpp-runtime-receiving.v1"
MAX_ARCHIVE = 128 * 1024 * 1024
MAX_PACKAGE = 256 * 1024 * 1024
MAX_FILES = 40000
CHUNK = 64 * 1024
REGISTRY = "registry.npmjs.org"
REGISTRY_ATTEMPTS = 3

class ReceivingError(Exception):
    def __init__(self, code, detail):
        self.code, self.detail = code, detail
        super().__init__(detail)

class ArchiveIncompleteRead(http.client.IncompleteRead):
    def __init__(self, received, declared):
        super().__init__(b"", declared - received)
        self.received, self.declared = received, declared

    def __str__(self):
        return f"Original registry body ended after {self.received} of {self.declared} declared bytes"

def require(value, code, detail):
    if not value:
        raise ReceivingError(code, detail)

def digest_file(path, algorithm="sha256"):
    digest = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()

def read_json(path, maximum=16 * 1024 * 1024):
    require(path.is_file() and not path.is_symlink(), "MPP_RUNTIME_FILE_REQUIRED", str(path))
    require(path.stat().st_size <= maximum, "MPP_RUNTIME_FILE_TOO_LARGE", str(path))
    return json.loads(path.read_text("utf-8"))

def atomic_bytes(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".receiving-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)

def atomic_json(path, value):
    atomic_bytes(path, (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode())

def preserve(path, data):
    existing = None
    if path.exists() or path.is_symlink():
        require(path.is_file() and not path.is_symlink() and path.stat().st_size <= len(data),
                "MPP_RUNTIME_ORIGINAL_FILE_CONFLICT", str(path))
        existing = path.read_bytes()
        if existing == data:
            return
        require(data.startswith(existing), "MPP_RUNTIME_ORIGINAL_FILE_CONFLICT", str(path))
    fd, temporary = tempfile.mkstemp(prefix=".manifest-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        if existing is None:
            try:
                os.link(temporary, path)
            except FileExistsError:
                require(path.is_file() and not path.is_symlink() and path.read_bytes() == data,
                        "MPP_RUNTIME_ORIGINAL_FILE_CONFLICT", str(path))
        else:
            require(path.is_file() and not path.is_symlink() and path.read_bytes() == existing,
                    "MPP_RUNTIME_ORIGINAL_FILE_CONFLICT", str(path))
            os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)

def child_path(root, relative):
    parts = PurePosixPath(relative).parts
    require(parts and not PurePosixPath(relative).is_absolute()
            and all(part not in ("", ".", "..") and "\\" not in part and "\x00" not in part for part in parts),
            "MPP_RUNTIME_PATH_INVALID", relative)
    value = root
    for part in parts:
        value /= part
        require(not value.is_symlink(), "MPP_RUNTIME_SYMLINK_CONFLICT", str(value))
    return value

def package_name(relative):
    return relative.rsplit("node_modules/", 1)[-1]

def allowed_platform(rule, selected):
    if rule is None:
        return True
    values = [rule] if isinstance(rule, str) else rule
    require(isinstance(values, list) and all(isinstance(x, str) for x in values),
            "MPP_RUNTIME_PLATFORM_RULE_INVALID", str(rule))
    if "!" + selected in values or "!any" in values:
        return False
    positive = [x for x in values if not x.startswith("!")]
    return not positive or selected in positive or "any" in positive

def package_supported(meta):
    system = {"Linux": "linux", "Darwin": "darwin", "Windows": "win32"}.get(platform.system(), sys.platform)
    machine = {"x86_64": "x64", "AMD64": "x64", "aarch64": "arm64",
               "arm64": "arm64", "i386": "ia32", "i686": "ia32"}.get(platform.machine(), platform.machine())
    libc = platform.libc_ver()[0]
    if libc == "glibc":
        libc = "glibc"
    elif any(Path("/lib").glob("ld-musl-*.so*")):
        libc = "musl"
    return allowed_platform(meta.get("os"), system) and allowed_platform(meta.get("cpu"), machine) and (
        system != "linux" or allowed_platform(meta.get("libc"), libc))

def load_selection(source):
    manifest_bytes = (source / "package.json").read_bytes()
    lock_bytes = (source / "package-lock.json").read_bytes()
    require(len(manifest_bytes) <= 65536 and len(lock_bytes) <= 2 * 1024 * 1024,
            "MPP_RUNTIME_MANIFEST_TOO_LARGE", str(source))
    manifest, lock = json.loads(manifest_bytes), json.loads(lock_bytes)
    require(lock.get("lockfileVersion") == 3 and isinstance(lock.get("packages"), dict),
            "MPP_RUNTIME_LOCK_REQUIRED", "The original version-3 package-lock.json is required.")
    require(manifest.get("dependencies") == VERSIONS and lock["packages"].get("", {}).get("dependencies") == VERSIONS,
            "MPP_RUNTIME_PUBLISHED_VERSIONS_REQUIRED", "Use the original native MPP peer set.")
    selected, skipped = {}, []
    for relative, meta in sorted(lock["packages"].items(), key=lambda item: (item[0].count("/"), item[0])):
        if relative == "":
            continue
        require(re.fullmatch(r"node_modules/(?:@[^/]+/)?[^/]+(?:/node_modules/(?:@[^/]+/)?[^/]+)*", relative),
                "MPP_RUNTIME_PACKAGE_PATH_INVALID", relative)
        require(not meta.get("link") and not meta.get("inBundle"), "MPP_RUNTIME_LOCK_LAYOUT_UNSUPPORTED", relative)
        if meta.get("dev"):
            skipped.append({"path": relative, "reason": "dev"})
            continue
        if not package_supported(meta):
            require(meta.get("optional") or meta.get("devOptional"),
                    "MPP_RUNTIME_PLATFORM_MISMATCH", relative)
            skipped.append({"path": relative, "reason": "platform"})
            continue
        parsed = urllib.parse.urlsplit(meta.get("resolved", ""))
        require(parsed.scheme == "https" and parsed.hostname == REGISTRY and parsed.port in (None, 443)
                and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment,
                "MPP_RUNTIME_REGISTRY_SOURCE_REQUIRED", relative)
        sri = meta.get("integrity", "")
        require(isinstance(sri, str) and sri.startswith("sha512-") and " " not in sri,
                "MPP_RUNTIME_SHA512_REQUIRED", relative)
        try:
            archive_digest = base64.b64decode(sri[7:], validate=True)
        except ValueError as error:
            raise ReceivingError("MPP_RUNTIME_INTEGRITY_INVALID", relative) from error
        require(len(archive_digest) == 64 and isinstance(meta.get("version"), str),
                "MPP_RUNTIME_INTEGRITY_INVALID", relative)
        selected[relative] = {**meta, "archiveSha512": archive_digest.hex()}
    for name, version in VERSIONS.items():
        require(selected.get("node_modules/" + name, {}).get("version") == version,
                "MPP_RUNTIME_PUBLISHED_VERSIONS_REQUIRED", name)
    return manifest_bytes, lock_bytes, selected, skipped

class RegistryRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        url = urllib.parse.urlsplit(newurl)
        require(url.scheme == "https" and url.hostname == REGISTRY and url.port in (None, 443)
                and not url.username and not url.password,
                "MPP_RUNTIME_REGISTRY_REDIRECT_INVALID", newurl)
        return super().redirect_request(request, fp, code, message, headers, newurl)

def registry_retry_delay(error, attempt):
    delay = float(2 ** (attempt - 1))
    if isinstance(error, urllib.error.HTTPError):
        if error.code not in (408, 429, 500, 502, 503, 504):
            return None
        supplied = error.headers.get("Retry-After")
        if supplied:
            try:
                delay = max(delay, float(supplied))
            except ValueError:
                try:
                    delay = max(delay, email.utils.parsedate_to_datetime(supplied).timestamp() - time.time())
                except (TypeError, ValueError, OverflowError):
                    return None
        elif error.code == 429:
            return None
        return delay if 0 <= delay <= 30 else None
    reason = error.reason if isinstance(error, urllib.error.URLError) else error
    if isinstance(reason, socket.gaierror):
        return delay if reason.errno == socket.EAI_AGAIN else None
    return delay if isinstance(reason, (TimeoutError, ConnectionError, http.client.IncompleteRead)) else None

def download_archive(meta, cache, archive):
    fd, temporary = tempfile.mkstemp(prefix=".download-", suffix=".part", dir=cache)
    count, digest = 0, hashlib.sha512()
    try:
        request = urllib.request.Request(meta["resolved"], headers={
            "User-Agent": "Starforge-MPP-Runtime-Receiver/1", "Accept-Encoding": "identity"})
        opener = urllib.request.build_opener(RegistryRedirect())
        with opener.open(request, timeout=45) as response, os.fdopen(fd, "wb") as stream:
            require(response.status == 200, "MPP_RUNTIME_REGISTRY_RESPONSE_INVALID", str(response.status))
            length = response.headers.get("Content-Length", "").strip()
            declared = int(length) if re.fullmatch(r"[0-9]{1,12}", length) else None
            require(declared is None or declared <= MAX_ARCHIVE, "MPP_RUNTIME_ARCHIVE_TOO_LARGE", meta["resolved"])
            for block in iter(lambda: response.read(CHUNK), b""):
                count += len(block)
                require(count <= MAX_ARCHIVE, "MPP_RUNTIME_ARCHIVE_TOO_LARGE", meta["resolved"])
                digest.update(block)
                stream.write(block)
            if declared is not None and count < declared:
                raise ArchiveIncompleteRead(count, declared)
            stream.flush()
            os.fsync(stream.fileno())
        fd = None
        require(digest.hexdigest() == meta["archiveSha512"], "MPP_RUNTIME_ARCHIVE_INTEGRITY_MISMATCH", meta["resolved"])
        os.chmod(temporary, 0o600)
        os.replace(temporary, archive)
        return archive, count
    finally:
        if fd is not None:
            with contextlib.suppress(OSError):
                os.close(fd)
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)

def receive_archive(meta, cache, offline, relative):
    archive = child_path(cache, meta["archiveSha512"] + ".tgz")
    if archive.exists():
        require(archive.is_file() and archive.stat().st_size <= MAX_ARCHIVE
                and digest_file(archive, "sha512") == meta["archiveSha512"],
                "MPP_RUNTIME_ARCHIVE_CONFLICT", str(archive))
        return archive, 0, 0
    require(not offline, "MPP_RUNTIME_ARCHIVE_REQUIRED", str(archive))
    for attempt in range(1, REGISTRY_ATTEMPTS + 1):
        try:
            received, downloaded = download_archive(meta, cache, archive)
            return received, downloaded, attempt - 1
        except (urllib.error.URLError, TimeoutError, ConnectionError,
                socket.gaierror, http.client.IncompleteRead) as error:
            try:
                context = {"path": relative, "url": meta["resolved"], "version": meta["version"],
                           "attempt": attempt, "maximumAttempts": REGISTRY_ATTEMPTS, "reason": str(error)}
                if isinstance(error, ArchiveIncompleteRead):
                    context.update(receivedBytes=error.received, declaredBytes=error.declared)
                if isinstance(error, urllib.error.HTTPError):
                    context.update(status=error.code, retryAfter=error.headers.get("Retry-After"))
                delay = registry_retry_delay(error, attempt)
            finally:
                if isinstance(error, urllib.error.HTTPError):
                    with contextlib.suppress(OSError):
                        error.close()
            if delay is None or attempt == REGISTRY_ATTEMPTS:
                code = "MPP_RUNTIME_REGISTRY_ERROR" if isinstance(error, urllib.error.HTTPError) else "MPP_RUNTIME_REGISTRY_UNAVAILABLE"
                raise ReceivingError(code, json.dumps(context, separators=(",", ":"))) from error
            print(json.dumps({"state": "ARCHIVE_RETRY", **context, "nextAttempt": attempt + 1,
                              "retryAfterSeconds": delay}, separators=(",", ":")), file=sys.stderr, flush=True)
            time.sleep(delay)
    raise AssertionError("archive receiving exhausted without a result")

def cached_archive(meta, cache):
    archive = child_path(cache, meta["archiveSha512"] + ".tgz")
    if not archive.exists():
        return None
    require(archive.is_file() and not archive.is_symlink() and archive.stat().st_size <= MAX_ARCHIVE
            and digest_file(archive, "sha512") == meta["archiveSha512"],
            "MPP_RUNTIME_ARCHIVE_CONFLICT", str(archive))
    return archive

def cache_snapshot(cache, limit):
    if not cache.is_dir():
        return {"directory": str(cache), "mode": "partial" if limit is not None else "complete",
                "limitBytes": limit, "available": False, "archiveFiles": 0, "archiveBytes": 0}
    count, size = 0, 0
    for item in cache.iterdir():
        if re.fullmatch(r"[a-f0-9]{128}[.]tgz", item.name):
            require(item.is_file() and not item.is_symlink(), "MPP_RUNTIME_ARCHIVE_CONFLICT", str(item))
            count += 1
            size += item.stat().st_size
    return {"directory": str(cache), "mode": "partial" if limit is not None else "complete",
            "limitBytes": limit, "available": True, "archiveFiles": count, "archiveBytes": size,
            "availableBytes": shutil.disk_usage(cache).free}

def retain_archive(archive, meta, cache, limit, relative):
    size = archive.stat().st_size
    lease_path = child_path(cache, ".mpp-runtime-cache.lock")
    temporary, descriptor = None, None
    try:
        with lease_path.open("a+b") as lease:
            fcntl.flock(lease, fcntl.LOCK_EX)
            existing = cached_archive(meta, cache)
            if existing:
                return {"state": "REUSED", "bytes": size}
            for abandoned in cache.glob(".mpp-cache-download-*.part"):
                require(abandoned.is_file() and not abandoned.is_symlink(),
                        "MPP_RUNTIME_ARCHIVE_CONFLICT", str(abandoned))
                abandoned.unlink()
            snapshot = cache_snapshot(cache, limit)
            reason = None
            if limit is not None:
                if snapshot["archiveBytes"] + size > limit:
                    reason = "byte_budget"
                elif snapshot["availableBytes"] < size + 65536:
                    reason = "filesystem_capacity"
            if reason:
                result = {"state": "ARCHIVE_CACHE_SKIPPED", "path": relative, "reason": reason,
                          "archiveBytes": size, "cache": snapshot}
                print(json.dumps(result, separators=(",", ":")), file=sys.stderr, flush=True)
                return result
            descriptor, temporary = tempfile.mkstemp(prefix=".mpp-cache-download-", suffix=".part", dir=cache)
            digest = hashlib.sha512()
            with archive.open("rb") as source, os.fdopen(descriptor, "wb") as destination:
                for block in iter(lambda: source.read(CHUNK), b""):
                    digest.update(block)
                    destination.write(block)
                destination.flush()
                os.fsync(destination.fileno())
            descriptor = None
            require(digest.hexdigest() == meta["archiveSha512"],
                    "MPP_RUNTIME_ARCHIVE_INTEGRITY_MISMATCH", str(archive))
            target = child_path(cache, meta["archiveSha512"] + ".tgz")
            try:
                os.link(temporary, target)
            except FileExistsError:
                cached_archive(meta, cache)
                return {"state": "REUSED", "bytes": size}
            return {"state": "RETAINED", "bytes": size}
    except OSError as error:
        if limit is None or error.errno not in (errno.ENOSPC, errno.EDQUOT):
            raise
        result = {"state": "ARCHIVE_CACHE_SKIPPED", "path": relative, "reason": "filesystem_capacity",
                  "archiveBytes": size, "cache": str(cache), "detail": str(error)}
        print(json.dumps(result, separators=(",", ":")), file=sys.stderr, flush=True)
        return result
    finally:
        if descriptor is not None:
            with contextlib.suppress(OSError):
                os.close(descriptor)
        if temporary is not None:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(temporary)

def package_files(directory, nested):
    files = {}
    for current, dirs, names in os.walk(directory, followlinks=False):
        relative = Path(current).relative_to(directory)
        for name in list(dirs):
            path = Path(current) / name
            require(not path.is_symlink(), "MPP_RUNTIME_SYMLINK_CONFLICT", str(path))
            if str(relative) == "." and name == "node_modules" and nested:
                dirs.remove(name)
        for name in names:
            path = Path(current) / name
            require(path.is_file() and not path.is_symlink(), "MPP_RUNTIME_FILE_INVALID", str(path))
            files[path.relative_to(directory).as_posix()] = path
    return files

def verify_package(directory, record, nested=False, allow_missing=False):
    require(directory.is_dir() and not directory.is_symlink(), "MPP_RUNTIME_PACKAGE_REQUIRED", str(directory))
    actual = package_files(directory, nested)
    expected = record["files"]
    require(set(actual) <= set(expected), "MPP_RUNTIME_UNEXPECTED_PACKAGE_FILE",
            str(directory) + ": " + ", ".join(sorted(set(actual) - set(expected))[:5]))
    if not allow_missing:
        require(set(actual) == set(expected), "MPP_RUNTIME_PACKAGE_INCOMPLETE", str(directory))
    for name, path in actual.items():
        row = expected[name]
        require(path.stat().st_size == row["bytes"] and digest_file(path) == row["sha256"],
                "MPP_RUNTIME_INSTALLED_FILE_CONFLICT", str(path))
        require(stat.S_IMODE(path.stat().st_mode) & 0o777 == row["mode"],
                "MPP_RUNTIME_INSTALLED_MODE_CONFLICT", str(path))
    return set(expected) - set(actual)

def extract_package(archive, staging, relative, meta):
    files, total = {}, 0
    bins = meta.get("bin") or {}
    require(isinstance(bins, dict), "MPP_RUNTIME_BIN_LAYOUT_INVALID", relative)
    require(all(isinstance(name, str) and isinstance(path, str) for name, path in bins.items()),
            "MPP_RUNTIME_BIN_LAYOUT_INVALID", relative)
    bin_paths = set(bins.values())
    with tarfile.open(archive, mode="r|gz") as source:
        for member in source:
            parts = PurePosixPath(member.name).parts
            require(parts and parts[0] == "package" and not member.name.startswith("/"),
                    "MPP_RUNTIME_ARCHIVE_PATH_INVALID", member.name)
            if len(parts) == 1:
                require(member.isdir(), "MPP_RUNTIME_ARCHIVE_PATH_INVALID", member.name)
                continue
            local = PurePosixPath(*parts[1:]).as_posix()
            require(parts[1] != "node_modules", "MPP_RUNTIME_UNDECLARED_BUNDLE", member.name)
            target = child_path(staging, local)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o755)
                continue
            require(member.isfile() and not member.issym() and not member.islnk(),
                    "MPP_RUNTIME_ARCHIVE_ENTRY_INVALID", member.name)
            require(local not in files and len(files) < MAX_FILES and 0 <= member.size <= MAX_PACKAGE,
                    "MPP_RUNTIME_ARCHIVE_MEMBER_INVALID", member.name)
            total += member.size
            require(total <= MAX_PACKAGE, "MPP_RUNTIME_PACKAGE_TOO_LARGE", relative)
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            digest, count = hashlib.sha256(), 0
            with source.extractfile(member) as incoming, target.open("xb") as outgoing:
                for block in iter(lambda: incoming.read(CHUNK), b""):
                    outgoing.write(block)
                    digest.update(block)
                    count += len(block)
            require(count == member.size, "MPP_RUNTIME_ARCHIVE_TRUNCATED", member.name)
            mode = 0o755 if member.mode & 0o111 or local in bin_paths else 0o644
            target.chmod(mode)
            files[local] = {"bytes": count, "sha256": digest.hexdigest(), "mode": mode}
    package = read_json(staging / "package.json", 2 * 1024 * 1024)
    require(package.get("name") == package_name(relative) and package.get("version") == meta["version"],
            "MPP_RUNTIME_PACKAGE_IDENTITY_MISMATCH", relative)
    return {"path": relative, "name": package["name"], "version": package["version"],
            "resolved": meta["resolved"], "integrity": meta["integrity"],
            "archiveSha512": meta["archiveSha512"], "files": files, "bytes": total, "bins": bins}

def bind_bins(root, relative, record, inspect=False):
    parts = PurePosixPath(relative).parts
    index = max(i for i, part in enumerate(parts) if part == "node_modules")
    modules = child_path(root, PurePosixPath(*parts[:index + 1]).as_posix())
    if not record["bins"]:
        return
    binary = child_path(modules, ".bin")
    if not inspect:
        binary.mkdir(exist_ok=True, mode=0o755)
    require(binary.is_dir(), "MPP_RUNTIME_BIN_DIRECTORY_REQUIRED", str(binary))
    package = child_path(root, relative)
    for name, local in record["bins"].items():
        require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,100}", name) and local in record["files"],
                "MPP_RUNTIME_BIN_INVALID", relative + ": " + name)
        target = child_path(package, local)
        link = binary / name
        value = os.path.relpath(target, binary)
        if link.exists() or link.is_symlink():
            require(link.is_symlink() and os.readlink(link) == value, "MPP_RUNTIME_BIN_CONFLICT", str(link))
        else:
            require(not inspect, "MPP_RUNTIME_BIN_REQUIRED", str(link))
            os.symlink(value, link)

def verify_layout(root, selected):
    expected = set(selected)
    modules = {PurePosixPath(*PurePosixPath(path).parts[:i + 1]).as_posix()
               for path in expected for i, part in enumerate(PurePosixPath(path).parts) if part == "node_modules"}
    expected_bins = {relative: {} for relative in modules}
    for relative, meta in selected.items():
        parts = PurePosixPath(relative).parts
        index = max(i for i, part in enumerate(parts) if part == "node_modules")
        module_path = PurePosixPath(*parts[:index + 1]).as_posix()
        binary = child_path(root, module_path) / ".bin"
        package = child_path(root, relative)
        for name, local in (meta.get("bin") or {}).items():
            require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,100}", name),
                    "MPP_RUNTIME_BIN_INVALID", name)
            value = os.path.relpath(child_path(package, local), binary)
            previous = expected_bins[module_path].get(name)
            require(previous is None or previous == value, "MPP_RUNTIME_BIN_COLLISION", module_path + ": " + name)
            expected_bins[module_path][name] = value
    for relative in sorted(modules):
        folder = child_path(root, relative)
        require(folder.is_dir(), "MPP_RUNTIME_MODULE_DIRECTORY_REQUIRED", str(folder))
        binary = child_path(folder, ".bin")
        if binary.exists():
            require(binary.is_dir(), "MPP_RUNTIME_BIN_DIRECTORY_INVALID", str(binary))
            observed = {entry.name: entry for entry in binary.iterdir()}
            require(set(observed) == set(expected_bins[relative]),
                    "MPP_RUNTIME_UNEXPECTED_BIN_LAYOUT", str(binary))
            for name, entry in observed.items():
                require(entry.is_symlink() and os.readlink(entry) == expected_bins[relative][name],
                        "MPP_RUNTIME_BIN_CONFLICT", str(entry))
        else:
            require(not expected_bins[relative], "MPP_RUNTIME_BIN_DIRECTORY_REQUIRED", str(binary))
        packages = []
        for path in folder.iterdir():
            if path.name == ".bin":
                continue
            if path.name == ".package-lock.json":
                require(path.is_file() and not path.is_symlink(), "MPP_RUNTIME_FILE_INVALID", str(path))
                continue
            require(path.is_dir() and not path.is_symlink(), "MPP_RUNTIME_PACKAGE_LAYOUT_INVALID", str(path))
            if path.name.startswith("@"):
                packages.extend(path.iterdir())
            else:
                packages.append(path)
        for path in packages:
            require(path.is_dir() and not path.is_symlink() and path.relative_to(root).as_posix() in expected,
                    "MPP_RUNTIME_UNEXPECTED_PACKAGE", str(path))

def clear_abandoned_staging(metadata, selected):
    folder = child_path(metadata, "staging")
    if not folder.exists():
        return 0
    require(folder.is_dir(), "MPP_RUNTIME_STAGING_INVALID", str(folder))
    prefixes = {hashlib.sha256(relative.encode()).hexdigest()[:16] + "-" for relative in selected}
    removed = 0
    for path in folder.iterdir():
        if any(path.name.startswith(prefix) for prefix in prefixes):
            require(path.is_dir() and not path.is_symlink(), "MPP_RUNTIME_STAGING_INVALID", str(path))
            shutil.rmtree(path)
            removed += 1
    return removed

def receive(directory, source, cache=None, offline=False, inspect=False, cache_limit=None):
    started = time.monotonic()
    require(cache_limit is None or (cache is not None and isinstance(cache_limit, int) and cache_limit >= 0),
            "MPP_RUNTIME_CACHE_POLICY_INVALID", "--cache-limit-bytes requires --cache and a nonnegative byte budget")
    manifest_bytes, lock_bytes, selected, skipped = load_selection(source)
    root = directory.resolve()
    if not inspect:
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        root.chmod(0o700)
    require(root.is_dir(), "MPP_RUNTIME_DIRECTORY_REQUIRED", str(root))
    metadata = child_path(root, ".mpp-runtime")
    if not inspect:
        metadata.mkdir(exist_ok=True, mode=0o700)
    require(metadata.is_dir(), "MPP_RUNTIME_RECEIVING_STATE_REQUIRED", str(metadata))
    lock_sha = hashlib.sha256(lock_bytes).hexdigest()
    identity = {"schema": SCHEMA, "lockSha256": lock_sha, "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest()}
    lease_path = child_path(metadata, "receive.lock")
    if inspect:
        require(lease_path.is_file(), "MPP_RUNTIME_RECEIVING_STATE_REQUIRED", str(lease_path))
    with lease_path.open("rb" if inspect else "a+b") as lease:
        try:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ReceivingError("MPP_RUNTIME_BUSY", str(root)) from error
        state_path = metadata / "selection.json"
        if state_path.exists():
            require(read_json(state_path) == identity, "MPP_RUNTIME_SELECTION_CONFLICT", str(root))
        else:
            require(not inspect, "MPP_RUNTIME_RECEIVING_STATE_REQUIRED", str(root))
            atomic_json(state_path, identity)
        for name, original in (("package.json", manifest_bytes), ("package-lock.json", lock_bytes)):
            original_path = child_path(root, name)
            if inspect:
                require(original_path.is_file() and original_path.read_bytes() == original,
                        "MPP_RUNTIME_ORIGINAL_FILE_CONFLICT", name)
            else:
                preserve(original_path, original)
        cleared_staging = 0 if inspect else clear_abandoned_staging(metadata, selected)
        archive_root = child_path(metadata, "archives")
        cache_root = cache.resolve() if cache else None
        if not inspect:
            archive_root.mkdir(parents=True, exist_ok=True, mode=0o700)
            if cache_root:
                require(not cache_root.is_relative_to(root), "MPP_RUNTIME_CACHE_DIRECTORY_INVALID",
                        "Choose a retained archive directory outside this installation")
                cache_root.mkdir(parents=True, exist_ok=True, mode=0o700)
            for partial in archive_root.glob(".download-*.part"):
                require(partial.is_file() and not partial.is_symlink(), "MPP_RUNTIME_ARCHIVE_CONFLICT", str(partial))
                partial.unlink()
        records_dir = child_path(metadata, "packages")
        if not inspect:
            records_dir.mkdir(exist_ok=True, mode=0o700)
        counts = {"packages": 0, "files": 0, "bytes": 0, "downloadedBytes": 0, "reusedPackages": 0, "registryRetries": 0,
                  "cachedArchivesReused": 0, "archivesRetained": 0, "cacheRetainedBytes": 0, "cacheSkippedArchives": 0,
                  "knownArchiveBytes": 0, "packagesWithArchiveSize": 0}
        package_summaries, archive_sizes = [], {}
        for relative, meta in selected.items():
            key = hashlib.sha256(relative.encode()).hexdigest()
            record_path = records_dir / (key + ".json")
            target = child_path(root, relative)
            nested = any(name.startswith(relative + "/node_modules/") for name in selected)
            record = read_json(record_path) if record_path.exists() else None
            if record:
                require(record.get("path") == relative and record.get("version") == meta["version"]
                        and record.get("integrity") == meta["integrity"] and record.get("archiveSha512") == meta["archiveSha512"],
                        "MPP_RUNTIME_PACKAGE_SELECTION_CONFLICT", relative)
                verify_package(target, record, nested)
                counts["reusedPackages"] += 1
            else:
                require(not inspect, "MPP_RUNTIME_PACKAGE_RECEIPT_REQUIRED", relative)
                archive = cached_archive(meta, cache_root) if cache_root else None
                if archive:
                    counts["cachedArchivesReused"] += 1
                else:
                    archive, downloaded, retries = receive_archive(meta, archive_root, offline, relative)
                    counts["downloadedBytes"] += downloaded
                    counts["registryRetries"] += retries
                    if cache_root:
                        retention = retain_archive(archive, meta, cache_root, cache_limit, relative)
                        if retention["state"] == "RETAINED":
                            counts["archivesRetained"] += 1
                            counts["cacheRetainedBytes"] += retention["bytes"]
                        elif retention["state"] == "ARCHIVE_CACHE_SKIPPED":
                            counts["cacheSkippedArchives"] += 1
                stage_parent = child_path(metadata, "staging")
                stage_parent.mkdir(exist_ok=True, mode=0o700)
                staging = Path(tempfile.mkdtemp(prefix=key[:16] + "-", dir=stage_parent))
                try:
                    record = extract_package(archive, staging, relative, meta)
                    record["archiveBytes"] = archive.stat().st_size
                    target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
                    if target.exists():
                        missing = verify_package(target, record, nested, allow_missing=True)
                        for name in sorted(missing):
                            destination = child_path(target, name)
                            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
                            os.link(staging / name, destination)
                    else:
                        os.replace(staging, target)
                    atomic_json(record_path, record)
                finally:
                    if staging.exists():
                        shutil.rmtree(staging)
                if archive.parent == archive_root:
                    archive.unlink()
            bind_bins(root, relative, record, inspect)
            if not inspect:
                temporary_archive = child_path(archive_root, meta["archiveSha512"] + ".tgz")
                if temporary_archive.exists():
                    require(temporary_archive.is_file(), "MPP_RUNTIME_ARCHIVE_CONFLICT", str(temporary_archive))
                    temporary_archive.unlink()
            counts["packages"] += 1
            counts["files"] += len(record["files"])
            counts["bytes"] += record["bytes"]
            if isinstance(record.get("archiveBytes"), int):
                archive_sizes[meta["archiveSha512"]] = record["archiveBytes"]
                counts["knownArchiveBytes"] = sum(archive_sizes.values())
                counts["packagesWithArchiveSize"] += 1
            package_summaries.append({key: record[key] for key in ("path", "name", "version", "integrity", "bytes")})
            if not inspect:
                print(json.dumps({"state": "PACKAGE_RECEIVED", "path": relative, "version": meta["version"],
                                  "completed": counts["packages"], "total": len(selected)}, separators=(",", ":")), flush=True)
        verify_layout(root, selected)
        result = {**identity, "state": "READY", "directory": str(root), "versions": VERSIONS, **counts,
                  "skipped": skipped, "packagesSha256": hashlib.sha256(json.dumps(
                      package_summaries, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
                  "seconds": round(time.monotonic() - started, 3),
                  "maximumResidentKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                  "clearedStagingDirectories": cleared_staging,
                  "originalArchiveBytes": counts["knownArchiveBytes"] if counts["packagesWithArchiveSize"] == len(selected) else None,
                  "originalArchiveCount": len(archive_sizes) if counts["packagesWithArchiveSize"] == len(selected) else None,
                  "cache": cache_snapshot(cache_root, cache_limit) if cache_root else None}
        if not inspect:
            atomic_json(metadata / "ready.json", result)
        return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--cache", type=Path, help="Retain and reuse original SHA512-addressed npm archives.")
    parser.add_argument("--cache-limit-bytes", type=int, help="Retain a partial cache within this byte budget; finish receiving on the installation filesystem.")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--inspect", action="store_true", help="Verify the complete received runtime without registry reads.")
    args = parser.parse_args()
    try:
        result = receive(args.directory, args.source.resolve(), args.cache, args.offline, args.inspect, args.cache_limit_bytes)
        print(json.dumps(result, separators=(",", ":")))
        return 0
    except (ReceivingError, OSError, ValueError, tarfile.TarError, urllib.error.URLError) as error:
        result = {"state": "RECEIVING_INCOMPLETE", "error": getattr(error, "code", "MPP_RUNTIME_RECEIVING_FAILED"),
                  "detail": str(error)}
        print(json.dumps(result, separators=(",", ":")), file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
