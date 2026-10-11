"""Authenticated workspace backup and verified restoration to a new directory."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import secrets
import shutil
import sqlite3
import tempfile
import zipfile
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from .store import atomic_write, encoded, digest, now

MAGIC = b"COMMONS-BI-BACKUP-1\n"
ITERATIONS = 600000
CHUNK = 1024 * 1024


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


def backup(store, destination, password):
    destination = Path(destination).expanduser().resolve()
    if destination.exists():
        raise ValueError("Choose a new filename for the encrypted backup.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with store.snapshot() as (database, objects), tempfile.TemporaryDirectory(prefix="bi-backup-", dir=destination.parent) as temp:
        archive = Path(temp) / "workspace.zip"
        manifest = {"format": "commons-bi-workspace/1", "workspace_id": store.setting("workspace_id"),
                    "created": now(), "files": []}
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
            files = [("workspace.sqlite", database)]
            files += [("objects/" + item["digest"], store.blobs / item["digest"]) for item in objects]
            for relative, path in files:
                if path.is_symlink():
                    raise ValueError("A workspace backup cannot contain symbolic links.")
                sha = file_hash(path)
                if relative.startswith("objects/") and sha != Path(relative).name:
                    raise ValueError("An immutable input changed before backup.")
                output.write(path, relative)
                manifest["files"].append({"path": relative, "bytes": path.stat().st_size, "sha256": sha})
            output.writestr("MANIFEST.json", encoded(manifest))
        salt, nonce = secrets.token_bytes(16), secrets.token_bytes(12)
        header = MAGIC + salt + nonce
        encryptor = Cipher(algorithms.AES(_key(password, salt)), modes.GCM(nonce)).encryptor()
        encryptor.authenticate_additional_data(header)
        encrypted = Path(temp) / "encrypted"
        with encrypted.open("wb") as output, archive.open("rb") as source:
            output.write(header)
            while block := source.read(CHUNK):
                output.write(encryptor.update(block))
            output.write(encryptor.finalize())
            output.write(encryptor.tag)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(encrypted, 0o600)
        os.replace(encrypted, destination)
    return {"path": str(destination), "bytes": destination.stat().st_size, "sha256": file_hash(destination),
            "workspace_id": manifest["workspace_id"], "files": len(manifest["files"])}


def restore(source, destination, password):
    source, destination = Path(source).expanduser().resolve(), Path(destination).expanduser().resolve()
    if destination.exists():
        raise ValueError("Restore into a new directory; the original workspace stays available.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="bi-restore-", dir=destination.parent) as temp:
        temp = Path(temp)
        archive = temp / "workspace.zip"
        total = source.stat().st_size
        header_size = len(MAGIC) + 28
        if total < header_size + 16:
            raise ValueError("The encrypted backup is incomplete.")
        with source.open("rb") as encrypted:
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
                with archive.open("wb") as output:
                    while remaining:
                        block = encrypted.read(min(CHUNK, remaining))
                        if not block:
                            raise ValueError("The encrypted backup is incomplete.")
                        remaining -= len(block)
                        output.write(decryptor.update(block))
                    output.write(decryptor.finalize())
            except Exception:
                raise ValueError("The backup passphrase or authenticated backup content is incorrect.")
        staging = temp / "restored"
        staging.mkdir(mode=0o700)
        with zipfile.ZipFile(archive) as package:
            infos = package.infolist()
            names = [i.filename for i in infos]
            if len(names) != len(set(names)) or len(names) > 100000:
                raise ValueError("The archive has duplicate names or too many entries.")
            if sum(i.file_size for i in infos) > 8 * 1024 * 1024 * 1024:
                raise ValueError("The backup exceeds the 8 GiB restoration limit.")
            manifest_info = package.getinfo("MANIFEST.json")
            if manifest_info.file_size > 32 * 1024 * 1024:
                raise ValueError("The backup manifest is too large.")
            manifest = json.loads(package.read("MANIFEST.json"))
            expected = {entry["path"]: entry for entry in manifest["files"]}
            if set(names) != set(expected) | {"MANIFEST.json"} or len(expected) != len(manifest["files"]):
                raise ValueError("The archive contents do not match its manifest.")
            for relative, entry in expected.items():
                path = PurePosixPath(relative)
                if path.is_absolute() or ".." in path.parts or "\\" in relative:
                    raise ValueError("The backup contains an invalid path.")
                if relative != "workspace.sqlite" and not (len(path.parts) == 2 and path.parts[0] == "objects"):
                    raise ValueError("The backup contains an unknown workspace file.")
                info = package.getinfo(relative)
                if (info.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError("The backup contains a symbolic link.")
                output_path = staging / relative
                output_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with package.open(relative) as src, output_path.open("wb") as out:
                    shutil.copyfileobj(src, out, CHUNK)
                os.chmod(output_path, 0o600)
                if output_path.stat().st_size != entry["bytes"] or file_hash(output_path) != entry["sha256"]:
                    raise ValueError("A restored workspace file does not match its manifest.")
                if relative.startswith("objects/") and Path(relative).name != entry["sha256"]:
                    raise ValueError("A restored immutable object has the wrong identity.")
        connection = sqlite3.connect(staging / "workspace.sqlite")
        try:
            if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("The restored database did not pass its native integrity check.")
            workspace_id = connection.execute("SELECT value FROM settings WHERE key='workspace_id'").fetchone()[0]
            if workspace_id != manifest["workspace_id"]:
                raise ValueError("The restored workspace identity differs from its manifest.")
            # A new local browser token protects the restored host; business identities persist.
            connection.execute("UPDATE settings SET value=? WHERE key='access_token'", (secrets.token_urlsafe(32),))
            connection.commit()
        finally:
            connection.close()
        os.replace(staging, destination)
    return {"path": str(destination), "workspace_id": workspace_id, "files": len(expected)}
