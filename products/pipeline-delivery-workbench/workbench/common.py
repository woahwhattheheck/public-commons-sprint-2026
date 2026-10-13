"""Shared storage and validation for the client pipeline delivery workspace."""
from __future__ import annotations
import base64, contextlib, hashlib, json, os, re, sqlite3, tempfile, threading, uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

SCHEMA = "tjlabs.dagster-client-delivery/v1"
MAX_FILE = 32 * 1024 * 1024
MAX_PROJECT = 128 * 1024 * 1024
MAX_ARCHIVE = 512 * 1024 * 1024

class Problem(Exception):
    def __init__(self, code, message, status=400, details=None):
        super().__init__(message)
        self.code, self.message, self.status, self.details = code, message, status, details
    def as_dict(self):
        return {"code": self.code, "message": self.message, "details": self.details}

def utc():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def packed(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)

def sha(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()

def clone(value):
    return json.loads(packed(value))

def identifier(value, label="identifier"):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}", value):
        raise Problem("invalid_identifier", "Invalid " + label)
    return value

def text_value(value, label, limit=20000, required=False):
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise Problem("invalid_text", "Invalid " + label)
    return value

def path_name(value):
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise Problem("invalid_path", "A project-relative POSIX file path is required")
    p = PurePosixPath(value)
    if p.is_absolute() or ".." in p.parts or "." in p.parts or str(p) != value or len(value) > 512:
        raise Problem("invalid_path", "The file path must stay inside the selected project")
    return value

def project_path(value):
    path_name(value)
    p = PurePosixPath(value)
    banned = {"profiles.yml", "profiles.yaml", ".env", "credentials.json", "service-account.json"}
    if any(x in {"target", "logs", "dbt_packages", ".git", ".venv", "node_modules"} for x in p.parts):
        raise Problem("generated_or_private_path", "Import source files without installed dependencies, credentials, or generated targets")
    if p.name.lower() in banned or p.name.startswith(".env."):
        raise Problem("private_profile", "Keep credentials and profiles in the operator's external connection directory")
    if p.suffix.lower() not in {".sql", ".yml", ".yaml", ".csv", ".json", ".md", ".txt", ".lock", ".gitignore"} and p.name not in {".gitignore", "LICENSE", "NOTICE"}:
        raise Problem("unsupported_source", "This workspace retains dbt SQL, YAML, CSV, JSON, Markdown, and lock files")
    return value

def decode_file(value):
    if not isinstance(value, str):
        raise Problem("invalid_file", "content_base64 is required")
    try:
        result = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise Problem("invalid_file", "The source file is not valid base64") from exc
    if len(result) > MAX_FILE:
        raise Problem("file_too_large", "One source file exceeds the 32 MiB limit", 413)
    return result

def durable_write(path, data, replace=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        data = data.encode("utf-8")
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        if replace:
            os.replace(temporary, path)
        else:
            try:
                os.link(temporary, path)
            except FileExistsError:
                if path.read_bytes() != data:
                    raise Problem("immutable_file_conflict", "A retained file already has different bytes", 409, {"path": str(path)})
            os.unlink(temporary)
        d = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try: os.fsync(d)
        finally: os.close(d)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return path

def read_json(path):
    return json.loads(Path(path).read_text("utf-8"))

def process_identity(pid=None):
    pid = os.getpid() if pid is None else int(pid)
    try:
        fields = Path("/proc/" + str(pid) + "/stat").read_text().rsplit(")", 1)[1].split()
        return {"pid": pid, "start_ticks": fields[19], "namespace": os.readlink("/proc/" + str(pid) + "/ns/pid"),
                "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip()}
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        return None

def process_alive(identity):
    return bool(identity and process_identity(identity.get("pid")) == identity)

class FileLease:
    """Linux kernel lock; never delete or reclaim a writer file by PID."""
    def __init__(self, path, blocking=False):
        import fcntl
        self.fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        except BaseException:
            os.close(self.fd); self.fd = None
            raise
    @classmethod
    def adopt(cls, path, fd):
        expected, actual = os.stat(path), os.fstat(fd)
        if (expected.st_dev, expected.st_ino) != (actual.st_dev, actual.st_ino):
            raise Problem("native_lease_mismatch", "The inherited native lock does not belong to this workspace", 409)
        value = cls.__new__(cls)
        value.fd = int(fd)
        return value
    def close(self):
        if self.fd is not None:
            os.close(self.fd); self.fd = None
    def __enter__(self): return self
    def __exit__(self, *exc): self.close()

def native_available(root):
    try:
        with FileLease(Path(root) / "native.lock"):
            return True
    except BlockingIOError:
        return False
