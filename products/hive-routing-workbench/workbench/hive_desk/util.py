"""Small file and JSON utilities shared by the operator and receiving workflow."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re

def require(value, message):
    if not value:
        raise ValueError(message)

def json_text(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)

def identity(path):
    digest, count = hashlib.sha256(), 0
    with Path(path).open("rb") as source:
        while block := source.read(1024 * 1024):
            digest.update(block)
            count += len(block)
    return {"bytes": count, "sha256": digest.hexdigest()}

def relative_name(name):
    require(isinstance(name, str) and name, "Select a relative file name.")
    path = PurePosixPath(name)
    require(not path.is_absolute() and ".." not in path.parts and "\\" not in name
            and path.as_posix() == name and name not in {".", ""}, "Use an ordinary relative file path.")
    return name

def owned_path(directory, name):
    relative_name(name)
    root = Path(directory).resolve()
    candidate = root.joinpath(*PurePosixPath(name).parts)
    require(candidate.resolve().is_relative_to(root), "File leaves the selected directory.")
    cursor = candidate
    while cursor != root:
        require(not cursor.is_symlink(), "Selected files and their parents must be ordinary files/directories.")
        cursor = cursor.parent
    return candidate

def environment_name(value):
    require(isinstance(value, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value),
            "Use an existing environment-variable name.")
    return value

def parse_configuration(raw, name):
    if name.endswith(".json"):
        value = json.loads(raw)
    else:
        import yaml
        value = yaml.safe_load(raw)
    require(isinstance(value, dict), "Router configuration must be an object.")
    return value

def process_identity(pid):
    """Linux start ticks and executable distinguish a retained child from a reused PID."""
    try:
        root = Path("/proc") / str(int(pid))
        stat = (root / "stat").read_text()
        tail = stat[stat.rfind(")") + 2:].split()
        if tail[0] == "Z":
            return None
        return {"pid": int(pid), "startTicks": tail[19],
                "executable": os.readlink(root / "exe")}
    except (OSError, ValueError, IndexError):
        return None

def same_process(saved):
    return bool(saved) and process_identity(saved.get("pid")) == saved
