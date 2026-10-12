"""MIT. Bind the original OAI workspace and source for managed Applications."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys
from urllib.parse import quote
from bridge import InputError

SCHEMA = "stellar-forge.oai-managed-binding.v1"
STARTUP = "stellar-forge.oai-workspace-launch.v1"
SOURCE = Path(__file__).resolve().parents[1]
SOURCE_FILES = (
    "oai-pmh/bridge.py", "oai-pmh/protocol.py", "oai-pmh/harvest.py",
    "oai-pmh/workspace.py", "oai-pmh/cli.py", "oai-pmh/cli.mjs",
    "oai-pmh/server.py", "oai-pmh/managed.py", "oai-pmh/index.html",
    "oai-pmh/browser.mjs", "oai-pmh/style.css",
    "xml/xml_source.py", "xml/workspace.py", "xml/native.mjs", "dataset-handler.mjs",
)

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))+"\n").encode()

def regular(path, *, private=False, limit=None):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or limit is not None and info.st_size > limit:
        raise InputError("Choose an original regular OAI workspace/source file: "+str(path))
    if private and os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise InputError("OAI workspace metadata must remain private and operator-owned")
    return info

def source_digest(path):
    info = regular(path, limit=4*1024*1024)
    result = hashlib.sha256()
    with path.open("rb") as handle:
        opened = os.fstat(handle.fileno())
        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            raise InputError("Original OAI source changed while opening")
        for data in iter(lambda: handle.read(65536), b""):
            result.update(data)
        after = os.fstat(handle.fileno())
    if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (info.st_size, info.st_mtime_ns, info.st_ctime_ns):
        raise InputError("Original OAI source changed while reading")
    return result.hexdigest()

def inspect_binding(directory):
    """Read identity without constructing Workspace or recovering active requests."""
    raw = Path(directory).expanduser().absolute()
    root = raw.resolve(strict=True)
    if raw != root or root.is_symlink():
        raise InputError("Choose the original absolute OAI workspace without path aliases")
    info = root.stat()
    if not stat.S_ISDIR(info.st_mode) or os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise InputError("Choose the original private, operator-owned OAI workspace")
    marker = root/"workspace.json"
    marker_info = regular(marker, private=True, limit=4096)
    data = marker.read_bytes()
    if json.loads(data) != {"schema":"stellar-forge.xml-workspace.v1"}:
        raise InputError("Choose a workspace initialized by the original OAI command")
    database = regular(root/"workspace.sqlite", private=True)
    for name in ("sources","plans","builds","comparisons","tmp","oai","oai/http","oai/builds","oai/tmp"):
        item = root/name
        if item.is_symlink() or not item.is_dir():
            raise InputError("Original OAI storage directory is missing: "+name)
    connection = sqlite3.connect("file:"+quote(str(root/"workspace.sqlite"), safe="/")+ "?mode=ro", uri=True)
    try:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"oai_repositories","oai_operations","oai_requests","oai_observations","oai_editions","oai_builds"} <= tables:
            raise InputError("Choose a workspace initialized by the original OAI command")
    finally:
        connection.close()
    if sys.version_info < (3,11):
        raise InputError("The original OAI workspace requires Python 3.11 or newer")
    value = {
        "schema":SCHEMA, "workspace":str(root), "sourceRoot":str(SOURCE),
        "workspaceIdentity":{"device":str(info.st_dev), "inode":str(info.st_ino),
            "markerDevice":str(marker_info.st_dev), "markerInode":str(marker_info.st_ino),
            "markerSha256":hashlib.sha256(data).hexdigest(),
            "databaseDevice":str(database.st_dev), "databaseInode":str(database.st_ino)},
        "python":{"executable":str(Path(sys.executable).absolute()), "prefix":sys.prefix,
            "basePrefix":sys.base_prefix, "implementation":sys.implementation.name,
            "version":list(sys.version_info[:3])},
        "source":{name:source_digest(SOURCE/name) for name in SOURCE_FILES},
    }
    bound = {key:value for key,value in value.items() if key != "sourceRoot"}
    return value | {"sha256":hashlib.sha256(encoded(bound)).hexdigest()}

def require_binding(directory, expected=None):
    value = inspect_binding(directory)
    if expected is not None and (not isinstance(expected,str) or len(expected)!=64 or
            any(char not in "0123456789abcdef" for char in expected) or expected != value["sha256"]):
        raise InputError("The selected OAI workspace, Python or source changed; review this application again")
    return value

def startup(server, binding, token):
    console = "http://127.0.0.1:"+str(server.server_port)+"/#"+token
    return {"schema":STARTUP, "status":"OAI_WORKSPACE_READY",
        "workspace":binding["workspace"], "bindingSha256":binding["sha256"],
        "sourceRoot":binding["sourceRoot"], "python":binding["python"],
        "console":console, "url":console, "pid":os.getpid()}
