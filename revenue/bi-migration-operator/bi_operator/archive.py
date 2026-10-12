"""Authenticated workspace backup and verified restoration to a new directory."""
from __future__ import annotations

import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import sqlite3
import stat
import sys
import tempfile
import zipfile
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from .store import encoded, now

MAGIC = b"COMMONS-BI-BACKUP-1\n"
ITERATIONS = 600000
CHUNK = 1024 * 1024
MAX_FILES = 100000
MAX_EXPANDED_BYTES = 8 * 1024 * 1024 * 1024
MAX_MANIFEST_BYTES = 32 * 1024 * 1024
SHA256 = re.compile(r"[a-f0-9]{64}\Z")


def _key(password, salt):
    if not isinstance(password, str) or len(password) < 12:
        raise ValueError("Use a backup passphrase containing at least 12 characters.")
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS).derive(password.encode())


def file_hash(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as source:
        while block := source.read(CHUNK):
            value.update(block)
    return value.hexdigest()


def _destination(value):
    path = Path(value).expanduser()
    if path.name in ("", ".", ".."):
        raise ValueError("Choose a new named backup file or workspace directory.")
    # Resolve the parent, not the final entry: dangling symlinks also occupy a name.
    path = path.parent.resolve() / path.name
    if os.path.lexists(path):
        raise ValueError("Choose a new destination; an existing file or directory cannot be replaced.")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def _sync_directory(path):
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _publish_directory(source, destination):
    """Atomically publish a complete workspace without replacing a competing entry."""
    if os.name == "nt":
        os.rename(source, destination)
    else:
        library = ctypes.CDLL(None, use_errno=True)
        if sys.platform.startswith("linux") and hasattr(library, "renameat2"):
            function = library.renameat2
            function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
            function.restype = ctypes.c_int
            result = function(-100, os.fsencode(source), -100, os.fsencode(destination), 1)
        elif sys.platform == "darwin" and hasattr(library, "renamex_np"):
            function = library.renamex_np
            function.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
            function.restype = ctypes.c_int
            result = function(os.fsencode(source), os.fsencode(destination), 4)
        else:
            raise OSError(errno.ENOTSUP, "This platform needs an atomic exclusive directory rename.")
        if result:
            code = ctypes.get_errno()
            raise OSError(code, os.strerror(code), str(destination))
    _sync_directory(destination.parent)


def _regular_file(path):
    if Path(path).is_symlink():
        raise ValueError("A workspace backup cannot contain symbolic links.")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    if not stat.S_ISREG(os.fstat(descriptor).st_mode):
        os.close(descriptor)
        raise ValueError("A workspace backup can contain only regular files.")
    return os.fdopen(descriptor, "rb")


def _manifest(package):
    infos = package.infolist()
    names = [item.filename for item in infos]
    if len(names) != len(set(names)) or len(names) > MAX_FILES:
        raise ValueError("The archive has duplicate names or too many entries.")
    if sum(item.file_size for item in infos) > MAX_EXPANDED_BYTES:
        raise ValueError("The backup exceeds the 8 GiB restoration limit.")
    for item in infos:
        kind = stat.S_IFMT(item.external_attr >> 16)
        if kind not in (0, stat.S_IFREG) or item.is_dir():
            raise ValueError("The backup can contain only regular workspace files.")
    if "MANIFEST.json" not in names:
        raise ValueError("The backup does not contain a workspace manifest.")
    if package.getinfo("MANIFEST.json").file_size > MAX_MANIFEST_BYTES:
        raise ValueError("The backup manifest is too large.")
    manifest = json.loads(package.read("MANIFEST.json"))
    if not isinstance(manifest, dict) or manifest.get("format") != "commons-bi-workspace/1":
        raise ValueError("The backup manifest format is not supported.")
    if not isinstance(manifest.get("workspace_id"), str) or not re.fullmatch(r"[a-f0-9]{32}", manifest["workspace_id"]):
        raise ValueError("The backup manifest has an invalid workspace identity.")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise ValueError("The backup manifest must identify its workspace files.")
    expected = {}
    for entry in files:
        if not isinstance(entry, dict):
            raise ValueError("The backup manifest contains an invalid file entry.")
        relative, size, sha = entry.get("path"), entry.get("bytes"), entry.get("sha256")
        if not isinstance(relative, str) or not relative or "\x00" in relative:
            raise ValueError("The backup contains an invalid path.")
        path = PurePosixPath(relative)
        if path.is_absolute() or ".." in path.parts or "\\" in relative or path.as_posix() != relative:
            raise ValueError("The backup contains an invalid path.")
        if relative != "workspace.sqlite" and not (
            len(path.parts) == 2 and path.parts[0] == "objects" and SHA256.fullmatch(path.name)
        ):
            raise ValueError("The backup contains an unknown workspace file.")
        if type(size) is not int or size < 0 or not isinstance(sha, str) or not SHA256.fullmatch(sha):
            raise ValueError("The backup contains invalid file metadata.")
        if relative in expected:
            raise ValueError("The backup manifest repeats a file.")
        expected[relative] = entry
    if "workspace.sqlite" not in expected or set(names) != set(expected) | {"MANIFEST.json"}:
        raise ValueError("The archive contents do not match its manifest.")
    for relative, entry in expected.items():
        if package.getinfo(relative).file_size != entry["bytes"]:
            raise ValueError("A workspace file size differs from its manifest.")
        if relative.startswith("objects/") and PurePosixPath(relative).name != entry["sha256"]:
            raise ValueError("An immutable object has the wrong identity.")
    return manifest, expected


def backup(store, destination, password):
    destination = _destination(destination)
    salt, nonce = secrets.token_bytes(16), secrets.token_bytes(12)
    key = _key(password, salt)
    with store.snapshot() as (database, objects), tempfile.TemporaryDirectory(prefix="bi-backup-", dir=destination.parent) as temp:
        archive = Path(temp) / "workspace.zip"
        manifest = {"format": "commons-bi-workspace/1", "workspace_id": store.setting("workspace_id"),
                    "created": now(), "files": []}
        if len(objects) + 2 > MAX_FILES:
            raise ValueError("The workspace exceeds the backup file limit.")
        files = [("workspace.sqlite", database, None)]
        for item in objects:
            if not isinstance(item["digest"], str) or not SHA256.fullmatch(item["digest"]):
                raise ValueError("The workspace contains an invalid immutable object identity.")
            files.append(("objects/" + item["digest"], store.blobs / item["digest"], item["size"]))
        total_bytes = 0
        with archive.open("xb") as archive_file:
            os.chmod(archive, 0o600)
            with zipfile.ZipFile(archive_file, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
                for relative, path, expected_size in files:
                    sha, size = hashlib.sha256(), 0
                    with _regular_file(path) as source, output.open(relative, "w", force_zip64=True) as target:
                        while block := source.read(CHUNK):
                            size += len(block)
                            total_bytes += len(block)
                            if total_bytes > MAX_EXPANDED_BYTES:
                                raise ValueError("The workspace exceeds the 8 GiB backup limit.")
                            target.write(block)
                            sha.update(block)
                    sha = sha.hexdigest()
                    if expected_size is not None and (size != expected_size or sha != PurePosixPath(relative).name):
                        raise ValueError("An immutable workspace object differs from its recorded identity.")
                    manifest["files"].append({"path": relative, "bytes": size, "sha256": sha})
                document = encoded(manifest).encode("utf-8")
                if len(document) > MAX_MANIFEST_BYTES or total_bytes + len(document) > MAX_EXPANDED_BYTES:
                    raise ValueError("The workspace exceeds the backup manifest or restoration limit.")
                output.writestr("MANIFEST.json", document)
            archive_file.flush()
        header = MAGIC + salt + nonce
        encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
        encryptor.authenticate_additional_data(header)
        encrypted = Path(temp) / "encrypted"
        encrypted_hash = hashlib.sha256()
        with encrypted.open("xb") as output, archive.open("rb") as source:
            os.chmod(encrypted, 0o600)
            output.write(header)
            encrypted_hash.update(header)
            while block := source.read(CHUNK):
                ciphertext = encryptor.update(block)
                output.write(ciphertext)
                encrypted_hash.update(ciphertext)
            final = encryptor.finalize() + encryptor.tag
            output.write(final)
            encrypted_hash.update(final)
            output.flush()
            os.fsync(output.fileno())
        size = encrypted.stat().st_size
        # Both paths share a filesystem. Linking commits a finished file exclusively;
        # a name created during compression/encryption is never overwritten.
        os.link(encrypted, destination)
        _sync_directory(destination.parent)
    return {"path": str(destination), "bytes": size, "sha256": encrypted_hash.hexdigest(),
            "workspace_id": manifest["workspace_id"], "files": len(manifest["files"])}


def restore(source, destination, password):
    source, destination = Path(source).expanduser().resolve(), _destination(destination)
    with tempfile.TemporaryDirectory(prefix="bi-restore-", dir=destination.parent) as temp:
        temp = Path(temp)
        archive = temp / "workspace.zip"
        header_size = len(MAGIC) + 28
        with _regular_file(source) as encrypted:
            total = os.fstat(encrypted.fileno()).st_size
            if total < header_size + 16:
                raise ValueError("The encrypted backup is incomplete.")
            header = encrypted.read(header_size)
            if not header.startswith(MAGIC):
                raise ValueError("This is not a Commons BI backup.")
            salt, nonce = header[len(MAGIC):len(MAGIC)+16], header[-12:]
            encrypted.seek(-16, os.SEEK_END)
            tag = encrypted.read(16)
            encrypted.seek(header_size)
            decryptor = Cipher(algorithms.AES(_key(password, salt)), modes.GCM(nonce, tag)).decryptor()
            decryptor.authenticate_additional_data(header)
            remaining = total - header_size - 16
            try:
                with archive.open("xb") as output:
                    os.chmod(archive, 0o600)
                    while remaining:
                        block = encrypted.read(min(CHUNK, remaining))
                        if not block:
                            raise ValueError("The encrypted backup is incomplete.")
                        remaining -= len(block)
                        output.write(decryptor.update(block))
                    output.write(decryptor.finalize())
            except InvalidTag as error:
                raise ValueError("The backup passphrase or authenticated backup content is incorrect.") from error
        staging = temp / "restored"
        staging.mkdir(mode=0o700)
        with zipfile.ZipFile(archive) as package:
            manifest, expected = _manifest(package)
            for relative, entry in expected.items():
                output_path = staging / relative
                output_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                sha, size = hashlib.sha256(), 0
                with package.open(relative) as src, output_path.open("xb") as out:
                    os.chmod(output_path, 0o600)
                    while block := src.read(CHUNK):
                        size += len(block)
                        if size > entry["bytes"]:
                            raise ValueError("A restored workspace file exceeds its manifest size.")
                        out.write(block)
                        sha.update(block)
                    out.flush()
                    os.fsync(out.fileno())
                if size != entry["bytes"] or sha.hexdigest() != entry["sha256"]:
                    raise ValueError("A restored workspace file does not match its manifest.")
        database = staging / "workspace.sqlite"
        connection = sqlite3.connect(database.as_uri() + "?mode=rw", uri=True)
        try:
            if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("The restored database did not pass its native integrity check.")
            identity = connection.execute("SELECT value FROM settings WHERE key='workspace_id'").fetchone()
            if identity is None or identity[0] != manifest["workspace_id"]:
                raise ValueError("The restored workspace identity differs from its manifest.")
            workspace_id = identity[0]
            recorded = {}
            for sha, size in connection.execute("SELECT digest,size FROM blobs"):
                if not isinstance(sha, str) or not SHA256.fullmatch(sha) or type(size) is not int or size < 0:
                    raise ValueError("The restored database contains an invalid immutable object.")
                recorded["objects/" + sha] = (size, sha)
            restored = {name: (entry["bytes"], entry["sha256"]) for name, entry in expected.items()
                        if name.startswith("objects/")}
            if recorded != restored:
                raise ValueError("The backup does not contain every object referenced by its database.")
            if connection.execute("""SELECT 1 FROM heads h LEFT JOIN revisions r
                ON h.kind=r.kind AND h.id=r.id AND h.revision=r.revision
                WHERE r.revision IS NULL LIMIT 1""").fetchone():
                raise ValueError("A retained workspace head has no corresponding revision.")
            # Rotate browser access only. Business and provider operation identities persist.
            connection.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('access_token',?)",
                               (secrets.token_urlsafe(32),))
            connection.commit()
            connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            connection.close()
        with database.open("rb") as persisted:
            os.fsync(persisted.fileno())
        if (staging / "objects").exists():
            _sync_directory(staging / "objects")
        _sync_directory(staging)
        _publish_directory(staging, destination)
    return {"path": str(destination), "workspace_id": workspace_id, "files": len(expected)}
