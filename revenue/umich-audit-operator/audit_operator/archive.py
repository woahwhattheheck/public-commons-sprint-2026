"""Full encrypted recovery of the database and every retained original source."""
from __future__ import annotations

import base64
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import stat
import struct
import tempfile
import zipfile

from .store import Store, atomic_write, digest, encoded, fsync_directory, now, private_directory

MAGIC = b"COMMONS-AUDIT-BACKUP\x01\n"
ITERATIONS = 600000
MAX_ARCHIVE = 512 * 1024 * 1024
MAX_FILES = 100000

def _key(passphrase, salt, iterations):
    if not isinstance(passphrase, str) or len(passphrase) < 12 or len(passphrase.encode()) > 4096:
        raise ValueError("Use a recovery passphrase of 12 to 4096 UTF-8 bytes.")
    return hashlib.pbkdf2_hmac("sha256", passphrase.encode(), salt, iterations, dklen=32)

def _encrypt(plaintext, passphrase):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    salt, nonce = os.urandom(24), os.urandom(12)
    header = encoded({"format": "commons-audit-encrypted-backup/1", "cipher": "AES-256-GCM",
        "kdf": "PBKDF2-HMAC-SHA256", "iterations": ITERATIONS,
        "salt": base64.b64encode(salt).decode(), "nonce": base64.b64encode(nonce).decode()}).encode()
    ciphertext = AESGCM(_key(passphrase, salt, ITERATIONS)).encrypt(nonce, plaintext, header)
    return MAGIC + struct.pack(">I", len(header)) + header + ciphertext

def _decrypt(data, passphrase):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.exceptions import InvalidTag
    if not isinstance(data, bytes) or len(data) > MAX_ARCHIVE or not data.startswith(MAGIC):
        raise ValueError("Choose an original Commons audit encrypted backup, at most 512 MiB.")
    start = len(MAGIC)
    if len(data) < start + 4:
        raise ValueError("The encrypted backup header is incomplete.")
    size = struct.unpack(">I", data[start:start+4])[0]
    if not 1 <= size <= 4096 or len(data) < start + 4 + size + 16:
        raise ValueError("The encrypted backup header is invalid.")
    header = data[start+4:start+4+size]
    meta = json.loads(header)
    if (meta.get("format") != "commons-audit-encrypted-backup/1" or meta.get("cipher") != "AES-256-GCM"
        or meta.get("kdf") != "PBKDF2-HMAC-SHA256" or meta.get("iterations") != ITERATIONS):
        raise ValueError("Unsupported backup encryption parameters.")
    salt = base64.b64decode(meta["salt"], validate=True)
    nonce = base64.b64decode(meta["nonce"], validate=True)
    if len(salt) != 24 or len(nonce) != 12:
        raise ValueError("Invalid backup salt or nonce.")
    try:
        return AESGCM(_key(passphrase, salt, ITERATIONS)).decrypt(nonce, data[start+4+size:], header)
    except InvalidTag:
        raise ValueError("The recovery passphrase or original backup bytes do not match.") from None

def create_backup(store, passphrase):
    stream = io.BytesIO()
    entries = []
    with store.backup_snapshot() as (database, sources):
        unique = {s["sha256"]: s for s in sources}
        if len(unique) + 1 > MAX_FILES:
            raise ValueError("This backup exceeds the 100,000-file operating limit.")
        files = [("workspace.sqlite", database.read_bytes())]
        total = len(files[0][1])
        for sha, source in sorted(unique.items()):
            data = store.bytes(sha)
            if len(data) != source["bytes"]:
                raise ValueError("Original source size changed: " + source["id"])
            total += len(data)
            if total > MAX_ARCHIVE - 1024 * 1024:
                raise ValueError("This recovery package exceeds the 512 MiB operating limit.")
            files.append(("objects/" + sha, data))
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path, data in files:
                archive.writestr(path, data)
                entries.append({"path": path, "bytes": len(data), "sha256": digest(data)})
            manifest = {"format": "commons-audit-backup/1", "workspace_id": store.setting("workspace_id"),
                        "created_at": now(), "files": entries, "source_count": len(sources),
                        "recovery": "New directory; original records/history retained; access links and sessions renewed."}
            archive.writestr("MANIFEST.json", encoded(manifest).encode())
    data = _encrypt(stream.getvalue(), passphrase)
    if len(data) > MAX_ARCHIVE:
        raise ValueError("Encrypted recovery package exceeds 512 MiB.")
    return data, {**manifest, "encrypted_sha256": digest(data), "encrypted_bytes": len(data)}

def inspect_backup(data, passphrase):
    plaintext = _decrypt(data, passphrase)
    with zipfile.ZipFile(io.BytesIO(plaintext)) as archive:
        items = archive.infolist()
        if not items or len(items) > MAX_FILES + 1 or sum(i.file_size for i in items) > MAX_ARCHIVE:
            raise ValueError("The recovery archive exceeds its complete operating limits.")
        names = set()
        contents = {}
        for item in items:
            p = PurePosixPath(item.filename)
            mode = (item.external_attr >> 16) & 0o170000
            if (item.filename in names or not item.filename or "\\" in item.filename or
                p.is_absolute() or any(v in {"", ".", ".."} for v in p.parts) or
                item.is_dir() or item.flag_bits & 1 or mode == stat.S_IFLNK or
                item.filename not in {"MANIFEST.json", "workspace.sqlite"}
                and not (len(p.parts) == 2 and p.parts[0] == "objects" and len(p.parts[1]) == 64 and all(c in "0123456789abcdef" for c in p.parts[1]))):
                raise ValueError("The recovery archive contains an invalid or duplicate member.")
            names.add(item.filename)
            contents[item.filename] = archive.read(item)
    if "MANIFEST.json" not in contents or "workspace.sqlite" not in contents:
        raise ValueError("The recovery manifest or database is absent.")
    manifest = json.loads(contents.pop("MANIFEST.json"))
    if manifest.get("format") != "commons-audit-backup/1" or not isinstance(manifest.get("files"), list):
        raise ValueError("Unsupported recovery manifest.")
    expected = {}
    for entry in manifest["files"]:
        if not isinstance(entry, dict) or entry.get("path") in expected:
            raise ValueError("Recovery manifest repeats an entry.")
        expected[entry["path"]] = entry
    if set(expected) != set(contents):
        raise ValueError("The manifest does not account for every recovery file.")
    for path, value in contents.items():
        entry = expected[path]
        if entry.get("bytes") != len(value) or entry.get("sha256") != digest(value):
            raise ValueError("A complete recovery file failed its original hash or size check.")
        if path.startswith("objects/") and path.split("/")[1] != digest(value):
            raise ValueError("A retained object name does not match its bytes.")
    return manifest, contents

def restore_backup(data, passphrase, destination):
    manifest, contents = inspect_backup(data, passphrase)
    destination = Path(destination).expanduser().absolute()
    if destination.exists() or destination.is_symlink():
        raise ValueError("Restore into a new directory; an existing workspace is never overwritten.")
    parent = private_directory(destination.parent)
    if parent.resolve() != parent:
        raise ValueError("Use a real private receiving parent directory.")
    temporary = Path(tempfile.mkdtemp(prefix=".restore-", dir=parent))
    try:
        for name, content in contents.items():
            path = temporary / name
            private_directory(path.parent)
            atomic_write(path, content)
        database = temporary / "workspace.sqlite"
        db = sqlite3.connect(database)
        try:
            if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise ValueError("The restored SQLite database did not pass its native consistency check.")
            row = db.execute("SELECT value FROM settings WHERE key='workspace_id'").fetchone()
            if not row or row[0] != manifest["workspace_id"]:
                raise ValueError("The recovery workspace identity changed.")
            for row in db.execute("SELECT body FROM sources"):
                source = json.loads(row[0])
                original = contents.get("objects/" + source["sha256"])
                if original is None or len(original) != source["bytes"] or digest(original) != source["sha256"]:
                    raise ValueError("The restored database refers to an absent or changed original source.")
            with db:
                db.execute("DELETE FROM sessions")
                db.execute("DELETE FROM grants")
                db.execute("INSERT OR REPLACE INTO settings VALUES('restored_from',?)", (digest(data),))
                db.execute("INSERT OR REPLACE INTO settings VALUES('restored_at',?)", (now(),))
        finally:
            db.close()
        restored = Store(temporary)
        try:
            restored.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            count = len(restored.records())
            # The owner key exists only inside this new private receiving directory.
        finally:
            restored.close()
        if destination.exists():
            raise ValueError("The receiving destination appeared during restoration.")
        os.rename(temporary, destination)
        fsync_directory(parent)
        return {"workspace_id": manifest["workspace_id"], "directory": str(destination),
                "files": len(contents), "records": count, "source_count": manifest["source_count"],
                "backup_sha256": digest(data), "access_renewed": True, "restored_at": now()}
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
