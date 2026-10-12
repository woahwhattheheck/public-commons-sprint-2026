"""MIT. Original Kafka workspace, Python and complete source binding for Applications."""
from __future__ import annotations
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import stat
import sys
import tempfile
import uuid

from shared import SOURCE, InputError, json_bytes, load_json

SCHEMA = "stellar-forge.kafka-managed-binding.v1"
STARTUP = "stellar-forge.kafka-workspace-launch.v1"
SOURCE_FILES = (
    "kafka/shared.py", "kafka/contract.py", "kafka/transport.py", "kafka/model.py",
    "kafka/httpd.py", "kafka/managed.py", "kafka/cli.py", "kafka/cli.mjs",
    "kafka/browser-assets.json", "kafka/public/index.html", "kafka/public/app.js", "kafka/public/style.css",
    "ndjson/application.py", "ndjson/cli.py", "ndjson/cli.mjs", "ndjson/ndjson_source.py",
    "ndjson/managed.py", "ndjson/merchant.mjs", "ndjson/public/index.html",
    "ndjson/public/app.js", "ndjson/public/style.css",
    "xml/xml_source.py", "xml/workspace.py", "xml/server.py", "xml/native.mjs",
    "dataset-handler.mjs",
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def regular(path, private=False, limit=None):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or limit is not None and info.st_size > limit:
        raise InputError("Choose an original regular Kafka workspace or source file")
    if private and os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise InputError("Original Kafka workspace metadata must remain private and operator-owned")
    return info


def source_digest(path):
    info = regular(path, limit=4 * 1024 * 1024)
    checksum = hashlib.sha256()
    with path.open("rb") as source:
        opened = os.fstat(source.fileno())
        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            raise InputError("Original Kafka source changed while opening")
        for data in iter(lambda: source.read(65536), b""):
            checksum.update(data)
        after = os.fstat(source.fileno())
    if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (info.st_size, info.st_mtime_ns, info.st_ctime_ns):
        raise InputError("Original Kafka source changed while reading")
    return checksum.hexdigest()


def marker(path, expected_schema, with_identity=False):
    info = regular(path, private=True, limit=4096)
    data = path.read_bytes()
    value = load_json(data)
    if with_identity:
        if not isinstance(value, dict) or set(value) != {"schema", "id"} or value["schema"] != expected_schema:
            raise InputError("Choose an original initialized or received Kafka workspace")
        try:
            if str(uuid.UUID(value["id"])) != value["id"]:
                raise ValueError()
        except (ValueError, TypeError, AttributeError) as error:
            raise InputError("The original Kafka workspace identity changed") from error
    elif value != {"schema": expected_schema}:
        raise InputError("The original NDJSON workspace marker changed")
    return info, data, value


def inspect_binding(directory):
    if sys.version_info < (3, 11):
        raise InputError("The original Kafka workspace requires Python 3.11 or newer")
    raw = Path(directory).expanduser().absolute()
    root = raw.resolve(strict=True)
    if raw != root or root.is_symlink():
        raise InputError("Choose the original absolute Kafka workspace without path aliases")
    info = root.stat()
    if not stat.S_ISDIR(info.st_mode) or os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise InputError("Choose the original private, operator-owned Kafka workspace")
    original, original_bytes, _ = marker(root / "workspace.json", "stellar-forge.ndjson-workspace.v1")
    kafka, kafka_bytes, kafka_value = marker(root / "kafka-workspace.json", "stellar-forge.kafka-workspace.v1", True)
    database = regular(root / "workspace.sqlite", private=True)
    kafka_database = regular(root / "kafka.sqlite", private=True)
    for name in ("sources", "plans", "builds", "comparisons", "tmp"):
        item = root / name
        if item.is_symlink() or not item.is_dir():
            raise InputError("Original Kafka source storage is missing: " + name)
    value = {"schema": SCHEMA, "workspace": str(root), "sourceRoot": str(SOURCE),
        "workspaceId": kafka_value["id"],
        "workspaceIdentity": {
            "device": str(info.st_dev), "inode": str(info.st_ino),
            "markerDevice": str(original.st_dev), "markerInode": str(original.st_ino),
            "markerSha256": digest(original_bytes),
            "databaseDevice": str(database.st_dev), "databaseInode": str(database.st_ino),
            "kafkaMarkerDevice": str(kafka.st_dev), "kafkaMarkerInode": str(kafka.st_ino),
            "kafkaMarkerSha256": digest(kafka_bytes),
            "kafkaDatabaseDevice": str(kafka_database.st_dev), "kafkaDatabaseInode": str(kafka_database.st_ino),
        },
        "python": {"executable": str(Path(sys.executable).absolute()), "prefix": sys.prefix,
                   "basePrefix": sys.base_prefix, "implementation": sys.implementation.name,
                   "version": list(sys.version_info[:3])},
        "source": {name: source_digest(SOURCE / name) for name in SOURCE_FILES},
    }
    bound = {key: item for key, item in value.items() if key != "sourceRoot"}
    return value | {"sha256": digest(json_bytes(bound))}


def require_binding(directory, expected=None):
    value = inspect_binding(directory)
    if expected is not None and (not isinstance(expected, str) or len(expected) != 64 or
            any(char not in "0123456789abcdef" for char in expected) or expected != value["sha256"]):
        raise InputError("The selected Kafka workspace, Python or original source changed; review this application again")
    return value


def startup(server, binding, connection_file=None):
    value = {"schema": STARTUP, "status": "KAFKA_WORKSPACE_READY",
        "workspace": binding["workspace"], "workspaceId": binding["workspaceId"],
        "bindingSha256": binding["sha256"], "sourceRoot": binding["sourceRoot"],
        "python": binding["python"], "pid": os.getpid(), "console": server.url}
    if connection_file is not None:
        value["connectionFile"] = connection_file
    return value


@contextmanager
def published_connection(filename, url):
    if filename is None:
        yield None
        return
    destination = Path(filename).expanduser().absolute()
    encoded = (url + "\n").encode("utf-8")
    descriptor, temporary = tempfile.mkstemp(prefix="." + destination.name + "-", dir=destination.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as output:
            os.chmod(temporary, 0o600)
            output.write(encoded)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, destination, follow_symlinks=False)
        except FileExistsError as error:
            raise InputError("Connection file already exists; use its original running console or remove that stale connection after its process stops") from error
    finally:
        temporary.unlink(missing_ok=True)
    try:
        yield str(destination)
    finally:
        try:
            info = destination.lstat()
            if stat.S_ISREG(info.st_mode) and info.st_size == len(encoded) and destination.read_bytes() == encoded:
                destination.unlink()
        except FileNotFoundError:
            pass
