"""Materialize a complete installed Node tree with immutable file reuse.

The original dependency borrower owns lockfile selection. This module preserves
the complete selected directory layout while reusing equal regular file bodies,
so package realpaths never select another installation's hoisted dependencies.
"""
from __future__ import annotations

import ctypes
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

SCHEMA = "commons.node_dependency_materialization/v1"
RECEIPT = ".commons-installed-materialization.json"


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True,
        separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


def identity(info):
    return {"device": info.st_dev, "inode": info.st_ino,
            "mode": stat.S_IMODE(info.st_mode), "bytes": info.st_size}


def stable(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def read_file(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Installed dependency is not a regular file: " + str(path))
        value = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
        after = os.fstat(stream.fileno())
        if stable(before) != stable(after):
            raise ValueError("Installed file changed while reading: " + str(path))
    if stable(path.lstat()) != stable(after):
        raise ValueError("Installed file path changed while reading: " + str(path))
    return value.hexdigest(), identity(after)


def tree(root):
    root = Path(root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Select an installed dependency directory: " + str(root))
    entries = []

    def visit(directory):
        before = directory.stat()
        for path in sorted(directory.iterdir(), key=lambda p: p.name):
            relative = path.relative_to(root).as_posix()
            if relative == RECEIPT:
                continue
            info = path.lstat()
            row = {"path": relative, "mode": stat.S_IMODE(info.st_mode)}
            if stat.S_ISREG(info.st_mode):
                sha, observed = read_file(path)
                row.update(kind="file", bytes=observed["bytes"], sha256=sha,
                           observed=observed)
            elif stat.S_ISLNK(info.st_mode):
                row.update(kind="symlink", target=os.readlink(path))
                if not os.path.isabs(row["target"]) and not path.resolve().is_relative_to(root):
                    raise ValueError("Relative installed link leaves the selected tree: " + str(path))
                if stable(path.lstat()) != stable(info):
                    raise ValueError("Installed dependency link changed: " + str(path))
            elif stat.S_ISDIR(info.st_mode):
                row.update(kind="directory")
                entries.append(row)
                visit(path)
                continue
            else:
                raise ValueError("Unsupported installed dependency entry: " + str(path))
            entries.append(row)
        after = directory.stat()
        if (before.st_dev, before.st_ino, before.st_mode, before.st_mtime_ns) != (
                after.st_dev, after.st_ino, after.st_mode, after.st_mtime_ns):
            raise ValueError("Installed dependency directory changed: " + str(directory))

    visit(root)
    entries.sort(key=lambda row: row["path"])
    mode = stat.S_IMODE(root.stat().st_mode)
    content = [{key: value for key, value in row.items() if key != "observed"}
               for row in entries]
    return {"path": str(root), "root": identity(root.stat()),
            "tree_sha256": digest({"mode": mode, "entries": content}),
            "mode": mode, "entries": entries}


def body_key(row):
    return (row["sha256"], row["bytes"], row["mode"])


def destination_state(project):
    destination = project / "node_modules"
    if not os.path.lexists(destination):
        return "create_materialized"
    if destination.is_symlink() or not destination.is_dir():
        raise ValueError("Retain the existing project node_modules entry.")
    receipt = destination / RECEIPT
    if not receipt.is_file() or receipt.is_symlink():
        raise ValueError("Existing node_modules has no original installed materialization.")
    value = json.loads(receipt.read_text())
    if value.get("schema") != SCHEMA or value.get("outcome") != "materialized":
        raise ValueError("Existing installed materialization is incomplete.")
    return "reuse_materialized"


def build(source_root, destination, *, reuse_roots=(), reference):
    if not isinstance(reference, str) or not reference.strip():
        raise ValueError("Supply the existing immutable SDK ownership reference.")
    destination = Path(destination)
    if destination.name != "node_modules":
        raise ValueError("Select the original project node_modules destination.")
    parent = destination.parent.resolve(strict=True)
    destination = parent / destination.name
    original = tree(source_root)
    root = Path(original["path"])
    donors = []
    seen = {str(root)}
    for selected in reuse_roots:
        path = Path(selected).expanduser().resolve(strict=True)
        if str(path) not in seen:
            donors.append(tree(path))
            seen.add(str(path))
    for value in [original, *donors]:
        path = Path(value["path"])
        if destination == path or path in destination.parents or destination in path.parents:
            raise ValueError("Materialize outside every original installed dependency root.")
    device = parent.stat().st_dev
    index = {}
    for value in [*donors, original]:
        for row in value["entries"]:
            if row["kind"] == "file" and row["observed"]["device"] == device:
                index.setdefault(body_key(row), {
                    "source": str(Path(value["path"]) / row["path"]),
                    "observed": row["observed"]})
    choices, copied = [], {}
    counts = {"files": 0, "directories": 0, "symlinks": 0, "logical_bytes": 0,
              "hardlink_files": 0, "copy_files": 0, "copy_bytes": 0,
              "copy_allocated_bytes_estimate": 0, "duplicate_links": 0}
    block = os.statvfs(parent).f_frsize
    for row in original["entries"]:
        if row["kind"] != "file":
            counts["directories" if row["kind"] == "directory" else "symlinks"] += 1
            continue
        counts["files"] += 1
        counts["logical_bytes"] += row["bytes"]
        key = body_key(row)
        if key in index:
            chosen = {"method": "hardlink", **index[key]}
            counts["hardlink_files"] += 1
        elif key in copied:
            chosen = {"method": "duplicate", "source": copied[key]}
            counts["duplicate_links"] += 1
        else:
            copied[key] = row["path"]
            chosen = {"method": "copy", "source": str(root / row["path"]),
                      "observed": row["observed"]}
            counts["copy_files"] += 1
            counts["copy_bytes"] += row["bytes"]
            counts["copy_allocated_bytes_estimate"] += ((row["bytes"] + block - 1) // block) * block
        choices.append({"path": row["path"], **chosen})
    sources = [{key: value[key] for key in ("path", "root", "tree_sha256")}
               for value in [original, *donors]]
    # Directory sizes/mtime/link counts do not bind immutable body identity.
    for value in sources:
        value["root"] = {k: v for k, v in value["root"].items() if k != "bytes"}
    binding = {"schema": SCHEMA, "destination": str(destination),
        "destination_device": device, "source_tree_sha256": original["tree_sha256"],
        "sources": sources, "choices_sha256": digest(choices),
        "immutable_reference": reference.strip()}
    public = {**binding, "selection_sha256": digest(binding), "counts": counts}
    action = destination_state(parent)
    if action == "reuse_materialized":
        previous = json.loads((destination / RECEIPT).read_text())
        if previous.get("selection_sha256") != public["selection_sha256"]:
            raise ValueError("Existing dependency view belongs to another exact materialization.")
        if tree(destination)["tree_sha256"] != original["tree_sha256"]:
            raise ValueError("Existing dependency view changed from its original source.")
    public["action"] = action
    return public, {"original": original, "choices": choices}


def _copy(source, destination, row, expected):
    descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as incoming:
        before = os.fstat(incoming.fileno())
        if not stat.S_ISREG(before.st_mode) or identity(before) != expected:
            raise ValueError("Selected installed file changed before copying: " + str(source))
        h = hashlib.sha256()
        with destination.open("xb") as output:
            os.chmod(destination, 0o600)
            for data in iter(lambda: incoming.read(1024 * 1024), b""):
                output.write(data)
                h.update(data)
            output.flush()
            os.fchmod(output.fileno(), row["mode"])
        if stable(before) != stable(os.fstat(incoming.fileno())) or h.hexdigest() != row["sha256"]:
            raise ValueError("Selected installed file changed during copying: " + str(source))
    if identity(destination.stat())["bytes"] != row["bytes"]:
        raise ValueError("Copied installed file has a different size: " + str(destination))


def _publish(stage, destination):
    libc = ctypes.CDLL(None, use_errno=True)
    rename = getattr(libc, "renameat2", None)
    if rename is None:
        raise ValueError("Atomic installed directory publication needs Linux renameat2.")
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                       ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(stage), -100, os.fsencode(destination), 1):
        number = ctypes.get_errno()
        raise OSError(number, os.strerror(number), str(destination))


def _materialize_unrecorded(public, private):
    destination = Path(public["destination"])
    if destination_state(destination.parent) == "reuse_materialized":
        receipt = json.loads((destination / RECEIPT).read_text())
        if receipt.get("selection_sha256") != public["selection_sha256"] or (
                tree(destination)["tree_sha256"] != public["source_tree_sha256"]):
            raise ValueError("Existing installed view differs from this selected operation.")
        return {**receipt, "action": "reused", "file_bytes_written": 0}
    stage = Path(tempfile.mkdtemp(prefix=".node_modules-installed-", dir=destination.parent))
    entries = private["original"]["entries"]
    rows = {row["path"]: row for row in entries}
    counts = {"hardlinks": 0, "copies": 0, "duplicate_links": 0,
              "file_bytes_written": 0, "directories": 0, "symlinks": 0}
    public["stage"] = str(stage)
    for row in entries:
        if row["kind"] == "directory":
            (stage / row["path"]).mkdir(mode=0o700)
            counts["directories"] += 1
    for chosen in private["choices"]:
        row = rows[chosen["path"]]
        path = stage / row["path"]
        source = Path(chosen["source"] if chosen["method"] != "duplicate"
                      else stage / chosen["source"])
        if chosen["method"] == "copy":
            _copy(source, path, row, chosen["observed"])
            counts["copies"] += 1
            counts["file_bytes_written"] += row["bytes"]
        else:
            os.link(source, path, follow_symlinks=False)
            if chosen["method"] == "hardlink":
                info = path.lstat()
                if not stat.S_ISREG(info.st_mode) or identity(info) != chosen["observed"]:
                    raise ValueError("Selected immutable installed file changed: " + str(source))
                counts["hardlinks"] += 1
            else:
                counts["duplicate_links"] += 1
    # Links are created after file writes, so no selected parent link can route
    # a materializer write into another owner's tree.
    for row in entries:
        if row["kind"] == "symlink":
            (stage / row["path"]).symlink_to(row["target"])
            counts["symlinks"] += 1
    for row in reversed(entries):
        if row["kind"] == "directory":
            os.chmod(stage / row["path"], row["mode"])
    os.chmod(stage, private["original"]["mode"])
    if tree(stage)["tree_sha256"] != public["source_tree_sha256"]:
        raise ValueError("Prepared installed dependency layout differs from its original source.")
    result = {**{key: value for key, value in public.items() if key != "stage"},
              "outcome": "materialized", "action": "created", **counts}
    with (stage / RECEIPT).open("x", encoding="utf-8") as stream:
        os.chmod(stage / RECEIPT, 0o600)
        json.dump(result, stream, sort_keys=True, separators=(",", ":"))
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    _publish(stage, destination)
    public.pop("stage", None)
    directory = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    return result


STAGE_SCHEMA = "commons.node_dependency_materialization_stage/v1"


def _stage_json(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > 65536:
            raise ValueError("Invalid materialization control file: " + str(path))
        raw = stream.read(65537)
        if stable(before) != stable(os.fstat(stream.fileno())):
            raise ValueError("Materialization control changed while reading.")
    if stable(path.lstat()) != stable(before):
        raise ValueError("Materialization control path changed.")
    return json.loads(raw), raw


def _stage_write_new(path, value, control):
    """Publish a complete small control record without replacing an existing one."""
    raw = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if os.path.lexists(path):
        found, _ = _stage_json(path)
        if found != value:
            raise ValueError("Existing materialization control belongs to another state.")
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".state-", dir=control)
    temporary = Path(temporary)
    own = os.fstat(descriptor)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if (temporary.lstat().st_dev, temporary.lstat().st_ino) != (own.st_dev, own.st_ino):
            raise ValueError("Materialization temporary control changed.")
        try:
            _publish(temporary, path)
        except FileExistsError:
            found, _ = _stage_json(path)
            if found != value:
                raise ValueError("Existing materialization control belongs to another state.")
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        try:
            now = temporary.lstat()
            if (now.st_dev, now.st_ino) == (own.st_dev, own.st_ino):
                temporary.unlink()
        except FileNotFoundError:
            pass


def _stage_chain(path):
    chain = []
    for selected in [*reversed(path.parents), path]:
        info = selected.lstat()
        if not stat.S_ISDIR(info.st_mode):
            raise ValueError("Recorded stage requires ordinary directory parents: " + str(selected))
        chain.append((selected, info.st_dev, info.st_ino, info.st_mode))
    return chain


def _stage_check(chain, stage, recorded, descriptor=None):
    for path, device, inode, mode in chain:
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or (info.st_dev, info.st_ino) != (device, inode):
            raise ValueError("Recorded materialization directory changed: " + str(path))
        if path != stage and info.st_mode != mode:
            raise ValueError("Recorded materialization parent mode changed: " + str(path))
    info = os.fstat(descriptor) if descriptor is not None else stage.lstat()
    if not stat.S_ISDIR(info.st_mode) or (
            info.st_dev, info.st_ino) != (recorded["device"], recorded["inode"]):
        raise ValueError("Recorded materialization stage identity changed.")


def _stage_plan(public, private, stage_path, recorded):
    if not isinstance(recorded, dict) or set(recorded) != {
            "device", "inode", "selection_sha256"}:
        raise ValueError("Record stage device, inode and selection_sha256 before materialization.")
    if any(not isinstance(recorded[k], int) or isinstance(recorded[k], bool) or recorded[k] < 0
           for k in ("device", "inode")):
        raise ValueError("Recorded materialization inode identity is invalid.")
    if recorded["selection_sha256"] != public.get("selection_sha256"):
        raise ValueError("Recorded stage belongs to another source selection.")
    keys = ("schema", "destination", "destination_device", "source_tree_sha256",
            "sources", "choices_sha256", "immutable_reference")
    if public.get("schema") != SCHEMA or digest({key: public[key] for key in keys}) != public["selection_sha256"]:
        raise ValueError("Materialization selection changed.")
    if digest(private["choices"]) != public["choices_sha256"]:
        raise ValueError("Materialization choices changed.")
    original = private["original"]
    content = [{key: value for key, value in row.items() if key != "observed"}
               for row in original["entries"]]
    if digest({"mode": original["mode"], "entries": content}) != public["source_tree_sha256"]:
        raise ValueError("Materialization original source entries changed.")
    stage = Path(stage_path)
    if not stage.is_absolute() or stage != Path(os.path.abspath(stage)):
        raise ValueError("Use the exact absolute recorded staging path.")
    destination = Path(public["destination"])
    if destination.name != "node_modules" or not destination.is_absolute():
        raise ValueError("Select the original node_modules destination.")
    _stage_chain(stage.parent)
    _stage_chain(destination.parent)
    if destination.parent.stat().st_dev != public["destination_device"]:
        raise ValueError("Materialization destination device changed.")
    control = stage.with_name(stage.name + ".commons-materialization")
    for selected in (stage, control):
        if selected == destination or selected in destination.parents or destination in selected.parents:
            raise ValueError("Keep the recorded stage and controls outside the final dependency tree.")
        for source in public["sources"]:
            root = Path(source["path"])
            if selected == root or selected in root.parents or root in selected.parents:
                raise ValueError("Keep the recorded stage and controls outside every original source.")
    rows = {}
    for row in original["entries"]:
        relative = Path(row["path"])
        if relative.is_absolute() or not relative.parts or any(p in ("", ".", "..") for p in relative.parts):
            raise ValueError("Invalid selected dependency path.")
        if relative.as_posix() != row["path"] or row["path"] == RECEIPT or row["path"] in rows:
            raise ValueError("Invalid or duplicate selected dependency path.")
        rows[row["path"]] = row
    choices = {row["path"]: row for row in private["choices"]}
    if len(choices) != len(private["choices"]) or set(choices) != {
            path for path, row in rows.items() if row["kind"] == "file"}:
        raise ValueError("Materialization file choices differ from the source entries.")
    return stage, control, destination, rows, choices


def _stage_existing(stage, rows, choices, original_mode):
    """Validate every existing logical entry without following package symlinks."""
    info = stage.lstat()
    if stat.S_IMODE(info.st_mode) not in (0o700, original_mode):
        raise ValueError("Recorded staging root mode changed.")
    present = set()
    directories = {"": (info.st_dev, info.st_ino)}

    def visit(directory):
        before = directory.lstat()
        for path in sorted(directory.iterdir(), key=lambda p: p.name):
            relative = path.relative_to(stage).as_posix()
            if relative == RECEIPT:
                continue
            row = rows.get(relative)
            if row is None:
                raise ValueError("Unexpected recorded stage entry: " + relative)
            now = path.lstat()
            if row["kind"] == "directory":
                if not stat.S_ISDIR(now.st_mode) or stat.S_IMODE(now.st_mode) not in (0o700, row["mode"]):
                    raise ValueError("Recorded dependency directory differs: " + relative)
                directories[relative] = (now.st_dev, now.st_ino)
                visit(path)
            elif row["kind"] == "symlink":
                if (not stat.S_ISLNK(now.st_mode) or stat.S_IMODE(now.st_mode) != row["mode"]
                        or os.readlink(path) != row["target"]):
                    raise ValueError("Recorded dependency symlink differs: " + relative)
                if stable(now) != stable(path.lstat()):
                    raise ValueError("Recorded dependency symlink changed: " + relative)
            elif row["kind"] == "file":
                sha, observed = read_file(path)
                if body_key({**observed, "sha256": sha}) != body_key(row):
                    raise ValueError("Recorded dependency file differs: " + relative)
                chosen = choices[relative]
                if chosen["method"] == "hardlink" and observed != chosen["observed"]:
                    raise ValueError("Recorded immutable donor link differs: " + relative)
                if chosen["method"] == "duplicate":
                    first = (stage / chosen["source"]).lstat()
                    if not stat.S_ISREG(first.st_mode) or (
                            first.st_dev, first.st_ino) != (observed["device"], observed["inode"]):
                        raise ValueError("Recorded duplicate link differs: " + relative)
            else:
                raise ValueError("Unsupported selected dependency kind.")
            present.add(relative)
        after = directory.lstat()
        if stable(before) != stable(after):
            raise ValueError("Recorded dependency directory changed while inspecting.")
    visit(stage)
    return present, directories


def _stage_parent(stage, path, directories):
    relative = path.parent.relative_to(stage)
    for parent in [Path("."), *[Path(*relative.parts[:i]) for i in range(1, len(relative.parts) + 1)]]:
        key = "" if parent == Path(".") else parent.as_posix()
        info = (stage / parent).lstat()
        if not stat.S_ISDIR(info.st_mode) or (
                info.st_dev, info.st_ino) != directories.get(key):
            raise ValueError("Recorded dependency parent changed: " + str(path))


def _stage_copy(source, destination, row, expected, pending):
    """Resume only an exact received prefix; canonical package names stay complete."""
    original = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    written = 0
    with os.fdopen(original, "rb") as incoming:
        before = os.fstat(incoming.fileno())
        if not stat.S_ISREG(before.st_mode) or identity(before) != expected:
            raise ValueError("Selected installed source changed before staged copy: " + str(source))
        existed = os.path.lexists(pending)
        if existed:
            initial = pending.lstat()
            if not stat.S_ISREG(initial.st_mode) or initial.st_size > row["bytes"]:
                raise ValueError("Recorded partial dependency file differs: " + str(pending))
            # A crash after chmod/fsync can leave an already complete readonly file.
            if initial.st_size == row["bytes"]:
                sha, observed = read_file(pending)
                if sha == row["sha256"] and observed["mode"] == row["mode"]:
                    if identity(source.lstat()) != expected:
                        raise ValueError("Selected source path changed before copy publication.")
                    _publish(pending, destination)
                    return 0, True
            if stat.S_IMODE(initial.st_mode) != 0o600:
                raise ValueError("Recorded partial dependency file mode differs: " + str(pending))
            descriptor = os.open(pending, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        else:
            descriptor = os.open(pending, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "r+b") as output:
            saved = os.fstat(output.fileno())
            if not stat.S_ISREG(saved.st_mode) or (existed and stable(saved) != stable(initial)):
                raise ValueError("Recorded partial dependency file changed while opening.")
            h = hashlib.sha256()
            remaining = saved.st_size
            while remaining:
                part = output.read(min(1024 * 1024, remaining))
                if not part or incoming.read(len(part)) != part:
                    raise ValueError("Recorded dependency prefix differs from its original source.")
                h.update(part)
                remaining -= len(part)
            if stable(saved) != stable(os.fstat(output.fileno())):
                raise ValueError("Recorded dependency prefix changed while reading.")
            for data in iter(lambda: incoming.read(1024 * 1024), b""):
                output.write(data)
                h.update(data)
                written += len(data)
            output.flush()
            if (stable(before) != stable(os.fstat(incoming.fileno()))
                    or h.hexdigest() != row["sha256"]
                    or os.fstat(output.fileno()).st_size != row["bytes"]):
                raise ValueError("Selected source changed during staged dependency copy.")
            os.fchmod(output.fileno(), row["mode"])
            os.fsync(output.fileno())
            complete = os.fstat(output.fileno())
            if stable(pending.lstat()) != stable(complete):
                raise ValueError("Recorded complete dependency path changed.")
        if identity(source.lstat()) != expected:
            raise ValueError("Selected source path changed before copy publication.")
        _publish(pending, destination)
    return written, existed


def _stage_reused(destination, public, recorded):
    if destination_state(destination.parent) != "reuse_materialized":
        return None
    receipt, _ = _stage_json(destination / RECEIPT)
    info = destination.lstat()
    if (receipt.get("selection_sha256") != public["selection_sha256"]
            or receipt.get("stage_identity") != recorded
            or (info.st_dev, info.st_ino) != (recorded["device"], recorded["inode"])
            or tree(destination)["tree_sha256"] != public["source_tree_sha256"]):
        raise ValueError("Published dependency view differs from the recorded stage.")
    return {**receipt, "action": "reused", "file_bytes_written": 0}


def materialize(public, private, *, stage_path=None, stage_identity=None):
    """Receive the selected complete layout, optionally resuming a recorded stage.

    A caller selecting stage_path creates an empty private directory, persists its
    device/inode plus this exact selection_sha256 in the original operation, and
    supplies both arguments on every continuation. The sibling control directory
    retains the binding and verified partial copies; it is not a package member.
    Default callers keep the original fresh-stage behavior.
    """
    if stage_path is None and stage_identity is None:
        return _materialize_unrecorded(public, private)
    if stage_path is None or stage_identity is None:
        raise ValueError("Supply both the recorded staging path and its identity.")
    stage, control, destination, rows, choices = _stage_plan(
        public, private, stage_path, stage_identity)
    reused = _stage_reused(destination, public, stage_identity)
    if reused is not None:
        return reused
    chain = _stage_chain(stage)
    _stage_check(chain, stage, stage_identity)
    if stage_identity["device"] != public["destination_device"]:
        raise ValueError("Recorded stage must share the final destination filesystem.")
    descriptor = os.open(stage, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        import fcntl
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise BlockingIOError(error.errno, "The recorded dependency stage is already being received.", str(stage)) from error
        if not os.path.lexists(stage):
            reused = _stage_reused(destination, public, stage_identity)
            if reused is not None:
                return reused
        _stage_check(chain, stage, stage_identity, descriptor)
        binding = {"schema": STAGE_SCHEMA, "stage_path": str(stage),
                   "stage_identity": stage_identity, "destination": str(destination),
                   "source_tree_sha256": public["source_tree_sha256"]}
        marker = control / "state.json"
        if not os.path.lexists(marker) and any(stage.iterdir()):
            raise ValueError("A populated stage has no original materialization binding.")
        try:
            control.mkdir(mode=0o700)
        except FileExistsError:
            pass
        control_info = control.lstat()
        if (not stat.S_ISDIR(control_info.st_mode)
                or stat.S_IMODE(control_info.st_mode) != 0o700
                or control_info.st_dev != stage_identity["device"]):
            raise ValueError("Recorded materialization control directory differs.")
        control_chain = _stage_chain(control)
        _stage_write_new(marker, binding, control)
        public["stage"] = str(stage)
        present, directories = _stage_existing(stage, rows, choices, private["original"]["mode"])
        counts = {"hardlinks": sum(c["method"] == "hardlink" for c in choices.values()),
                  "copies": sum(c["method"] == "copy" for c in choices.values()),
                  "duplicate_links": sum(c["method"] == "duplicate" for c in choices.values()),
                  "file_bytes_written": 0,
                  "directories": sum(r["kind"] == "directory" for r in rows.values()),
                  "symlinks": sum(r["kind"] == "symlink" for r in rows.values()),
                  "reused_files": sum(rows[p]["kind"] == "file" for p in present),
                  "resumed_copy_files": 0}
        if os.path.lexists(stage / RECEIPT):
            result, _ = _stage_json(stage / RECEIPT)
            if (result.get("schema") != SCHEMA or result.get("outcome") != "materialized"
                    or result.get("selection_sha256") != public["selection_sha256"]
                    or result.get("stage_identity") != stage_identity):
                raise ValueError("Recorded completed stage differs from this selected operation.")
            os.fchmod(descriptor, private["original"]["mode"])
            if tree(stage)["tree_sha256"] != public["source_tree_sha256"]:
                raise ValueError("Recorded completed stage differs from its original source.")
        else:
            # Only this operation owns directory inodes in its private stage.
            # Reopen their write permission after a stop during final chmod.
            os.fchmod(descriptor, 0o700)
            for row in private["original"]["entries"]:
                if row["kind"] == "directory":
                    _stage_check(chain, stage, stage_identity, descriptor)
                    path = stage / row["path"]
                    _stage_parent(stage, path, directories)
                    if row["path"] not in present:
                        path.mkdir(mode=0o700)
                        info = path.lstat()
                        if not stat.S_ISDIR(info.st_mode):
                            raise ValueError("Created dependency directory changed.")
                        directories[row["path"]] = (info.st_dev, info.st_ino)
                    directory = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                    try:
                        info = os.fstat(directory)
                        if (info.st_dev, info.st_ino) != directories[row["path"]]:
                            raise ValueError("Recorded dependency directory changed.")
                        os.fchmod(directory, 0o700)
                    finally:
                        os.close(directory)
            for chosen in private["choices"]:
                if chosen["path"] in present:
                    continue
                _stage_check(chain, stage, stage_identity, descriptor)
                _stage_check(control_chain, control, {
                    "device": control_info.st_dev, "inode": control_info.st_ino})
                row = rows[chosen["path"]]
                path = stage / row["path"]
                _stage_parent(stage, path, directories)
                source = Path(chosen["source"] if chosen["method"] != "duplicate"
                              else stage / chosen["source"])
                if chosen["method"] == "copy":
                    pending = control / ("copy-" + hashlib.sha256(row["path"].encode()).hexdigest() + ".partial")
                    written, resumed = _stage_copy(source, path, row, chosen["observed"], pending)
                    counts["file_bytes_written"] += written
                    counts["resumed_copy_files"] += int(resumed)
                elif chosen["method"] in ("hardlink", "duplicate"):
                    os.link(source, path, follow_symlinks=False)
                    sha, observed = read_file(path)
                    if body_key({**observed, "sha256": sha}) != body_key(row):
                        raise ValueError("Selected immutable dependency link changed.")
                    if chosen["method"] == "hardlink" and observed != chosen["observed"]:
                        raise ValueError("Selected immutable donor identity changed.")
                    if chosen["method"] == "duplicate":
                        first = source.lstat()
                        if not stat.S_ISREG(first.st_mode) or (
                                first.st_dev, first.st_ino) != (observed["device"], observed["inode"]):
                            raise ValueError("Selected duplicate identity changed.")
                else:
                    raise ValueError("Unsupported materialization choice.")
            for row in private["original"]["entries"]:
                if row["kind"] == "symlink" and row["path"] not in present:
                    _stage_check(chain, stage, stage_identity, descriptor)
                    path = stage / row["path"]
                    _stage_parent(stage, path, directories)
                    path.symlink_to(row["target"])
            for row in reversed(private["original"]["entries"]):
                if row["kind"] == "directory":
                    path = stage / row["path"]
                    _stage_parent(stage, path, directories)
                    info = path.lstat()
                    if not stat.S_ISDIR(info.st_mode) or (
                            info.st_dev, info.st_ino) != directories[row["path"]]:
                        raise ValueError("Dependency directory changed before final mode.")
                    os.chmod(path, row["mode"])
            _stage_check(chain, stage, stage_identity, descriptor)
            result = {**{k: v for k, v in public.items() if k != "stage"},
                      "stage_identity": stage_identity,
                      "staging_receipt_sha256": digest(binding),
                      "outcome": "materialized", "action": "resumed" if present else "created",
                      **counts}
            _stage_write_new(stage / RECEIPT, result, control)
            os.fchmod(descriptor, private["original"]["mode"])
            if tree(stage)["tree_sha256"] != public["source_tree_sha256"]:
                raise ValueError("Prepared recorded layout differs from its original source.")
        _stage_check(chain, stage, stage_identity, descriptor)
        os.fsync(descriptor)
        _publish(stage, destination)
        public.pop("stage", None)
        directory = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        return result
    finally:
        os.close(descriptor)


def finalize_complete_stage(public, private, *, stage_path, stage_identity,
                            receipt_identity, original_report_sha256):
    """Publish a complete legacy stage whose final receipt allocation failed.

    This is an explicit completion of the original unrecorded materializer. The
    caller retains the original failed report and the observed stage/empty
    receipt inode before invoking it. Every package body and selected link is
    revalidated. No package file is written and no incomplete layout is adopted.
    A partial write of this same completion receipt resumes on its original inode.
    """
    import fcntl
    import re
    if not isinstance(original_report_sha256, str) or not re.fullmatch(
            r"[a-f0-9]{64}", original_report_sha256):
        raise ValueError("Select the retained original failed materialization report.")
    if (not isinstance(receipt_identity, dict) or set(receipt_identity) != {"device", "inode"}
            or any(type(receipt_identity[k]) is not int or receipt_identity[k] < 0
                   for k in ("device", "inode"))):
        raise ValueError("Select the original empty receipt device and inode.")
    stage, _, destination, rows, choices = _stage_plan(
        public, private, stage_path, stage_identity)
    reused = _stage_reused(destination, public, stage_identity)
    if reused is not None:
        recovery = reused.get("completion_recovery", {})
        if (recovery.get("original_report_sha256") != original_report_sha256
                or recovery.get("receipt_identity") != receipt_identity):
            raise ValueError("Published completion belongs to another retained failure.")
        return reused
    chain = _stage_chain(stage)
    _stage_check(chain, stage, stage_identity)
    if stage_identity["device"] != public["destination_device"]:
        raise ValueError("Complete stage and destination must use the same filesystem.")
    directory = os.open(stage, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(directory, fcntl.LOCK_EX | fcntl.LOCK_NB)
        _stage_check(chain, stage, stage_identity, directory)
        present, _ = _stage_existing(stage, rows, choices, private["original"]["mode"])
        if present != set(rows) or tree(stage)["tree_sha256"] != public["source_tree_sha256"]:
            raise ValueError("Only the complete original selected layout can be finalized.")
        counts = {
            "hardlinks": sum(c["method"] == "hardlink" for c in choices.values()),
            "copies": sum(c["method"] == "copy" for c in choices.values()),
            "duplicate_links": sum(c["method"] == "duplicate" for c in choices.values()),
            "directories": sum(r["kind"] == "directory" for r in rows.values()),
            "symlinks": sum(r["kind"] == "symlink" for r in rows.values()),
            "file_bytes_written": 0,
            "retained_copy_bytes": sum(rows[p]["bytes"] for p, c in choices.items()
                                       if c["method"] == "copy"),
        }
        result = {
            **{k: v for k, v in public.items() if k not in {"stage", "action"}},
            "stage_identity": stage_identity,
            "outcome": "materialized", "action": "finalized_complete_stage", **counts,
            "completion_recovery": {
                "original_report_sha256": original_report_sha256,
                "receipt_identity": receipt_identity,
            },
        }
        raw = (json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n").encode()
        receipt = stage / RECEIPT
        descriptor = os.open(receipt, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(descriptor)
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or stat.S_IMODE(info.st_mode) != 0o600
                    or (info.st_dev, info.st_ino) !=
                       (receipt_identity["device"], receipt_identity["inode"])):
                raise ValueError("Retain the original private completion receipt inode.")
            before = os.read(descriptor, len(raw) + 1)
            # The initial empty file and an interrupted prefix of THIS exact
            # finalization are the only writable receipt states.
            if not raw.startswith(before) or info.st_size != len(before):
                raise ValueError("Existing completion receipt contains different bytes.")
            _stage_check(chain, stage, stage_identity, directory)
            if stable(receipt.lstat()) != stable(info):
                raise ValueError("Original completion receipt changed while selected.")
            remaining = memoryview(raw)[len(before):]
            while remaining:
                count = os.write(descriptor, remaining)
                if count <= 0:
                    raise OSError("Original completion receipt could not be written.")
                remaining = remaining[count:]
            os.fsync(descriptor)
            current = os.fstat(descriptor)
            named = receipt.lstat()
            if (current.st_nlink != 1 or stable(named) != stable(current)
                    or (current.st_dev, current.st_ino) !=
                       (receipt_identity["device"], receipt_identity["inode"])):
                raise ValueError("Original completion receipt changed during finalization.")
            os.lseek(descriptor, 0, os.SEEK_SET)
            if os.read(descriptor, len(raw) + 1) != raw:
                raise ValueError("The original completion receipt did not persist exactly.")
        finally:
            os.close(descriptor)
        _stage_check(chain, stage, stage_identity, directory)
        os.fsync(directory)
        _publish(stage, destination)
        parent = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
        public.pop("stage", None)
        return result
    finally:
        os.close(directory)
