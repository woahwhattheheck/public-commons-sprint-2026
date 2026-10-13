"""Durable project primitives; no provider credentials or global runtime state."""
from __future__ import annotations
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile

SCHEMA = "upstate.scientific-workbench/v1"
INVEST_VERSION = "3.20.0"
INVEST_SOURCE = {
    "repository": "https://github.com/natcap/invest",
    "ref": "3.20.0",
    "ndr_blob": "f518b2867d4a327675fcb1c9b4ba56f29b12188d",
    "sdr_blob": "0cac27add172011df367ff8026427dbbdbcda5b2",
}
ROLES = ("DEM", "NLCD", "PRECIPITATION", "R_FACTOR", "K_FACTOR")
MODELS = ("ndr", "sdr")
MODEL_ROLES = {
    "ndr": ("DEM", "NLCD", "PRECIPITATION"),
    "sdr": ("DEM", "NLCD", "R_FACTOR", "K_FACTOR"),
}
MODEL_OUTPUTS = {
    "nitrogen_export": ("ndr", "n_total_export"),
    "phosphorus_export": ("ndr", "p_surface_export"),
    "sediment_export": ("sdr", "sed_export"),
}
SOURCE_IDS = ROLES + ("PROTECTED_LANDS", "PARCEL", "NHD", "NWI", "LS_FACTOR")
MAP_IDS = ("future_sediment_loss", "future_nutrient_runoff",
           "critical_drinking_water", "high_quality_waters",
           "current_nutrient_export", "current_sediment_export",
           "combined_pollutant_export")

def selected_models(value=None):
    """Return selected native models in their stable execution order.

    An omitted selection preserves the original combined NDR/SDR behavior.
    The explicit selection is carried by a profile, grid or run's models field.
    """
    values = value.get("models", MODELS) if isinstance(value, dict) else value
    if values is None and value is None:
        values = MODELS
    if not isinstance(values, (list, tuple)) or not values:
        raise ValueError("Select a nonempty list of native models: ndr, sdr")
    if any(not isinstance(name, str) for name in values):
        raise ValueError("Native model names must be ndr or sdr")
    names = [name.strip().lower() for name in values]
    if len(names) != len(set(names)) or set(names) - set(MODELS):
        raise ValueError("Select each native model once from ndr, sdr")
    return [name for name in MODELS if name in names]

def required_roles(value=None):
    """Physical inputs required by the selected native models."""
    models = selected_models(value)
    return tuple(role for role in ROLES
                 if any(role in MODEL_ROLES[model] for model in models))

def output_models(value=None):
    """Map actual selected export names to native model/registry identifiers."""
    models = selected_models(value)
    return {name: pair for name, pair in MODEL_OUTPUTS.items() if pair[0] in models}

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")

def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()

def file_digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()

def atomic_bytes(path, data, *, immutable=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if immutable and path.exists():
        if path.read_bytes() != data:
            raise ValueError("Immutable project item differs: " + str(path))
        return
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".write-", delete=False) as f:
            pending = Path(f.name)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        if immutable:
            try:
                os.link(pending, path)
            except FileExistsError:
                if path.read_bytes() != data:
                    raise ValueError("Concurrent immutable item differs: " + str(path))
            pending.unlink()
            pending = None
        else:
            os.replace(pending, path)
            pending = None
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)

def atomic_json(path, value, *, immutable=False):
    atomic_bytes(path, canonical(value) + b"\n", immutable=immutable)

def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("Select an existing complete project item ID")
    return value

def relative_file(root, value):
    root = Path(root).resolve()
    selected = Path(value)
    if selected.is_absolute() or not selected.parts or ".." in selected.parts:
        raise ValueError("Use a relative file within the selected project")
    p = (root / selected).resolve(strict=True)
    if not p.is_relative_to(root) or not p.is_file():
        raise ValueError("Project member is not a retained regular file")
    return p

def finite(value, name, *, minimum=None, positive=False):
    if isinstance(value, bool):
        raise ValueError(name + " must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(name + " must be finite")
    if minimum is not None and result < minimum or positive and result <= 0:
        raise ValueError(name + " is outside its permitted range")
    return result

@contextlib.contextmanager
def held(path, *, blocking=True):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        yield
    finally:
        os.close(fd)

def _file_state(value):
    return (value.st_dev, value.st_ino, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns)

def _sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def _stream_identity(stream, label, *, expected_state=None, output=None):
    before = os.fstat(stream.fileno())
    if not stat.S_ISREG(before.st_mode):
        raise ValueError(label + " is not a regular file")
    state = _file_state(before)
    if expected_state is not None and state != expected_state:
        raise ValueError(label + " changed during intake")
    checksum, size = hashlib.sha256(), 0
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        checksum.update(block)
        if output is not None:
            output.write(block)
        size += len(block)
    if _file_state(os.fstat(stream.fileno())) != state or size != before.st_size:
        raise ValueError(label + " changed during intake")
    return checksum.hexdigest(), size, state

def _retained_object_matches(path, checksum, size):
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return False
    with os.fdopen(descriptor, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Retained original object is not a regular file")
        try:
            actual, count, state = _stream_identity(stream, "Retained original object")
        except ValueError:
            # A concurrent completed publication or view hard link can change
            # ctime. The caller rechecks under the digest lock before any copy.
            return False
        try:
            current = path.lstat()
        except FileNotFoundError:
            return False
        if _file_state(current) != state or not stat.S_ISREG(current.st_mode):
            return False
        if actual != checksum or count != size:
            return False
        # Complete publication durability even after an interrupted prior intake.
        os.fsync(stream.fileno())
        return True

def retain_file(project, source, expected_sha256=None):
    """Verify each input and retain one independent copy of its exact bytes.

    A repeated import reads and verifies the existing object without staging a
    second copy. The per-digest lock serializes copies of the same new source;
    it is retained as a zero-byte .lock file and excluded by portable exports.
    """
    source = Path(source).resolve(strict=True)
    if not source.is_file():
        raise ValueError("Source is not a regular file")
    directory = Path(project) / "objects"
    directory.mkdir(parents=True, exist_ok=True)
    pending = None
    with source.open("rb") as src:
        checksum, size, source_state = _stream_identity(src, "Original input")
        if expected_sha256 and checksum != expected_sha256:
            raise ValueError("Original source hash differs: " + source.name)
        destination = directory / checksum
        # Existing complete objects need no new temporary or lock-file entry.
        # This also permits legacy retained objects to reopen on a full volume.
        if _retained_object_matches(destination, checksum, size):
            if _file_state(os.fstat(src.fileno())) != source_state:
                raise ValueError("Original input changed during intake")
            _sync_directory(directory)
            _sync_directory(directory.parent)
            return {"sha256": checksum, "bytes": size,
                    "object": "objects/" + checksum, "filename": source.name}
        with held(directory / (".intake-" + checksum + ".lock")):
            if _file_state(os.fstat(src.fileno())) != source_state:
                raise ValueError("Original input changed during intake")
            if _retained_object_matches(destination, checksum, size):
                if _file_state(os.fstat(src.fileno())) != source_state:
                    raise ValueError("Original input changed during intake")
                _sync_directory(directory)
                _sync_directory(directory.parent)
                return {"sha256": checksum, "bytes": size,
                        "object": "objects/" + checksum, "filename": source.name}
            try:
                src.seek(0)
                with tempfile.NamedTemporaryFile(
                        dir=directory, prefix=".intake-", delete=False) as out:
                    pending = Path(out.name)
                    copied, copied_size, _ = _stream_identity(
                        src, "Original input", expected_state=source_state, output=out)
                    if copied != checksum or copied_size != size:
                        raise ValueError("Original input changed during intake")
                    out.flush()
                    os.fsync(out.fileno())
                if _file_state(os.fstat(src.fileno())) != source_state:
                    raise ValueError("Original input changed during intake")
                try:
                    os.link(pending, destination)
                except FileExistsError:
                    # An older admitted writer may not use the per-digest lock.
                    # Reuse its complete publication, or atomically repair a
                    # regular damaged object with the verified independent copy.
                    if not _retained_object_matches(destination, checksum, size):
                        os.replace(pending, destination)
                        pending = None
                _sync_directory(directory)
                _sync_directory(directory.parent)
            finally:
                if pending is not None:
                    pending.unlink(missing_ok=True)
                    _sync_directory(directory)
    return {"sha256": checksum, "bytes": size, "object": "objects/" + checksum,
            "filename": source.name}

def verify_file(root, item):
    path = relative_file(root, item["path"])
    if path.stat().st_size != item["bytes"] or file_digest(path) != item["sha256"]:
        raise ValueError("Retained output changed: " + item["path"])
    return path

def describe_file(root, path, **metadata):
    path = Path(path).resolve(strict=True)
    root = Path(root).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Output is outside the current run")
    return {**metadata, "path": path.relative_to(root).as_posix(),
            "bytes": path.stat().st_size, "sha256": file_digest(path)}
