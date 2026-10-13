#!/usr/bin/env python3
"""Save a complete operating workspace and its full report in the same native process."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time
import zipfile

PART_BYTES = 10 * 1024 * 1024
PART_BATCH = 20


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".pending-" + str(os.getpid()))
    with temporary.open("w", encoding="utf-8") as out:
        json.dump(value, out, ensure_ascii=False, indent=2)
        out.write("\n")
        out.flush()
        os.fsync(out.fileno())
    temporary.replace(path)


def public(row):
    return {key: row[key] for key in ("local_path", "status", "library_file_id",
            "file_id", "file_name", "current_version_number", "error_code") if key in row}


def complete(row):
    return row.get("status") == "succeeded" and row.get("library_file_id") and row.get("file_id")


def save_complete_delivery(*, root, export, helpers, helper_state, report, operation,
                           source_identity, filename, excluded=(), emit=print):
    root, export, helpers, helper_state, report = map(Path, (root, export, helpers, helper_state, report))
    if root.resolve() != root or not root.is_dir():
        raise ValueError("Use the complete original operating workspace.")
    if Path(filename).name != filename or not filename.endswith(".zip"):
        raise ValueError("Use one complete ZIP artifact filename.")
    export.mkdir(mode=0o700, parents=True, exist_ok=True)
    helper_state.mkdir(mode=0o700, parents=True, exist_ok=True)
    excluded_paths = {Path(value) for value in excluded} | {export, helper_state}
    raw_report = json.loads(report.read_bytes())
    archive = export / filename
    members, directories, skipped = [], [], []
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED,
                         compresslevel=6, allowZip64=True) as target:
        for folder, folders, files in os.walk(root, followlinks=False):
            parent = Path(folder)
            if parent != root:
                info = parent.stat()
                directories.append({"path": parent.relative_to(root).as_posix(),
                                    "mode": stat.S_IMODE(info.st_mode), "mtime_ns": info.st_mtime_ns})
            folders.sort()
            files.sort()
            for name in list(folders):
                path = parent / name
                relative = path.relative_to(root).as_posix()
                if path in excluded_paths:
                    skipped.append({"path": relative, "kind": "original-generated-transfer-directory"})
                    folders.remove(name)
                elif path.is_symlink():
                    destination = os.readlink(path)
                    item = zipfile.ZipInfo(relative)
                    item.create_system = 3
                    item.external_attr = (stat.S_IFLNK | 0o777) << 16
                    target.writestr(item, destination.encode())
                    members.append({"path": relative, "kind": "symlink", "target": destination})
                    folders.remove(name)
            for name in files:
                path = parent / name
                relative = path.relative_to(root).as_posix()
                if path in excluded_paths or relative == "complete-checkpoint-manifest.json":
                    skipped.append({"path": relative, "kind": "preceding-manifest-or-original-transfer"})
                    continue
                before = path.lstat()
                if stat.S_ISLNK(before.st_mode):
                    destination = os.readlink(path)
                    item = zipfile.ZipInfo(relative)
                    item.create_system = 3
                    item.external_attr = (stat.S_IFLNK | 0o777) << 16
                    target.writestr(item, destination.encode())
                    members.append({"path": relative, "kind": "symlink", "target": destination})
                    continue
                if not stat.S_ISREG(before.st_mode):
                    skipped.append({"path": relative, "kind": "runtime-nonregular-member"})
                    continue
                value = hashlib.sha256()
                written = 0
                item = zipfile.ZipInfo.from_file(path, relative)
                item.compress_type = zipfile.ZIP_DEFLATED
                with path.open("rb") as source, target.open(item, "w", force_zip64=True) as output:
                    for block in iter(lambda: source.read(256 * 1024), b""):
                        output.write(block)
                        value.update(block)
                        written += len(block)
                after = path.lstat()
                if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
                    after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns
                ) or written != after.st_size:
                    raise RuntimeError("An original workspace file changed during complete capture: " + relative)
                members.append({"path": relative, "bytes": written, "sha256": value.hexdigest(),
                                "mtime_ns": after.st_mtime_ns})
        manifest = {"schema": "commons.datasette-complete-checkpoint.v1", "operation": operation,
                    "original_root": str(root), "state": raw_report["state"],
                    "source": source_identity, "files": members, "directories": directories, "excluded": skipped}
        target.writestr("complete-checkpoint-manifest.json",
                        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    archive_identity = {"file_name": filename, "bytes": archive.stat().st_size,
                        "sha256": digest(archive), "members": len(members) + 1}
    emit({"stage": "complete_original_archive", "operation": operation, "archive": archive_identity})
    journal = export / (Path(filename).stem + ".save.json")
    ledger = {"operation": operation, "archive": archive_identity, "files": {}}
    atomic_json(journal, ledger)

    def save_files(paths, label):
        paths = list(map(Path, paths))
        if not paths:
            return []
        request = {"uploads": [{"local_path": str(path), "purpose": "create_library_file",
                               "library_artifact_type": "report" if path.suffix == ".json" else "other"}
                              for path in paths]}
        selected = {str(path): {"bytes": path.stat().st_size, "sha256": digest(path)} for path in paths}
        result = subprocess.run([sys.executable, str(helpers / "library_private_upload.py"), str(helper_state)],
                                input=json.dumps(request).encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        (helper_state / (label + ".stdout")).write_bytes(result.stdout)
        (helper_state / (label + ".stderr")).write_bytes(result.stderr)
        for line in result.stderr.decode(errors="replace").splitlines():
            if line.startswith("__OPENAI_LIBRARY_FILE_WRITE_RECEIPT_V1__"):
                print(line, flush=True)
        if result.returncode:
            raise RuntimeError("The original canonical upload helper returned " + str(result.returncode))
        rows = json.loads(result.stdout).get("results")
        if not isinstance(rows, list) or len(rows) != len(paths):
            raise RuntimeError("The complete canonical save selection differs.")
        for path, row in zip(paths, rows):
            if row.get("local_path") != str(path):
                raise RuntimeError("The original canonical save returned another selected path.")
            if row.get("status") == "succeeded" and not complete(row):
                raise RuntimeError("The successful save lacks its complete persistent file identity.")
            if path.stat().st_size != selected[str(path)]["bytes"] or digest(path) != selected[str(path)]["sha256"]:
                raise RuntimeError("The original selected file changed while it was being saved.")
            ledger["files"][str(path)] = {**selected[str(path)], "saved": public(row)}
        atomic_json(journal, ledger)
        return rows

    def save_with_returned_retry(paths, label):
        rows = save_files(paths, label)
        # Retry only an actual returned failed row using the unchanged helper's
        # same selected path and retained upload/reconciliation metadata.
        for index, row in enumerate(rows):
            if not complete(row) and row.get("error_code") == "transfer_failed":
                rows[index] = save_files([paths[index]], label + "-returned-retry-" + str(index))[0]
        if not all(complete(row) for row in rows):
            emit({"stage": "complete_archive_save_continuation", "operation": operation,
                  "archive": archive_identity, "saved": [public(row) for row in rows]})
            raise RuntimeError("Continue the retained canonical file save from " + str(journal))
        return rows

    saved_report = save_with_returned_retry([report], "complete-report")[0]
    if archive_identity["bytes"] <= PART_BYTES:
        saved_archive = save_with_returned_retry([archive], "complete-archive")[0]
        result = {"state": raw_report["state"], "mode": "complete_archive",
                  "archive": archive_identity, "saved": [public(saved_archive), public(saved_report)]}
    else:
        parts = []
        parts_directory = export / (Path(filename).stem + ".parts")
        parts_directory.mkdir(mode=0o700, exist_ok=True)
        with archive.open("rb") as source:
            order = 0
            while True:
                batch = []
                for _ in range(PART_BATCH):
                    data = source.read(PART_BYTES)
                    if not data:
                        break
                    order += 1
                    path = parts_directory / (filename + ".part-" + str(order).zfill(4))
                    with path.open("wb") as output:
                        output.write(data)
                        output.flush()
                        os.fsync(output.fileno())
                    info = path.lstat()
                    batch.append({"path": path, "order": order, "bytes": len(data),
                                  "sha256": hashlib.sha256(data).hexdigest(),
                                  "identity": (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)})
                if not batch:
                    break
                rows = save_with_returned_retry([item["path"] for item in batch], "complete-parts-" + str(order))
                for item, row in zip(batch, rows):
                    parts.append({"order": item["order"], "file_name": item["path"].name,
                                  "bytes": item["bytes"], "sha256": item["sha256"], "saved": public(row)})
                    info = item["path"].lstat()
                    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or (
                        info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns
                    ) != item["identity"] or digest(item["path"]) != item["sha256"]:
                        raise RuntimeError("The original successful transport copy changed.")
                    item["path"].unlink()
                emit({"stage": "complete_original_parts_saved", "operation": operation,
                      "saved_parts": len(parts), "archive": archive_identity,
                      "parts": parts[-len(batch):]})
        if archive.stat().st_size != archive_identity["bytes"] or digest(archive) != archive_identity["sha256"]:
            raise RuntimeError("The complete original archive changed before its assembly manifest.")
        manifest_path = export / (Path(filename).stem + "_Parts.json")
        value = {"schema": "commons.complete-checkpoint-parts.v1", "operation": operation,
                 "state": raw_report["state"], "archive": archive_identity, "parts": parts,
                 "report": public(saved_report),
                 "assembly": "Download each complete parts[].saved file identity, write it to parts[].file_name, concatenate raw bytes in order, verify the full archive bytes/SHA256, then restore its complete original root."}
        atomic_json(manifest_path, value)
        manifest_row = save_with_returned_retry([manifest_path], "complete-part-manifest")[0]
        result = {"state": raw_report["state"], "mode": "complete_archive_parts",
                  "archive": archive_identity, "parts": parts, "saved": [public(saved_report), public(manifest_row)]}
    atomic_json(export / (Path(filename).stem + ".saved.json"), result)
    emit({"stage": "complete_original_delivery_saved", "operation": operation, **result})
    return result
