"""Deliver a complete closed output selection from the original native producer.

Preparation checks the original record destination before application work.
Delivery reuses native checkpoints, then publishes one streamed archive from
their retained bytes. Recovery reads that same snapshot, never a later private
project. The original supervisor continues to own command outcome and capacity.
"""
from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import zipfile

if __package__:
    from . import native_artifact_checkpoints as checkpoints
    from . import native_artifact_retention as copies
else:
    import native_artifact_checkpoints as checkpoints
    import native_artifact_retention as copies

SCHEMA = "commons.native-artifact-delivery/v1"
ARCHIVE_SCHEMA = "commons.native-artifact-delivery-archive/v1"
SPAN_SCHEMA = "commons.native-artifact-delivery-span/v1"
MAX_SPAN_BYTES = 1024 * 1024
DIRECTORY = "deliveries"
MANIFEST = "delivery.json"
ARCHIVE = "delivery.zip"
ARCHIVE_MANIFEST = ".commons/native-delivery.json"
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$")
SHA = re.compile(r"^[0-9a-f]{64}$")
MAX_MANIFEST = 16 * 1024 * 1024
BLOCK = 256 * 1024


def _native():
    if __package__:
        from . import swarm_cloud_job
    else:
        import swarm_cloud_job
    return swarm_cloud_job


def _encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False).encode("utf-8")


def _digest(value):
    return hashlib.sha256(_encoded(value)).hexdigest()


def _key(delivery_id):
    if not isinstance(delivery_id, str) or not IDENTIFIER.fullmatch(delivery_id):
        raise ValueError("Use a stable delivery ID of 1 to 120 letters, digits, dots, colons, hyphens or underscores")
    return hashlib.sha256(delivery_id.encode("utf-8")).hexdigest()


def _sha(value, label):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise ValueError("Select the exact " + label + " SHA-256")
    return value


def _request(root):
    native = _native()
    root = Path(root).resolve(strict=True)
    request = native.read_json(root / "request.json")
    if (not isinstance(request, dict) or request.get("schema") != native.SCHEMA or
            native.run_path(request["intent"]["operation_id"], root.parent) != root):
        raise ValueError("Select the original native command record")
    return root, request


def _identity(info):
    return {"device": info.st_dev, "inode": info.st_ino}


def _stable(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def _private_directory(descriptor):
    info = os.fstat(descriptor)
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid()
            or stat.S_IMODE(info.st_mode) & 0o077):
        raise ValueError("The selected native delivery destination must be an owned private directory")
    return _identity(info)


@contextmanager
def _lock(root, key, *, create=False, namespace=DIRECTORY):
    parent = copies.open_snapshot_directory(root, (namespace, key), create=create)
    descriptor = None
    try:
        _private_directory(parent)
        descriptor = os.open(".lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
                             0o600, dir_fd=parent)
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077):
            raise ValueError("The original delivery lock must be an owned private regular file")
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield parent
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(parent)


def _read(root, key):
    try:
        descriptor = copies.open_snapshot_file(root, DIRECTORY + "/" + key + "/" + MANIFEST)
    except FileNotFoundError:
        return None
    try:
        before = os.fstat(descriptor)
        if (not stat.S_ISREG(before.st_mode) or before.st_size > MAX_MANIFEST
                or before.st_nlink != 1 or stat.S_IMODE(before.st_mode) & 0o077):
            raise ValueError("The delivery plan must be a bounded private regular file")
        data = bytearray()
        while len(data) <= before.st_size:
            block = os.read(descriptor, min(BLOCK, before.st_size - len(data) + 1))
            if not block:
                break
            data.extend(block)
        if len(data) != before.st_size or _stable(os.fstat(descriptor)) != _stable(before):
            raise ValueError("The delivery plan changed during its read")
        return json.loads(data)
    finally:
        os.close(descriptor)


def _save(root, key, value):
    if len(_encoded(value)) > MAX_MANIFEST:
        raise ValueError("The delivery record exceeds its 16 MiB limit")
    _native().save_json(root / DIRECTORY / key / MANIFEST, value)


def _plan(value):
    return {key: value[key] for key in (
        "schema", "binding", "delivery_id", "checkpoint_id", "label", "selection",
        "created_at", "source_process", "producer", "project_identity", "destination")}


def _validate(value, request, delivery_id, expected_plan=None):
    if (not isinstance(value, dict) or value.get("schema") != SCHEMA
            or value.get("binding") != copies.snapshot_binding(request)
            or value.get("delivery_id") != delivery_id
            or value.get("checkpoint_id") != "delivery:" + delivery_id
            or value.get("state") not in ("prepared", "checkpoint_pending", "packaging", "complete")):
        raise ValueError("The delivery plan differs from its original command or selection")
    paths = value.get("selection", {}).get("paths")
    if checkpoints.selection_paths(paths) != paths:
        raise ValueError("The delivery output selection changed")
    if (not isinstance(value.get("label"), str) or not 1 <= len(value["label"]) <= 240
            or value.get("plan_sha256") != _digest(_plan(value))):
        raise ValueError("The original prepared delivery plan changed")
    if expected_plan is not None and expected_plan != value["plan_sha256"]:
        raise ValueError("Select the exact prepared delivery plan SHA-256")
    snapshot = value.get("checkpoint_snapshot")
    if snapshot is not None and (not isinstance(snapshot, str) or not SHA.fullmatch(snapshot)):
        raise ValueError("The delivery checkpoint snapshot is invalid")
    archive = value.get("archive")
    if value["state"] == "complete" or archive is not None:
        if (not snapshot or not isinstance(archive, dict)
                or archive.get("file") != DIRECTORY + "/" + _key(delivery_id) + "/" + ARCHIVE
                or type(archive.get("bytes")) is not int or archive["bytes"] < 1
                or not isinstance(archive.get("sha256"), str) or not SHA.fullmatch(archive["sha256"])
                or archive.get("checkpoint_snapshot") != snapshot):
            raise ValueError("The completed delivery archive is not bound to its original snapshot")
    return value


def _probe(parent):
    # An actual write and fsync catch permissions, full journals and invalid
    # final destinations before application work. Original admission owns the
    # complete declared disk/inode budget; this probe does not reserve capacity.
    name = ".destination-probe-" + os.urandom(12).hex()
    descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=parent)
    try:
        data, done = b"\0" * 4096, 0
        while done < len(data):
            count = os.write(descriptor, data[done:])
            if count <= 0:
                raise OSError("The delivery destination write made no progress")
            done += count
        os.fsync(descriptor)
        os.fsync(parent)
    finally:
        os.close(descriptor)
        os.unlink(name, dir_fd=parent)
        os.fsync(parent)


def prepare(root, delivery_id, paths, *, label=None):
    """The original producer calls this before creating its application outputs."""
    context = checkpoints.producer_context(root)
    root, request = context["root"], context["request"]
    paths, key = checkpoints.selection_paths(paths), _key(delivery_id)
    label = delivery_id if label is None else label
    if not isinstance(label, str) or not label.strip() or len(label) > 240:
        raise ValueError("Use a delivery label of 1 to 240 characters")
    project = Path(request["intent"]["project"])
    for path in paths:
        selected = (project / path).resolve()
        if root == selected or root.is_relative_to(selected):
            raise ValueError("Keep the native record outside the delivered output selection")
    descriptor = copies.open_snapshot_directory(root)
    try:
        original_destination = _private_directory(descriptor)
    finally:
        os.close(descriptor)
    with _lock(root, key, create=True) as parent:
        value = _read(root, key)
        if value is not None:
            _validate(value, request, delivery_id)
            if (value["selection"]["paths"] != paths or value["label"] != label
                    or value["source_process"] != context["source_process"]
                    or value["project_identity"] != context["project_identity"]):
                raise ValueError("A delivery ID must retain its original producer and output selection")
            return value
        checkpoint_key = hashlib.sha256(("delivery:" + delivery_id).encode("utf-8")).hexdigest()
        try:
            existing = copies.open_snapshot_file(root, checkpoints.DIRECTORY + "/" + checkpoint_key + "/" + checkpoints.MANIFEST)
        except FileNotFoundError:
            existing = None
        if existing is not None:
            os.close(existing)
            raise ValueError("This delivery checkpoint ID already exists; select a new complete handover ID")
        _probe(parent)
        value = {"schema": SCHEMA, "binding": copies.snapshot_binding(request),
            "delivery_id": delivery_id, "checkpoint_id": "delivery:" + delivery_id,
            "label": label, "selection": {"paths": paths}, "created_at": _native().now(),
            "source_process": context["source_process"], "producer": context["producer"],
            "project_identity": context["project_identity"],
            "destination": {"record": str(root), "record_identity": original_destination,
                            "directory": str(root / DIRECTORY / key),
                            "directory_identity": _private_directory(parent)},
            "state": "prepared", "checkpoint_snapshot": None, "archive": None, "errors": []}
        value["plan_sha256"] = _digest(_plan(value))
        _save(root, key, value)
        os.fsync(parent)
        return value


def info(root, delivery_id):
    root, request = _request(root)
    value = _read(root, _key(delivery_id))
    if value is None:
        raise ValueError("This original command has no prepared delivery with that ID")
    return _validate(value, request, delivery_id)


def _checkpoint(value, root, request, *, expected_snapshot=None):
    checkpoint = checkpoints.detail(root, value["checkpoint_id"])
    if (checkpoint["binding"] != copies.snapshot_binding(request)
            or checkpoint["selection"] != value["selection"]
            or checkpoint["source_process"] != value["source_process"]
            or checkpoint["project_identity"] != value["project_identity"]
            or checkpoint["label"] != value["label"]
            or checkpoint["created_at"] < value["created_at"]):
        raise ValueError("The retained checkpoint differs from the prepared delivery")
    wanted = expected_snapshot or value.get("checkpoint_snapshot")
    if wanted is not None and checkpoint["snapshot"] != wanted:
        raise ValueError("Select the prepared delivery's exact checkpoint snapshot")
    return checkpoint


def _archive_manifest(value, checkpoint):
    return {"schema": ARCHIVE_SCHEMA, "binding": value["binding"],
        "delivery_id": value["delivery_id"], "plan_sha256": value["plan_sha256"],
        "checkpoint": {key: checkpoint[key] for key in (
            "schema", "checkpoint_id", "snapshot", "label", "selection", "created_at",
            "collected_at", "completed_at", "source_process", "producer", "project_identity")},
        "files": [{**row, "member": "output/" + row["path"]}
                  for row in copies.snapshot_items(checkpoint["files"])]}


def _hash_file(descriptor, expected_size=None, expected_sha=None, *, check=None, progress=None, return_identity=False):
    if (check is not None and not callable(check)) or (progress is not None and not callable(progress)):
        raise ValueError("Archive verification callbacks must be callable")
    if check is not None:
        check()
    before = os.fstat(descriptor)
    if not stat.S_ISREG(before.st_mode):
        raise ValueError("The retained delivery must remain a regular file")
    if expected_size is not None and before.st_size != expected_size:
        raise ValueError("The retained delivery byte count changed")
    digest, size = hashlib.sha256(), 0
    os.lseek(descriptor, 0, os.SEEK_SET)
    while True:
        if check is not None:
            check()
        block = os.read(descriptor, BLOCK)
        if not block:
            break
        size += len(block)
        if size > before.st_size:
            raise ValueError("The retained delivery grew during its read")
        digest.update(block)
        if progress is not None:
            progress(len(block))
    if check is not None:
        check()
    if _stable(os.fstat(descriptor)) != _stable(before) or size != before.st_size:
        raise ValueError("The retained delivery changed during its read")
    result = digest.hexdigest()
    if expected_sha is not None and result != expected_sha:
        raise ValueError("The retained delivery differs from its published SHA-256")
    os.lseek(descriptor, 0, os.SEEK_SET)
    verified = {"bytes": size, "sha256": result}
    if return_identity:
        verified["identity"] = _stable(before)
    return verified


def _entry(name, mode=0o600):
    value = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    value.create_system = 3
    value.compress_type = zipfile.ZIP_DEFLATED
    value.external_attr = (stat.S_IFREG | mode) << 16
    return value


def _existing_archive(parent, manifest, known=None):
    try:
        descriptor = os.open(ARCHIVE, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    except FileNotFoundError:
        return None
    try:
        before = os.fstat(descriptor)
        if before.st_nlink == 2:
            # A reset can occur after atomic publication but before removing
            # this delivery's pending link. Retire only that exact same inode.
            try:
                pending = os.stat(ARCHIVE + ".pending", dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                pending = None
            if pending is not None and _stable(pending) == _stable(before):
                os.unlink(ARCHIVE + ".pending", dir_fd=parent)
                os.fsync(parent)
                before = os.fstat(descriptor)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or before.st_uid != os.geteuid() or stat.S_IMODE(before.st_mode) & 0o077):
            raise ValueError("The original delivery archive must be an owned private regular file")
        result = _hash_file(descriptor, known.get("bytes") if known else None,
                            known.get("sha256") if known else None)
        # When publication outlived its journal update, recover the exact ZIP by
        # checking its embedded binding and every selected payload once.
        if known is None:
            with os.fdopen(os.dup(descriptor), "rb") as stream, zipfile.ZipFile(stream) as archive:
                expected = {ARCHIVE_MANIFEST, *(row["member"] for row in manifest["files"])}
                entries = archive.infolist()
                if len(entries) != len(expected) or {row.filename for row in entries} != expected:
                    raise ValueError("An existing archive has a different delivery selection")
                if archive.getinfo(ARCHIVE_MANIFEST).file_size > MAX_MANIFEST:
                    raise ValueError("The retained archive manifest exceeds its bound")
                if archive.read(ARCHIVE_MANIFEST) != _encoded(manifest) + b"\n":
                    raise ValueError("An existing archive belongs to a different delivery snapshot")
                for item in manifest["files"]:
                    row = archive.getinfo(item["member"])
                    if row.file_size != item["bytes"]:
                        raise ValueError("An existing archive member has a different byte count")
                    digest, count = hashlib.sha256(), 0
                    with archive.open(row) as selected:
                        while True:
                            block = selected.read(min(BLOCK, item["bytes"] - count + 1))
                            if not block:
                                break
                            count += len(block)
                            if count > item["bytes"]:
                                raise ValueError("An existing archive member exceeds its selected size")
                            digest.update(block)
                    if count != item["bytes"] or digest.hexdigest() != item["sha256"]:
                        raise ValueError("An existing archive member differs from the original checkpoint")
            if _stable(os.fstat(descriptor)) != _stable(before):
                raise ValueError("The retained archive changed during recovery")
        return result
    finally:
        os.close(descriptor)


def _write_archive(root, parent, manifest, checkpoint, expected=None):
    pending = ARCHIVE + ".pending"
    descriptor = os.open(pending, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
                         0o600, dir_fd=parent)
    try:
        before = os.fstat(descriptor)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or before.st_uid != os.geteuid() or stat.S_IMODE(before.st_mode) & 0o077):
            raise ValueError("The owned archive staging path changed")
        os.ftruncate(descriptor, 0)
        with os.fdopen(os.dup(descriptor), "w+b") as stream:
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED,
                                 compresslevel=6, allowZip64=True) as archive:
                archive.writestr(_entry(ARCHIVE_MANIFEST), _encoded(manifest) + b"\n")
                for item in checkpoint["files"]:
                    source = copies.open_snapshot_file(root, item["retained_path"])
                    try:
                        original = os.fstat(source)
                        if not stat.S_ISREG(original.st_mode) or original.st_size != item["bytes"]:
                            raise ValueError("A checkpoint member changed before delivery")
                        digest, count = hashlib.sha256(), 0
                        mode = 0o600 | (0o100 if item.get("mode", 0) & 0o111 else 0)
                        with archive.open(_entry("output/" + item["path"], mode), "w", force_zip64=True) as out:
                            while True:
                                block = os.read(source, min(BLOCK, item["bytes"] - count + 1))
                                if not block:
                                    break
                                count += len(block)
                                if count > item["bytes"]:
                                    raise ValueError("A checkpoint member grew during delivery")
                                digest.update(block)
                                out.write(block)
                        if (count != item["bytes"] or digest.hexdigest() != item["sha256"]
                                or _stable(os.fstat(source)) != _stable(original)):
                            raise ValueError("A delivered member differs from its original checkpoint")
                    finally:
                        os.close(source)
            stream.flush()
            os.fsync(stream.fileno())
        result = _hash_file(descriptor,
                            expected.get("bytes") if expected else None,
                            expected.get("sha256") if expected else None)
        # No replacement of another delivery. The lock serializes this selected
        # archive; publication is an atomic link, followed by its journal update.
        os.link(pending, ARCHIVE, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
        os.fsync(parent)
        os.unlink(pending, dir_fd=parent)
        os.fsync(parent)
        return result
    finally:
        os.close(descriptor)


def _package(root, request, delivery_id, expected_plan, checkpoint):
    key = _key(delivery_id)
    with _lock(root, key) as parent:
        value = _validate(_read(root, key), request, delivery_id, expected_plan)
        if checkpoint["state"] != "complete":
            value.update(state="checkpoint_pending", errors=checkpoint["errors"],
                         checkpoint_snapshot=checkpoint["snapshot"], updated_at=_native().now())
            _save(root, key, value)
            return value
        if value.get("checkpoint_snapshot") not in (None, checkpoint["snapshot"]):
            raise ValueError("The delivery has already selected another checkpoint snapshot")
        value["checkpoint_snapshot"] = checkpoint["snapshot"]
        manifest = _archive_manifest(value, checkpoint)
        if len(_encoded(manifest)) + 1 > MAX_MANIFEST:
            raise ValueError("The complete delivery manifest exceeds its 16 MiB limit")
        known = value.get("archive")
        try:
            result = _existing_archive(parent, manifest, known)
            if result is None:
                value.update(state="packaging", errors=[], updated_at=_native().now())
                _save(root, key, value)
                result = _write_archive(root, parent, manifest, checkpoint, expected=known)
            value.update(state="complete", errors=[], completed_at=value.get("completed_at") or _native().now(),
                         updated_at=_native().now(), current_destination={"record": str(root),
                             "directory_identity": _private_directory(parent)})
            value["archive"] = {**result, "file": DIRECTORY + "/" + key + "/" + ARCHIVE,
                "files": len(checkpoint["files"]), "source_bytes": sum(row["bytes"] for row in checkpoint["files"]),
                "checkpoint_snapshot": checkpoint["snapshot"]}
            _save(root, key, value)
            os.fsync(parent)
            return value
        except (OSError, ValueError, zipfile.BadZipFile) as exc:
            value.update(state="packaging", errors=[{"stage": "archive", "error": type(exc).__name__,
                **({"errno": exc.errno} if isinstance(exc, OSError) else {})}], updated_at=_native().now())
            _save(root, key, value)
            raise


def deliver(root, delivery_id, *, expected_plan):
    """Close application writers, then call synchronously before producer exit."""
    _sha(expected_plan, "prepared delivery plan")
    context = checkpoints.producer_context(root)
    root, request = context["root"], context["request"]
    value = _validate(_read(root, _key(delivery_id)), request, delivery_id, expected_plan)
    destination = copies.open_snapshot_directory(root)
    selected = None
    try:
        selected = copies.open_snapshot_directory(root, (DIRECTORY, _key(delivery_id)))
        if (_private_directory(destination) != value["destination"]["record_identity"]
                or _private_directory(selected) != value["destination"]["directory_identity"]):
            raise ValueError("The original preflighted delivery destination changed before capture")
    finally:
        if selected is not None:
            os.close(selected)
        os.close(destination)
    if (context["source_process"] != value["source_process"]
            or context["project_identity"] != value["project_identity"]):
        raise ValueError("The delivery belongs to another original producer")
    # Do not hold a delivery lock while checkpoint capture takes the native
    # lock. Original completion may hold that lock while finishing packaging.
    checkpoints.capture(root, value["checkpoint_id"], value["selection"]["paths"], label=value["label"])
    checked = _checkpoint(value, root, request)
    return _package(root, request, delivery_id, expected_plan, checked)


def recover(root, delivery_id, *, expected_plan, expected_snapshot):
    """Finish the selected saved bytes; a later shell's project is never read."""
    _sha(expected_plan, "prepared delivery plan")
    _sha(expected_snapshot, "retained checkpoint snapshot")
    root, request = _request(root)
    value = _validate(_read(root, _key(delivery_id)), request, delivery_id, expected_plan)
    checkpoint = _checkpoint(value, root, request, expected_snapshot=expected_snapshot)
    # Recover the original copy outside our archive lock and the completion
    # lock. The original checkpoint engine enforces allow_source=False here.
    if checkpoint["state"] != "complete":
        checkpoints.recover(root, value["checkpoint_id"], expected_snapshot=expected_snapshot)
    checked = _checkpoint(value, root, request, expected_snapshot=expected_snapshot)
    return _package(root, request, delivery_id, expected_plan, checked)


def _plans(root, request):
    try:
        parent = copies.open_snapshot_directory(root, (DIRECTORY,))
    except FileNotFoundError:
        return []
    try:
        result = []
        with os.scandir(parent) as entries:
            names = sorted(row.name for row in entries if SHA.fullmatch(row.name) and row.is_dir(follow_symlinks=False))
        for key in names:
            value = _read(root, key)
            if value is None:
                continue
            if _key(value.get("delivery_id")) != key:
                raise ValueError("The delivery directory differs from its original identity")
            result.append(_validate(value, request, value["delivery_id"]))
        return result
    finally:
        os.close(parent)


def _summary(value):
    return {key: value.get(key) for key in (
        "delivery_id", "label", "state", "plan_sha256", "checkpoint_id", "checkpoint_snapshot",
        "created_at", "completed_at", "archive", "errors")}


def view(root, request=None):
    root, selected = _request(root)
    request = selected if request is None else request
    values = _plans(root, request)
    done = sum(value["state"] == "complete" for value in values)
    return {"schema": SCHEMA, "operation_id": request["intent"]["operation_id"],
            "count": len(values), "completed": done, "pending": len(values) - done,
            "directory": str(root / DIRECTORY), "complete": done == len(values)}


def listing(root, *, offset=0, limit=25):
    root, request = _request(root)
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("Use a nonnegative delivery offset and a page size from 1 to 100")
    values = sorted(_plans(root, request), key=lambda value: (value["created_at"], value["delivery_id"]), reverse=True)
    return {"schema": SCHEMA, "operation_id": request["intent"]["operation_id"],
            "items": [_summary(value) for value in values[offset:offset + limit]],
            "total": len(values), "offset": offset, "limit": limit}


def finish(root, request):
    """Original completion may package a complete snapshot after producer exit.

    This never captures source or recovers a checkpoint while the native run
    lock is held. Incomplete copies keep their original explicit recovery route.
    """
    items, errors = [], []
    for value in _plans(root, request):
        try:
            checkpoint = _checkpoint(value, root, request)
            if checkpoint["state"] == "complete":
                value = _package(root, request, value["delivery_id"], value["plan_sha256"], checkpoint)
            else:
                errors.append({"delivery_id": value["delivery_id"], "stage": "checkpoint",
                               "state": checkpoint["state"], "checkpoint_snapshot": checkpoint["snapshot"]})
        except (OSError, ValueError, zipfile.BadZipFile) as exc:
            errors.append({"delivery_id": value["delivery_id"], "stage": "delivery",
                           "error": type(exc).__name__,
                           **({"errno": exc.errno} if isinstance(exc, OSError) else {})})
        items.append(_summary(value))
    return {"schema": SCHEMA, "operation_id": request["intent"]["operation_id"], "items": items,
            "complete": not errors and all(item["state"] == "complete" for item in items), "errors": errors}


def open_archive(root, delivery_id, *, expected_sha256, check=None, progress=None):
    """Return the exact checked descriptor and its original metadata.

    Optional callbacks observe cancellation and bytes during the same original
    full-file verification. The returned in-memory verification identity belongs
    to this still-open descriptor; consumers must recheck it before adopting the
    verified stream. It is not a saved receipt or permission to reopen a path.
    """
    root, request = _request(root)
    value = _validate(_read(root, _key(delivery_id)), request, delivery_id)
    if value["state"] != "complete" or value["archive"]["sha256"] != expected_sha256:
        raise ValueError("Select the completed delivery's exact archive SHA-256")
    item = value["archive"]
    descriptor = copies.open_snapshot_file(root, item["file"])
    try:
        verified = _hash_file(descriptor, item["bytes"], item["sha256"],
                              check=check, progress=progress, return_identity=True)
        return descriptor, {**item, "delivery_id": delivery_id, "plan_sha256": value["plan_sha256"],
                            "verification": verified}
    except BaseException:
        os.close(descriptor)
        raise


def complete(root, request):
    """Check original delivered file presence without reopening source outputs."""
    try:
        for value in _plans(root, request):
            if value["state"] != "complete":
                return False
            descriptor = copies.open_snapshot_file(root, value["archive"]["file"])
            try:
                observed = os.fstat(descriptor)
                if not stat.S_ISREG(observed.st_mode) or observed.st_size != value["archive"]["bytes"]:
                    return False
            finally:
                os.close(descriptor)
        return True
    except (OSError, ValueError, KeyError, TypeError):
        return False


def read_archive_span(root, delivery_id, *, expected_plan, expected_snapshot,
                      expected_bytes, expected_sha256, offset=0, max_bytes=BLOCK,
                      check=None, progress=None):
    """Read one exact span for a receiver that verifies the complete archive.

    Unlike open_archive, this does not hash bytes outside the requested span.
    The returned bytes, metadata and original fstat observation describe this
    one read. The descriptor is always closed before return. The observation
    can bind successive ranges; it is not full-file verification or authority
    to reopen a pathname. A complete receiver must verify the assembled size
    and original SHA-256 before publishing or treating the archive as complete.
    """
    _sha(expected_plan, "prepared plan")
    _sha(expected_snapshot, "retained checkpoint")
    _sha(expected_sha256, "completed archive")
    if (type(expected_bytes) is not int or expected_bytes < 1 or
            type(offset) is not int or not 0 <= offset <= expected_bytes or
            type(max_bytes) is not int or not 1 <= max_bytes <= MAX_SPAN_BYTES):
        raise ValueError("Select an exact completed-archive range of at most 1 MiB")
    if (check is not None and not callable(check)) or (progress is not None and not callable(progress)):
        raise ValueError("Archive span callbacks must be callable")
    if check is not None:
        check()
    root, request = _request(root)
    value = _validate(_read(root, _key(delivery_id)), request, delivery_id)
    if (value["state"] != "complete" or value["plan_sha256"] != expected_plan or
            value["checkpoint_snapshot"] != expected_snapshot or
            value["archive"]["checkpoint_snapshot"] != expected_snapshot or
            value["archive"]["bytes"] != expected_bytes or
            value["archive"]["sha256"] != expected_sha256):
        raise ValueError("Select the original completed handover, plan, checkpoint and archive")
    item = value["archive"]
    descriptor = copies.open_snapshot_file(root, item["file"])
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size != expected_bytes:
            raise ValueError("The completed delivery type or byte count changed")
        count = min(max_bytes, expected_bytes - offset)
        os.lseek(descriptor, offset, os.SEEK_SET)
        data, digest = bytearray(), hashlib.sha256()
        while len(data) < count:
            if check is not None:
                check()
            block = os.read(descriptor, min(BLOCK, count - len(data)))
            if not block:
                raise ValueError("The completed delivery ended during its selected span")
            data.extend(block)
            digest.update(block)
            if progress is not None:
                progress(len(block))
        if check is not None:
            check()
        if _stable(os.fstat(descriptor)) != _stable(before):
            raise ValueError("The completed delivery changed during its selected span")
        metadata = {**item, "delivery_id": delivery_id, "plan_sha256": expected_plan,
                    "verification": {
                        "schema": SPAN_SCHEMA, "scope": "range",
                        "whole_archive": "receiver_required_before_publication",
                        "offset": offset, "bytes": count,
                        "chunk_sha256": digest.hexdigest()}}
        return bytes(data), metadata, before
    finally:
        os.close(descriptor)


def copy_archive(root, delivery_id, directory, *, expected_sha256):
    """Receive the published ZIP through the original verified copy primitive."""
    root, request = _request(root)
    value = info(root, delivery_id)
    if value["state"] != "complete" or value["archive"]["sha256"] != expected_sha256:
        raise ValueError("Select the completed delivery's exact archive SHA-256")
    directory = Path(directory).resolve(strict=True)
    parent = copies.open_snapshot_directory(directory)
    try:
        _private_directory(parent)
        _probe(parent)
    finally:
        os.close(parent)
    # The target includes the original operation and plan, so another native
    # command using the same human delivery label cannot replace this handover.
    receiving_key = _digest({"binding": value["binding"], "plan_sha256": value["plan_sha256"]})
    target = "native-deliveries/" + receiving_key + "/files/" + ARCHIVE
    item = {"path": value["archive"]["file"], "bytes": value["archive"]["bytes"],
            "sha256": value["archive"]["sha256"], "mode": 0o600}
    # The original primitive shares one resumable .partial per exact target.
    # Serialize all receivers here, including copies of the same source record.
    with _lock(directory, receiving_key, create=True, namespace="native-deliveries"):
        copies.copy_snapshot_file(directory, root, target, item)
    return {**value["archive"], "path": str(directory / target),
            "delivery_id": delivery_id, "plan_sha256": value["plan_sha256"]}


@contextmanager
def producer_delivery(root, delivery_id, paths, *, label=None):
    """Wrap application work; a normal return waits for the complete handover."""
    plan = prepare(root, delivery_id, paths, label=label)
    yield plan
    saved = deliver(root, delivery_id, expected_plan=plan["plan_sha256"])
    if saved["state"] != "complete":
        raise RuntimeError("The original delivery is incomplete; inspect its saved checkpoint")
