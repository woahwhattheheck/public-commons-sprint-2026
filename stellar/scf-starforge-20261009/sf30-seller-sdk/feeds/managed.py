"""MIT. Original feed workspace/source binding and managed console startup."""
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import stat
import sys

from original import InputError, digest, json_bytes, load_json

SCHEMA = "stellar-forge.feed-managed-binding.v1"
STARTUP = "stellar-forge.feed-workspace-launch.v1"
SOURCE = Path(__file__).resolve().parents[1]
SOURCE_FILES = (
    "feeds/original.py", "feeds/feed_source.py", "feeds/feed_workspace.py",
    "feeds/opml_source.py", "feeds/subscriptions.py", "feeds/subscriptions_cli.py",
    "feeds/operations.py", "feeds/cli.py", "feeds/cli.mjs", "feeds/server.py", "feeds/managed.py",
    "feeds/public/index.html", "feeds/public/app.js", "feeds/public/style.css",
    "feeds/public/subscriptions.html", "feeds/public/subscriptions.js", "feeds/public/subscriptions.css",
    "xml/xml_source.py", "xml/workspace.py", "xml/native.mjs", "dataset-handler.mjs",
)

def regular(path, *, private=False, limit=None):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or limit is not None and info.st_size > limit:
        raise InputError("Choose an original regular feed workspace/source file: " + str(path))
    if private and os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise InputError("Feed workspace metadata must remain private and operator-owned")
    return info

def source_digest(path):
    info = regular(path, limit=4*1024*1024)
    result = hashlib.sha256()
    with path.open("rb") as handle:
        opened = os.fstat(handle.fileno())
        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            raise InputError("Original feed source changed while opening")
        for data in iter(lambda:handle.read(65536), b""):
            result.update(data)
        after = os.fstat(handle.fileno())
    if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (info.st_size, info.st_mtime_ns, info.st_ctime_ns):
        raise InputError("Original feed source changed while reading")
    return result.hexdigest()

def inspect_binding(directory):
    """Read original identity and source bytes; current feed rows stay mutable."""
    raw = Path(directory).expanduser().absolute()
    root = raw.resolve(strict=True)
    if raw != root or root.is_symlink():
        raise InputError("Choose the original absolute feed workspace without path aliases")
    info = root.stat()
    if not stat.S_ISDIR(info.st_mode) or os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise InputError("Choose the original private, operator-owned feed workspace")
    marker = root/"workspace.json"
    marker_info = regular(marker, private=True, limit=4096)
    data = marker.read_bytes()
    if load_json(data) != {"schema":"stellar-forge.xml-workspace.v1"}:
        raise InputError("Choose a workspace initialized by the original feed command")
    database = regular(root/"workspace.sqlite", private=True)
    for name in ("sources","plans","builds","comparisons","tmp","feed-http","feed-editions","feed-exports"):
        item = root/name
        if item.is_symlink() or not item.is_dir():
            raise InputError("Original feed storage directory is missing: " + name)
    if sys.version_info < (3,11):
        raise InputError("The original feed workspace requires Python 3.11 or newer")
    value = {
        "schema":SCHEMA,"workspace":str(root),"sourceRoot":str(SOURCE),
        "workspaceIdentity":{"device":str(info.st_dev),"inode":str(info.st_ino),
            "markerDevice":str(marker_info.st_dev),"markerInode":str(marker_info.st_ino),
            "markerSha256":digest(data),"databaseDevice":str(database.st_dev),"databaseInode":str(database.st_ino)},
        "python":{"executable":str(Path(sys.executable).absolute()),"prefix":sys.prefix,
                  "basePrefix":sys.base_prefix,"implementation":sys.implementation.name,
                  "version":list(sys.version_info[:3])},
        "source":{name:source_digest(SOURCE/name) for name in SOURCE_FILES},
    }
    # The managed installer copies these exact source bytes into its release.
    # Keep the observed execution location while binding the original byte closure.
    bound = {k:v for k,v in value.items() if k != "sourceRoot"}
    return value | {"sha256":digest(json_bytes(bound))}

def require_binding(directory, expected):
    value = inspect_binding(directory)
    if expected is not None and (not isinstance(expected,str) or len(expected)!=64 or
                                any(c not in "0123456789abcdef" for c in expected) or expected!=value["sha256"]):
        raise InputError("The selected feed workspace, Python or original source changed; review this application again")
    return value

def startup(server, binding, landing):
    if landing not in ("feeds","subscriptions"):
        raise InputError("Choose the feed or subscription console")
    feeds = server.url
    subscriptions = server.origin + "/subscriptions#" + server.token
    return {"schema":STARTUP,"status":"FEED_WORKSPACE_READY","workspace":binding["workspace"],
            "bindingSha256":binding["sha256"],"sourceRoot":binding["sourceRoot"],"python":binding["python"],
            "landing":landing,"console":subscriptions if landing=="subscriptions" else feeds,
            "feeds":feeds,"subscriptions":subscriptions,"pid":os.getpid()}
