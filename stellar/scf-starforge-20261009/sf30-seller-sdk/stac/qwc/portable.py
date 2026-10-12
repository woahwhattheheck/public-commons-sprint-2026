# SPDX-License-Identifier: MIT
"""Complete private QWC source, publication, rollback and native GIS receiving."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import uuid
import zipfile

from contract import (PACKAGE_SCHEMA, SCHEMA, HERE, MAX_JSON, CHUNK, need, directory,
                      member, relative, identifier, measure, read_json, json_bytes,
                      digest, value_hash, keep_json, atomic, copy_file, sync_directory,
                      writer, original_gis, now)
from host import NativeContext

EXPORT_SCHEMA = "starforge.stac-qwc-export-input.v1"
RECEIVED_SCHEMA = "starforge.stac-qwc-received.v1"
DEFAULT_MAX_BYTES = 16 * 1024 * 1024 * 1024


def record(raw):
    need(isinstance(raw, dict) and type(raw.get("bytes")) is int and raw["bytes"] >= 0 and
         isinstance(raw.get("sha256"), str) and len(raw["sha256"]) == 64 and
         all(c in "0123456789abcdef" for c in raw["sha256"]),
         "PACKAGE_FILE_DESCRIPTOR", "Keep each complete original file descriptor.")
    return {"path": relative(raw["path"]), "bytes": raw["bytes"], "sha256": raw["sha256"]}


def _metadata(archive, name):
    info = archive.getinfo(name)
    need(info.file_size <= MAX_JSON, "PACKAGE_METADATA_LIMIT",
         "The complete package metadata exceeds its supported native size.", path=name)
    body = archive.read(info)
    try:
        value = json.loads(body.decode("utf-8"), parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
    except (ValueError, UnicodeError) as error:
        raise ValueError("The original package JSON is invalid: " + name) from error
    return value, body


def inspect_archive(path, *, expected_sha256=None, max_bytes=DEFAULT_MAX_BYTES, verify_files=False, progress=None):
    measured = measure(path, progress=progress)
    need(expected_sha256 is None or measured["sha256"] == expected_sha256,
         "PACKAGE_TRANSFER_CHANGED", "The received archive differs from its original transfer identity.")
    need(type(max_bytes) is int and max_bytes > 0, "PACKAGE_BUDGET_REQUIRED",
         "Select the complete decoded archive allowance.")
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        need(len(names) <= 1000000 and len(names) == len(set(names)) and "qwc-package.json" in names,
             "PACKAGE_MEMBERS", "The original complete package has missing or duplicate members.")
        manifest, manifest_body = _metadata(archive, "qwc-package.json")
        need(manifest.get("schema") == PACKAGE_SCHEMA and isinstance(manifest.get("files"), list),
             "QWC_PACKAGE_REQUIRED", "Open a complete original QWC publication package.")
        files = {}
        for raw in manifest["files"]:
            row = record(raw)
            need(row["path"] not in files, "PACKAGE_FILE_DUPLICATE", "An original package member is declared twice.")
            files[row["path"]] = row
        need(set(names) == set(files) | {"qwc-package.json"},
             "PACKAGE_FILE_CLOSURE", "Keep every original declared member and the complete package manifest.")
        total = sum(x["bytes"] for x in files.values())
        need(total == manifest.get("totalBytes") and total <= max_bytes,
             "PACKAGE_DECODED_BUDGET", "The complete decoded package exceeds the selected allowance.",
             requiredBytes=total, selectedBytes=max_bytes)
        for name in names:
            relative(name)
            info = archive.getinfo(name)
            mode = (info.external_attr >> 16) & 0xffff
            need(not info.is_dir() and not stat.S_ISLNK(mode) and
                 (not stat.S_IFMT(mode) or stat.S_ISREG(mode)) and
                 info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) and not (info.flag_bits & 1),
                 "PACKAGE_MEMBER_TYPE", "Use an ordinary unencrypted source-file archive.", path=name)
            if name in files:
                need(info.file_size == files[name]["bytes"], "PACKAGE_FILE_SIZE",
                     "A package member differs from its retained original size.", path=name)
        need("operation/publication.json" in files and "operation/source/qgis-project.zip" in files and
             "operation/source/workspace-snapshot.json" in files,
             "QWC_PACKAGE_SOURCE_CLOSURE", "Keep the complete publication and original native QGIS archive.")
        publication, publication_body = _metadata(archive, "operation/publication.json")
        need(publication.get("schema") == SCHEMA and
             digest(publication_body) == manifest.get("publicationSha256") and
             publication.get("publicationId") == manifest.get("publicationId") and
             publication.get("requestId") == manifest.get("requestId") and
             publication.get("operationId") == manifest.get("operationId"),
             "PACKAGE_PUBLICATION_IDENTITY", "The complete package belongs to a different original publication.")
        for raw in publication["files"]:
            row = record(raw)
            retained = files.get("operation/" + row["path"])
            need(retained is not None and all(retained[k] == row[k] for k in ("bytes", "sha256")),
                 "PACKAGE_PUBLICATION_CLOSURE", "A retained original publication member is missing or changed.",
                 path=row["path"])
        source = publication["qgis"]["package"]
        actual = files.get("operation/" + source["path"])
        need(actual is not None and all(actual[k] == source[k] for k in ("bytes", "sha256")),
             "PACKAGE_GIS_SOURCE_CHANGED", "The package's original GIS archive differs from the selected map.")
        snapshot, _ = _metadata(archive, "operation/source/workspace-snapshot.json")
        need(snapshot["state"]["id"] == publication["qgis"]["workspaceId"] and
             snapshot["state"]["revision"] == publication["qgis"]["revision"] and
             any(x["id"] == publication["qgis"]["projectId"] for x in snapshot["state"]["projects"]),
             "PACKAGE_GIS_SELECTION", "The package contains a different original GIS workspace or saved map.")
        if verify_files:
            for index, row in enumerate(files.values(), 1):
                sha, count = hashlib.sha256(), 0
                with archive.open(row["path"]) as stream:
                    while block := stream.read(CHUNK):
                        count += len(block)
                        need(count <= row["bytes"], "PACKAGE_FILE_EXPANSION", "An original member exceeded its retained size.")
                        sha.update(block)
                        if progress:
                            progress({"phase": "archive-verify", "path": row["path"], "bytes": count,
                                      "totalBytes": row["bytes"], "file": index, "files": len(files)})
                need(count == row["bytes"] and sha.hexdigest() == row["sha256"],
                     "PACKAGE_FILE_HASH", "An original archive member differs from its exact retained bytes.", path=row["path"])
    return {"manifest": manifest, "manifestSha256": digest(manifest_body),
            "archive": measured, "publication": publication, "files": list(files.values())}


def _zip_info(name):
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.external_attr = (stat.S_IFREG | 0o600) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    return info


def export_publication(workspace, request_id, destination, export_id, *, context=None):
    identifier(export_id, "exportId")
    destination = Path(destination).expanduser().absolute()
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    need(not destination.is_symlink(), "EXPORT_DESTINATION_LINK", "Choose an ordinary archive destination.")
    need(not destination.is_relative_to(workspace._operation(request_id)),
         "EXPORT_INSIDE_SOURCE", "Keep the archive outside its immutable publication operation.")
    with workspace._owned(context) as (ctx, _):
        op = workspace._operation(request_id)
        publication, publication_body = read_json(op / "publication.json")
        job = directory(workspace.root / "exports" / export_id, True)
        input_path, receipt_path = job / "input.json", job / "result.json"
        if input_path.exists():
            selected, _ = read_json(input_path)
            need(selected.get("schema") == EXPORT_SCHEMA and selected.get("requestId") == request_id and
                 selected.get("publicationSha256") == digest(publication_body) and
                 selected.get("destination") == str(destination),
                 "EXPORT_OPERATION_CHANGED", "This export identity already belongs to a different original selection.")
        else:
            immutable = [record(x) for x in publication["files"]]
            immutable.append({"path": "publication.json", **measure(op / "publication.json")})
            mutable_names = ["operation.json", "deployment-plan.json", "deployment.json",
                             "published-deployment.json", "rollback.json"]
            inline = {}
            for name in mutable_names:
                path = op / name
                if path.exists():
                    _, body = read_json(path)
                    inline["operation/" + name] = body.decode("utf-8")
            inline["operator-workspace.json"] = workspace.marker_body.decode("utf-8")
            files = [{"path": "operation/" + x["path"], "bytes": x["bytes"], "sha256": x["sha256"]}
                     for x in immutable]
            files += [{"path": name, "bytes": len(text.encode("utf-8")), "sha256": digest(text.encode("utf-8"))}
                      for name, text in inline.items()]
            files.sort(key=lambda x: x["path"])
            need(len(files) == len({x["path"] for x in files}), "EXPORT_FILE_COLLISION",
                 "The complete original export contains a duplicate file.")
            phase = workspace._state(op)["phase"]
            manifest = {"schema": PACKAGE_SCHEMA, "operationId": publication["operationId"],
                        "requestId": request_id, "publicationId": publication["publicationId"],
                        "publicationSha256": digest(publication_body), "exportId": export_id,
                        "phase": phase, "createdAt": now(), "files": files,
                        "totalBytes": sum(x["bytes"] for x in files)}
            selected = {"schema": EXPORT_SCHEMA, "requestId": request_id,
                        "publicationSha256": digest(publication_body), "destination": str(destination),
                        "inline": inline, "manifest": manifest}
            keep_json(input_path, selected)
        if receipt_path.exists():
            receipt, _ = read_json(receipt_path)
            measure(destination, receipt, ctx.checkpoint)
            return receipt
        if destination.exists():
            verified = inspect_archive(destination, max_bytes=selected["manifest"]["totalBytes"],
                                       verify_files=True, progress=ctx.checkpoint)
            need(verified["manifest"] == selected["manifest"], "EXPORT_DESTINATION_EXISTS",
                 "This archive destination belongs to a different original export.")
        else:
            fd, temporary = tempfile.mkstemp(prefix=".qwc-export-", suffix=".zip", dir=destination.parent)
            os.close(fd)
            try:
                with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                    for index, row in enumerate(selected["manifest"]["files"], 1):
                        ctx.checkpoint({"phase": "export", "file": index, "files": len(selected["manifest"]["files"]),
                                        "path": row["path"]})
                        if row["path"] in selected["inline"]:
                            body = selected["inline"][row["path"]].encode("utf-8")
                            need(len(body) == row["bytes"] and digest(body) == row["sha256"],
                                 "EXPORT_METADATA_CHANGED", "The retained export metadata changed.")
                            archive.writestr(_zip_info(row["path"]), body)
                            continue
                        need(row["path"].startswith("operation/"), "EXPORT_FILE_ORIGIN",
                             "Use the original selected operation as the archive source.")
                        source = member(op, row["path"][len("operation/"):])
                        sha, count = hashlib.sha256(), 0
                        with source.open("rb") as src, archive.open(_zip_info(row["path"]), "w", force_zip64=True) as dst:
                            while block := src.read(CHUNK):
                                count += len(block)
                                need(count <= row["bytes"], "EXPORT_SOURCE_CHANGED", "An original source file grew during export.")
                                sha.update(block)
                                dst.write(block)
                                ctx.checkpoint()
                        need(count == row["bytes"] and sha.hexdigest() == row["sha256"],
                             "EXPORT_SOURCE_CHANGED", "An original selected file changed during export.", path=row["path"])
                    archive.writestr(_zip_info("qwc-package.json"), json_bytes(selected["manifest"]))
                with open(temporary, "rb") as stream:
                    os.fsync(stream.fileno())
                try:
                    os.link(temporary, destination)
                except FileExistsError:
                    verified = inspect_archive(destination, max_bytes=selected["manifest"]["totalBytes"],
                                               verify_files=True, progress=ctx.checkpoint)
                    need(verified["manifest"] == selected["manifest"], "EXPORT_DESTINATION_EXISTS",
                         "This destination now contains another original archive.")
                sync_directory(destination.parent)
            finally:
                Path(temporary).unlink(missing_ok=True)
        receipt = {"schema": "starforge.stac-qwc-exported.v1", "exportId": export_id,
                   "publicationId": publication["publicationId"], "publicationSha256": digest(publication_body),
                   "path": str(destination), **measure(destination, progress=ctx.checkpoint),
                   "manifestSha256": value_hash(selected["manifest"]), "completedAt": now(),
                   "files": len(selected["manifest"]["files"]), "totalDecodedBytes": selected["manifest"]["totalBytes"]}
        keep_json(receipt_path, receipt)
        return receipt


def _receive_member(archive, root, row, progress=None):
    target = member(root, row["path"], False)
    if target.exists():
        measure(target, row, progress)
        sync_directory(target.parent)
        return
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".qwc-receive-", dir=target.parent)
    try:
        sha, count = hashlib.sha256(), 0
        with archive.open(row["path"]) as source, os.fdopen(fd, "wb") as output:
            os.fchmod(output.fileno(), 0o600)
            while block := source.read(CHUNK):
                count += len(block)
                need(count <= row["bytes"], "RECEIVING_FILE_EXPANSION", "The received member exceeds its original size.")
                sha.update(block)
                output.write(block)
                if progress:
                    progress({"phase": "receive", "path": row["path"], "bytes": count, "totalBytes": row["bytes"]})
            output.flush()
            os.fsync(output.fileno())
        need(count == row["bytes"] and sha.hexdigest() == row["sha256"], "RECEIVING_FILE_HASH",
             "The received source file differs from its original descriptor.", path=row["path"])
        try:
            os.link(temporary, target)
        except FileExistsError:
            measure(target, row)
        sync_directory(target.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def receive_publication(archive_path, destination, expected_sha256, *, max_bytes=DEFAULT_MAX_BYTES, context=None):
    need(isinstance(expected_sha256, str) and len(expected_sha256) == 64,
         "RECEIVING_ARCHIVE_IDENTITY", "Use the original complete archive SHA-256 from its transfer receipt.")
    ctx = context or NativeContext()
    prepared = inspect_archive(archive_path, expected_sha256=expected_sha256, max_bytes=max_bytes,
                               progress=ctx.checkpoint)
    root = Path(destination).expanduser().absolute()
    root = directory(root, True)
    marker = {"schema": "starforge.stac-qwc-receiving-input.v1",
              "archiveSha256": expected_sha256, "archiveBytes": prepared["archive"]["bytes"],
              "manifestSha256": prepared["manifestSha256"],
              "publicationId": prepared["manifest"]["publicationId"],
              "publicationSha256": prepared["manifest"]["publicationSha256"]}
    marker_path = root / "receiving-operation.json"
    if not marker_path.exists():
        need(not any(root.iterdir()), "NEW_RECEIVING_DIRECTORY", "Choose an empty directory for the complete received publication.")
        keep_json(marker_path, marker)
    else:
        need(read_json(marker_path)[0] == marker, "RECEIVING_OPERATION_CHANGED",
             "Reopen the same original source archive in this receiving directory.")
    with writer(root) as fd:
        ctx.fds.add(fd)
        try:
            ctx.checkpoint()
            with zipfile.ZipFile(archive_path) as archive:
                for row in prepared["files"]:
                    _receive_member(archive, root, row, ctx.checkpoint)
                native_manifest = archive.read("qwc-package.json")
                need(digest(native_manifest) == prepared["manifestSha256"], "PACKAGE_MANIFEST_CHANGED",
                     "The original manifest changed while receiving.")
                atomic(root / "qwc-package.json", native_manifest, create_only=True)
            publication = prepared["publication"]
            op = directory(root / "operation")
            source_archive = member(op, publication["qgis"]["package"]["path"])
            # The maintained native receiver owns all GIS source/database/history decisions.
            gis = original_gis().receive_package(source_archive, op / "project" / "gis",
                                                  expected_sha256=publication["qgis"]["package"]["sha256"],
                                                  progress=ctx.checkpoint)
            snapshot, _ = read_json(op / "source" / "workspace-snapshot.json")
            need(gis["workspace"].snapshot() == snapshot,
                 "RECEIVED_GIS_SNAPSHOT_CHANGED", "The original native GIS receiver reopened a different source edition.")
            for row in publication["files"]:
                measure(member(op, row["path"]), row, ctx.checkpoint)
            receipt_path = root / "received-package.json"
            if receipt_path.exists():
                receipt, _ = read_json(receipt_path)
                need(all(receipt.get(k) == marker[k] for k in marker if k != "schema"),
                     "RECEIVING_RESULT_CHANGED", "The received publication belongs to a different original archive.")
                return {"directory": str(root), "receipt": receipt, "replayed": True}
            receipt = {"schema": RECEIVED_SCHEMA, **{k: v for k, v in marker.items() if k != "schema"},
                       "operationId": publication["operationId"], "requestId": publication["requestId"],
                       "receivedAt": now(), "files": len(prepared["files"]),
                       "qgis": gis["receipt"], "originalHost": publication["service"]}
            keep_json(receipt_path, receipt)
            sync_directory(root)
            return {"directory": str(root), "receipt": receipt, "replayed": False}
        finally:
            ctx.fds.discard(fd)


def inspect_received(root, *, verify=True, progress=None):
    root = directory(root)
    receipt, _ = read_json(root / "received-package.json")
    need(receipt.get("schema") == RECEIVED_SCHEMA, "RECEIVED_PUBLICATION_REQUIRED",
         "Open a completed original QWC receiving directory.")
    manifest, manifest_body = read_json(root / "qwc-package.json")
    need(digest(manifest_body) == receipt["manifestSha256"] and
         manifest["publicationId"] == receipt["publicationId"],
         "RECEIVED_MANIFEST_CHANGED", "The original receiving manifest changed.")
    op = directory(root / "operation")
    publication, body = read_json(op / "publication.json")
    need(digest(body) == receipt["publicationSha256"], "RECEIVED_PUBLICATION_CHANGED",
         "The original publication manifest changed after receiving.")
    if verify:
        for row in manifest["files"]:
            measure(member(root, row["path"]), row, progress)
    return {"directory": str(root), "receipt": receipt, "publication": publication,
            "publicationSha256": digest(body), "files": len(manifest["files"]), "verified": verify}


def reopen_received(root, qgis_python, *, invocation_id=None, context=None):
    root = directory(root)
    need(isinstance(qgis_python, str) and Path(qgis_python).is_absolute() and Path(qgis_python).is_file(),
         "NATIVE_QGIS_PYTHON_REQUIRED", "Choose the actual existing QGIS Python executable.")
    invocation_id = identifier(invocation_id or "reopen-" + uuid.uuid4().hex, "invocationId")
    ctx = context or NativeContext()
    with writer(root) as fd:
        ctx.fds.add(fd)
        try:
            selected = inspect_received(root, verify=True, progress=ctx.checkpoint)
            op = root / "operation"
            invocation = directory(root / "native-reopenings" / invocation_id, True)
            request = {"schema": "starforge.stac-qwc-native-reopen-input.v1",
                       "invocationId": invocation_id,
                       "receivingDirectory": str(root), "publicationSha256": selected["publicationSha256"],
                       "gisDirectory": str(op / "project" / "gis"),
                       "projectDirectory": str(op / "project"), "result": str(invocation / "result.json"),
                       "qgisPython": qgis_python, "nativeReader": measure(HERE / "reopen.py")}
            input_path = invocation / "input.json"
            keep_json(input_path, request)
            ctx.checkpoint({"phase": "native-reopen-selected", "invocationId": invocation_id,
                            "directory": str(invocation)})
            record_path = invocation / "jobs" / "native-reopen.json"
            result_path = invocation / "result.json"
            completed = read_json(record_path)[0] if record_path.exists() else None
            argv = [qgis_python, "-B", str(HERE / "reopen.py"), "--input", str(input_path)]
            if not (completed and completed.get("phase") == "CLOSED" and completed.get("exitCode") == 0 and
                    completed.get("command") == argv and result_path.exists()):
                ctx.run(argv, invocation / "jobs", "native-reopen")
            result, _ = read_json(result_path)
            need(result.get("invocationId") == invocation_id and
                 result.get("publicationSha256") == selected["publicationSha256"] and
                 result.get("publicationId") == selected["publication"]["publicationId"],
                 "NATIVE_REOPEN_IDENTITY", "The actual native reader reopened a different received publication.")
            return result
        finally:
            ctx.fds.discard(fd)
