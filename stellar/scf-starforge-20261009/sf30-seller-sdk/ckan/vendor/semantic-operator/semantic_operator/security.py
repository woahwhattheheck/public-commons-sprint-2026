"""Private local files and authenticated, self-contained recovery envelopes."""
from __future__ import annotations
import base64
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import stat
import tempfile
import zipfile

MAX_FILE = 64 * 1024 * 1024
MAX_BUNDLE = 512 * 1024 * 1024
ENVELOPE = b"COMMONS-SEMANTIC-RECOVERY-1\n"
AAD = b"commons-semantic-recovery/1"
ITERATIONS = 600000

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")

def digest(data):
    return hashlib.sha256(data).hexdigest()

def read_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("A JSON object contains a duplicate field.")
            result[key] = value
        return result
    def invalid(value):
        raise ValueError("JSON numbers must be finite.")
    return json.loads(data, object_pairs_hook=pairs, parse_constant=invalid)

def private_directory(value, *, create=True):
    path = Path(value).expanduser().absolute()
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        if current.is_symlink():
            raise ValueError("A private workspace path cannot contain symbolic links.")
        if current.exists() and not current.is_dir():
            raise ValueError("A workspace parent is not a directory.")
    existed = path.exists()
    if create:
        current = Path(path.anchor)
        for part in path.parts[1:]:
            current /= part
            current.mkdir(mode=0o700, exist_ok=True)
    if not path.is_dir():
        raise ValueError("Choose an existing private directory.")
    info = path.stat()
    if hasattr(os, "getuid") and info.st_uid != os.getuid():
        raise PermissionError("The workspace must belong to the current operating-system user.")
    if stat.S_IMODE(info.st_mode) & 0o077:
        if create and not existed:
            path.chmod(0o700)
        else:
            raise PermissionError("The workspace directory must have owner-only permissions.")
    return path

def private_read(value, *, maximum=MAX_FILE):
    path = Path(value)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("Choose a regular private file.")
        if info.st_size > maximum:
            raise ValueError("The selected private file is too large.")
        if hasattr(os, "getuid") and info.st_uid != os.getuid():
            raise PermissionError("The private file belongs to another operating-system user.")
        if stat.S_IMODE(info.st_mode) & 0o077:
            raise PermissionError("Private files require owner-only permissions.")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            data = stream.read(maximum + 1)
        if len(data) > maximum:
            raise ValueError("The selected private file changed size while reading.")
        return data
    finally:
        os.close(descriptor)

def atomic_write(value, data, *, replace=True):
    path = Path(value)
    parent = private_directory(path.parent)
    if path.is_symlink():
        raise ValueError("Private output cannot replace a symbolic link.")
    if path.exists():
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("Private output cannot replace a linked or special file.")
        if hasattr(os, "getuid") and info.st_uid != os.getuid():
            raise PermissionError("Private output belongs to another user.")
    fd, temporary = tempfile.mkstemp(prefix=".write-", dir=parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        if replace:
            os.replace(temporary, path)
        else:
            os.link(temporary, path)
            os.unlink(temporary)
        directory = os.open(parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)

class PrivateVault:
    """Tokens stay encrypted outside the application database and recovery exports."""
    def __init__(self, root):
        self.root = private_directory(root)
        self.key_path = self.root / "vault.key"
        if not self.key_path.exists():
            atomic_write(self.key_path, secrets.token_bytes(32), replace=False)
        self.key = private_read(self.key_path, maximum=32)
        if len(self.key) != 32:
            raise ValueError("The private connection key is incomplete.")
    def _path(self, label):
        if not isinstance(label, str) or not label or len(label) > 160:
            raise ValueError("Choose a stable private secret identifier.")
        return self.root / (digest(label.encode()) + ".sealed")
    def get(self, label, default=None):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        path = self._path(label)
        if not path.exists():
            return default
        data = private_read(path)
        if len(data) < 28:
            raise ValueError("The encrypted connection cache is incomplete.")
        return read_json(AESGCM(self.key).decrypt(data[:12], data[12:], label.encode()))
    def put(self, label, value):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        nonce = secrets.token_bytes(12)
        encrypted = AESGCM(self.key).encrypt(nonce, canonical(value), label.encode())
        atomic_write(self._path(label), nonce + encrypted)
    def remove(self, label):
        path = self._path(label)
        if path.exists():
            private_read(path)
            path.unlink()

def pack_files(files, metadata):
    if not isinstance(files, dict) or not files or len(files) > 100000:
        raise ValueError("Choose a complete, bounded recovery file set.")
    entries = []
    total = 0
    for name, data in files.items():
        pure = Path(name)
        if (not isinstance(name, str) or "\\" in name or pure.is_absolute()
            or any(part in ("", ".", "..") for part in name.split("/"))
            or name == "RECOVERY-MANIFEST.json"):
            raise ValueError("A recovery member has an unsafe path.")
        if not isinstance(data, bytes) or len(data) > MAX_FILE:
            raise ValueError("A recovery member exceeds 64 MiB.")
        total += len(data)
        if total > MAX_BUNDLE:
            raise ValueError("The complete recovery contents exceed 512 MiB.")
        entries.append({"path": name, "bytes": len(data), "sha256": digest(data)})
    manifest = {"format": "commons-semantic-recovery-files/1",
                "metadata": metadata, "files": sorted(entries, key=lambda v: v["path"])}
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data in sorted({**files, "RECOVERY-MANIFEST.json": canonical(manifest)}.items()):
            item = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            item.create_system = 3
            item.external_attr = 0o100600 << 16
            item.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(item, data)
    data = output.getvalue()
    if len(data) > MAX_BUNDLE:
        raise ValueError("The complete recovery archive exceeds 512 MiB.")
    return data, manifest

def unpack_files(data):
    if not isinstance(data, bytes) or len(data) > MAX_BUNDLE:
        raise ValueError("Choose a complete recovery archive of at most 512 MiB.")
    files = {}
    total = 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if len(archive.infolist()) > 100001:
            raise ValueError("The recovery archive contains too many files.")
        for item in archive.infolist():
            name = item.filename
            if (not name or name in files or "\\" in name or Path(name).is_absolute()
                or any(part in ("", ".", "..") for part in name.split("/"))
                or item.is_dir() or item.flag_bits & 1
                or stat.S_IFMT(item.external_attr >> 16) == stat.S_IFLNK):
                raise ValueError("The recovery archive contains an unsafe or repeated member.")
            if item.file_size < 0 or item.file_size > MAX_FILE:
                raise ValueError("A recovery member exceeds 64 MiB.")
            total += item.file_size
            if total > MAX_BUNDLE + MAX_FILE:
                raise ValueError("The expanded recovery archive is too large.")
            value = archive.read(item)
            if len(value) != item.file_size:
                raise ValueError("A recovery member is incomplete.")
            files[name] = value
    if "RECOVERY-MANIFEST.json" not in files:
        raise ValueError("The original recovery manifest is missing.")
    manifest = read_json(files.pop("RECOVERY-MANIFEST.json"))
    if manifest.get("format") != "commons-semantic-recovery-files/1":
        raise ValueError("Choose a supported semantic workspace recovery archive.")
    expected = [{"path": name, "bytes": len(body), "sha256": digest(body)}
                for name, body in sorted(files.items())]
    if manifest.get("files") != expected:
        raise ValueError("The recovery file identities differ from their original manifest.")
    return files, manifest

def encrypt_recovery(data, passphrase):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if not isinstance(passphrase, str) or len(passphrase) < 12 or len(passphrase) > 1024:
        raise ValueError("Choose a recovery passphrase of 12 to 1,024 characters.")
    if not isinstance(data, bytes) or len(data) > MAX_BUNDLE:
        raise ValueError("The recovery archive exceeds 512 MiB.")
    salt, nonce = secrets.token_bytes(24), secrets.token_bytes(12)
    key = hashlib.pbkdf2_hmac("sha256", passphrase.encode(), salt, ITERATIONS, dklen=32)
    return ENVELOPE + salt + nonce + AESGCM(key).encrypt(nonce, data, AAD)

def decrypt_recovery(data, passphrase):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.exceptions import InvalidTag
    if (not isinstance(data, bytes) or not data.startswith(ENVELOPE)
        or len(data) > MAX_BUNDLE + 256 or len(data) < len(ENVELOPE) + 52):
        raise ValueError("Choose a complete semantic workspace recovery envelope.")
    if not isinstance(passphrase, str) or not 12 <= len(passphrase) <= 1024:
        raise ValueError("Enter the original recovery passphrase.")
    offset = len(ENVELOPE)
    salt, nonce, body = data[offset:offset + 24], data[offset + 24:offset + 36], data[offset + 36:]
    key = hashlib.pbkdf2_hmac("sha256", passphrase.encode(), salt, ITERATIONS, dklen=32)
    try:
        return AESGCM(key).decrypt(nonce, body, AAD)
    except InvalidTag as exc:
        raise ValueError("The recovery passphrase or encrypted archive is incorrect.") from exc
