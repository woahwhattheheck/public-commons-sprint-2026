#!/usr/bin/env python3
"""Receive one original saved Analysis export through the complete dataset product.

This programme never executes another SQL query, response import, acquisition
or model. It uses the selected complete typed export, native Frictionless
capture/workbench/publisher, actual browser/MCP, and original workspace archive.
Repeat the same directory and inputs to continue the original saved requests.
"""
from __future__ import annotations
import argparse
import base64
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import time
import uuid

SCHEMA = "stellar-forge.analysis-dataset-publication-native.v1"
HERE = Path(__file__).resolve().parent
PYTHON_ROOT = HERE.parent
ID = re.compile(r"[a-f0-9]{32}")
HASH = re.compile(r"[a-f0-9]{64}")
PREFIX = "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/"
SOURCE_FILES = [
    *[PREFIX + "stellar_forge_buyer/" + name for name in (
      "analysis_publication.py", "analysis_publication_source.py",
      "analysis_publication_package.py", "analysis_publication_delivery.py",
      "analysis_publication_cli.py", "publication_http.py", "_analysis_publication_ui.py",
      "analysis_workspace.py", "query_export.py", "runtime.py", "workspace_archive.py",
      "workspace_archive_receive.py")],
    PREFIX + "analysis-publication-bridge.mjs",
    *[PREFIX + "examples/" + name for name in (
      "analysis_publication_native.py", "analysis_publication_browser.mjs",
      "analysis_publication_merchant.mjs", "analysis_publication_mcp.mjs")],
    *["stellar-forge/mcp-paid-agent/" + name for name in (
      "native-analysis.mjs", "native-analysis-schema.mjs", "native-file.mjs", "serve.mjs",
      "native-analysis-publication.mjs", "native-analysis-publication-schema.mjs",
      "native-analysis-publication-download.mjs")],
    *["stellar-forge/mcp-merchant-operator/" + name for name in (
      "serve.mjs", "config.mjs", "retained-download.mjs", "frictionless-workspace-client.mjs",
      "frictionless-download-contract.mjs", "frictionless-workspace.mjs", "publisher.mjs")],
    "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs",
    *["stellar/scf-starforge-20261009/sf30-seller-sdk/" + name for name in (
      "frictionless/workbench/model.mjs", "frictionless/model.mjs", "frictionless/source.mjs",
      "frictionless/package.py", "postgres/publisher/model.mjs", "dataset-refresh/versions.mjs")],
]

def need(condition, message):
    if not condition:
        raise ValueError(message)


def now():
    return datetime.now(timezone.utc).isoformat()


def canonical(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False,
                       separators=(",", ":")) + "\n").encode("utf-8")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def regular(path):
    path = Path(path)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    stream = os.fdopen(fd, "rb")
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode):
        stream.close()
        raise ValueError("A regular source file is required: " + str(path))
    return stream


def file_record(path):
    with regular(path) as stream:
        before = os.fstat(stream.fileno())
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
        after = os.fstat(stream.fileno())
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
             "Source file changed during verification")
    return {"bytes": before.st_size, "sha256": digest}


def read_json(path, maximum=64 * 1024 * 1024):
    with regular(path) as stream:
        raw = stream.read(maximum + 1)
    need(len(raw) <= maximum, "Retained record exceeds its bound")
    return json.loads(raw)


def private(path):
    path = Path(path).absolute()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and
         not info.st_mode & 0o077 and info.st_uid == os.getuid(),
         "Select a caller-owned private directory")
    return path


def sync_parent(path):
    fd = os.open(Path(path).parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save(path, value, *, immutable=False):
    path, raw = Path(path), canonical(value)
    if immutable and path.exists():
        with regular(path) as stream:
            need(stream.read(len(raw) + 1) == raw, "Original immutable record changed: " + path.name)
        return
    pending = path.with_name(path.name + ".pending")
    # This operation's flock owns this exact write temporary.
    pending.unlink(missing_ok=True)
    fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    if immutable and path.exists():
        with regular(path) as stream:
            need(stream.read(len(raw) + 1) == raw, "Original immutable record changed")
        pending.unlink()
    else:
        os.replace(pending, path)
    sync_parent(path)


def typed(value):
    if isinstance(value, bytes):
        return {"type": "blob", "base64": base64.b64encode(value).decode("ascii")}
    if type(value) is float and not math.isfinite(value):
        return {"type": "sqlite-real", "value": repr(value)}
    return value


def quoted(name):
    return '"' + name.replace('"', '""') + '"'


def native_basis(directory):
    """Stream original table rows, and preserve each completed job by its own ID."""
    database = Path(directory) / "datasets.sqlite3"
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as db:
        db.execute("BEGIN")
        workspace = db.execute("SELECT workspace_id FROM sf_analysis_format WHERE id=1").fetchone()[0]
        tables = db.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
        protected = {}
        for name, definition in tables:
            if name == "sf_analysis_jobs" or name.startswith("sf_analysis_publication_") or name.endswith("_control"):
                continue
            columns = db.execute("PRAGMA table_info(" + quoted(name) + ")").fetchall()
            primary = [x[1] for x in sorted(columns, key=lambda x: x[5]) if x[5]]
            order = ",".join(map(quoted, primary)) if primary else "rowid"
            digest, count = hashlib.sha256(), 0
            for row in db.execute("SELECT * FROM " + quoted(name) + " ORDER BY " + order):
                digest.update(canonical([typed(value) for value in row]))
                count += 1
            protected[name] = {"schema_sha256": sha((definition or "").encode()),
                               "rows": count, "rows_sha256": digest.hexdigest()}
        completed = {}
        cursor = db.execute("SELECT * FROM sf_analysis_jobs WHERE status='COMPLETE' ORDER BY id")
        names = [x[0] for x in cursor.description]
        for row in cursor:
            value = dict(zip(names, row))
            completed[value["id"]] = {"kind": value["kind"], "sha256": sha(canonical(value))}
        return {"workspace_id": workspace, "tables": protected, "completed_jobs": completed}


def verify_basis(directory, baseline):
    current = native_basis(directory)
    need(current["workspace_id"] == baseline["workspace_id"], "Original Analysis workspace changed")
    for name, record in baseline["tables"].items():
        need(current["tables"].get(name) == record, "Original native data or saved history changed: " + name)
    for identifier, record in baseline["completed_jobs"].items():
        need(current["completed_jobs"].get(identifier) == record, "Original completed job changed: " + identifier)
    return {"workspace_id": current["workspace_id"], "unchanged_tables": len(baseline["tables"]),
            "unchanged_completed_jobs": len(baseline["completed_jobs"]),
            "additional_completed_jobs": sorted(set(current["completed_jobs"]) - set(baseline["completed_jobs"]))}


def verify_payloads(directory, records):
    for item in records:
        need(file_record(Path(directory) / item["path"]) == {k: item[k] for k in ("bytes", "sha256")},
             "Original retained source/output changed: " + item["path"])
    return {"files": len(records), "bytes": sum(x["bytes"] for x in records)}



def verify_artifacts(value, root):
    count = 0
    if isinstance(value, dict):
        if isinstance(value.get("path"), str) and type(value.get("bytes")) is int and HASH.fullmatch(str(value.get("sha256", ""))):
            path = Path(value["path"])
            if path.is_absolute() and (path == root or root in path.parents):
                need(file_record(path) == {key: value[key] for key in ("bytes", "sha256")},
                     "Retained receiving artifact changed: " + path.name)
                count += 1
        for item in value.values():
            count += verify_artifacts(item, root)
    elif isinstance(value, list):
        for item in value:
            count += verify_artifacts(item, root)
    return count


def copy_download(stream, destination, expected):
    destination = Path(destination)
    required = {key: expected[key] for key in ("bytes", "sha256")}
    if destination.exists():
        need(file_record(destination) == required, "Original download destination changed")
        return {"path": str(destination), **required}
    pending = destination.with_name(destination.name + ".pending")
    pending.unlink(missing_ok=True)
    fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    count, digest = 0, hashlib.sha256()
    with os.fdopen(fd, "wb") as out:
        while block := stream.read(1024 * 1024):
            count += len(block)
            need(count <= required["bytes"], "Native download exceeds its retained length")
            digest.update(block)
            out.write(block)
        out.flush()
        os.fsync(out.fileno())
    need(count == required["bytes"] and digest.hexdigest() == required["sha256"],
         "Native download bytes changed")
    os.replace(pending, destination)
    sync_parent(destination)
    return {"path": str(destination), **required}


def wait_job(workspace, request, *, timeout=600):
    try:
        job = workspace.job(request["id"])
    except Exception as error:
        if getattr(error, "code", "") != "ANALYSIS_JOB_NOT_FOUND":
            raise
        job = workspace.start("workspace-export", request)
    need(job["kind"] == "workspace-export" and job["request"] == request, "Original archive job request changed")
    if job["status"] == "INTERRUPTED":
        job = workspace.start("workspace-export", request)
    deadline = time.monotonic() + timeout
    while job["status"] == "RUNNING":
        need(time.monotonic() < deadline, "Original archive is still running; continue the same operation")
        time.sleep(0.15)
        job = workspace.job(request["id"])
    need(job["status"] == "COMPLETE", "Original archive requires attention: " + str(job.get("error")))
    return job


def browser_phase(root, config, phase, operation, owner_fd):
    """The child inherits our flock, so a surviving original browser blocks duplicate receiving."""
    path = root / ("browser-" + phase + "-configuration.json")
    save(path, config, immutable=True)
    log = root / ("browser-" + phase + ".log")
    with open(log, "ab", buffering=0) as output:
        child = subprocess.Popen([config["node"], str(HERE / "analysis_publication_browser.mjs"),
                                  "--configuration", str(path), "--phase", phase],
                                 cwd=config["checkout"], env={**os.environ, "PYTHONPATH": str(PYTHON_ROOT),
                                 "PYTHONDONTWRITEBYTECODE": "1",
                                 "ANALYSIS_DATASET_OWNER_FD": str(owner_fd)},
                                 stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
                                 pass_fds=(owner_fd,))
        try:
            operation.setdefault("browser_processes", []).append({"phase": phase, "pid": child.pid, "started_at": now()})
            save(root / "operation.json", operation)
            code = child.wait()
        except BaseException:
            if child.poll() is None:
                child.send_signal(2)
                try:
                    child.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
            raise
    need(code == 0, "Original " + phase + " browser continuation needs attention; read " + log.name)
    result_path = root / ("browser-" + phase + "-result.json")
    result = read_json(result_path)
    need(result.get("schema") == SCHEMA and result.get("phase") == phase and
         result.get("operation_id") == config["operation_id"] and
         result.get("workspace_id") == config["workspace_id"],
         "Original browser receiving result changed")
    need(result.get("configuration_sha256") == file_record(path)["sha256"], "Original browser configuration changed")
    verify_artifacts(result, root)
    return {"path": str(result_path), **file_record(result_path), "result": result}



def publication_delivery(workspace, package_id, source_job_id, output):
    from stellar_forge_buyer.analysis_publication_delivery import download_publication, DatasetPublication
    result = {}
    for key, identifier, source in (("package", package_id, False), ("source", source_job_id, True)):
        owner = workspace.publications.sources if source else workspace.publications
        index = owner.downloads(identifier)
        received = download_publication(workspace, identifier, output / ("python-" + key),
                                        source=source, expected_index_sha256=index["index_sha256"])
        local = DatasetPublication(received["directory"], expected_index_sha256=index["index_sha256"])
        selected = local.inspect()
        need(selected["receipt"]["workspace_id"] == workspace.identity and
             selected["receipt"]["job_id"] == identifier, "Original Python delivery identity changed")
        result[key] = {"receipt": received, "verified": selected}
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--analysis-backup", required=True, type=Path)
    parser.add_argument("--backup-sha256", required=True)
    parser.add_argument("--query-export", required=True)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--checkout", required=True, type=Path)
    parser.add_argument("--node", required=True)
    parser.add_argument("--playwright", required=True, type=Path)
    parser.add_argument("--chromium", required=True, type=Path)
    parser.add_argument("--temporary-root", default="/dev" if sys.platform.startswith("linux") else None)
    parser.add_argument("--operation-id", default="SCF-ANALYSIS-DATASET-PUBLICATION-B9D2-20261012")
    args = parser.parse_args(argv)
    need(ID.fullmatch(args.query_export) and HASH.fullmatch(args.backup_sha256) and
         HASH.fullmatch(args.manifest_sha256), "Use complete original export and archive identities")
    need(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}", args.operation_id),
         "Original operation identity is invalid")
    os.umask(0o077)
    root = private(args.directory)
    checkout = args.checkout.expanduser().resolve()
    need((checkout / (PREFIX + "stellar_forge_buyer/analysis_publication.py")).resolve() ==
         (PYTHON_ROOT / "stellar_forge_buyer/analysis_publication.py").resolve(),
         "Invoke the programme from its exact selected full native source")
    node = shutil.which(args.node)
    need(node is not None, "An existing Node runtime is required")
    source_files = [{"path": path, **file_record(checkout / path)} for path in SOURCE_FILES]
    native_runtime = {
        "node": {"path": str(Path(node).resolve()), **file_record(Path(node).resolve())},
        "python": {"path": str(Path(sys.executable).resolve()), **file_record(Path(sys.executable).resolve())},
        "playwright": {"path": str(args.playwright.resolve()), **file_record(args.playwright.resolve())},
        "chromium": {"path": str(args.chromium.resolve()), **file_record(args.chromium.resolve())},
    }
    request = {"operation_id": args.operation_id, "directory": str(root), "checkout": str(checkout),
               "analysis_backup": str(args.analysis_backup.expanduser().absolute()),
               "backup_sha256": args.backup_sha256, "query_export_id": args.query_export,
               "manifest_sha256": args.manifest_sha256, "source_files": source_files,
               "runtime": native_runtime,
               "temporary_root": str(Path(args.temporary_root).resolve()) if args.temporary_root else None}
    control_path = root / ".native-receiving.lock"
    fd = os.open(control_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "r+b") as owner:
        fcntl.flock(owner.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        operation_path = root / "operation.json"
        if operation_path.exists():
            operation = read_json(operation_path)
            need(operation.get("schema") == SCHEMA and operation.get("request") == request,
                 "Original receiving source/input/runtime selection changed")
        else:
            need(set(x.name for x in root.iterdir()) == {control_path.name},
                 "Select an empty directory or this exact original receiving operation")
            operation = {"schema": SCHEMA, "operation_id": args.operation_id, "request": request,
                         "created_at": now(), "steps": {}, "ids": {
                             "initial_restore": uuid.uuid4().hex, "archive": uuid.uuid4().hex,
                             "cold_restore": uuid.uuid4().hex}}
            save(operation_path, operation, immutable=True)
        sys.path.insert(0, str(PYTHON_ROOT))
        from stellar_forge_buyer.workspace_archive import inspect_archive
        from stellar_forge_buyer.workspace_archive_receive import restore_archive
        from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace
        from stellar_forge_buyer.analysis_publication_delivery import DatasetPublication

        try:
            original = inspect_archive(args.analysis_backup, expected_sha256=args.backup_sha256)
            native_manifest = original["manifest"]
            workspace_id = native_manifest["workspace_id"]
            analysis = root / "analysis"
            receipt = restore_archive(args.analysis_backup, analysis, operation=operation["ids"]["initial_restore"],
                                      expected_sha256=args.backup_sha256)
            need(receipt["workspace_id"] == workspace_id and receipt["state"] == "complete",
                 "Original Analysis backup did not restore completely")
            payloads = [item for item in native_manifest["files"] if item["path"] != "datasets.sqlite3"]
            baseline_path = root / "native-baseline.json"
            if baseline_path.exists():
                baseline = read_json(baseline_path)
            else:
                baseline = native_basis(analysis)
                need(baseline["completed_jobs"].get(args.query_export, {}).get("kind") == "query-export",
                     "Select the original completed typed query export")
                save(baseline_path, baseline, immutable=True)
            verify_basis(analysis, baseline)
            verify_payloads(analysis, payloads)
            operation["steps"]["input"] = {"workspace_id": workspace_id, "archive": original["archive"],
                "manifest_sha256": original["manifest_sha256"], "baseline": file_record(baseline_path),
                "restore_operation_id": operation["ids"]["initial_restore"],
                "query_export_id": args.query_export, "query_manifest_sha256": args.manifest_sha256}
            save(operation_path, operation)
            if (root / "result.json").exists():
                complete = read_json(root / "result.json")
                need(complete.get("schema") == SCHEMA and complete.get("status") == "COMPLETE" and
                     complete.get("operation_id") == args.operation_id and complete.get("workspace_id") == workspace_id and
                     complete.get("source_files") == source_files and
                     complete.get("original_backup_sha256") == args.backup_sha256 and
                     complete.get("query_export_id") == args.query_export and
                     complete.get("query_manifest_sha256") == args.manifest_sha256,
                     "Original complete receiving result changed")
                verify_artifacts(complete, root)
                for phase in ("prepare", "publish", "restore"):
                    saved = read_json(root / ("browser-" + phase + "-result.json"))
                    need(saved["configuration_sha256"] == file_record(
                         root / ("browser-" + phase + "-configuration.json"))["sha256"],
                         "Original completed browser configuration changed")
                    verify_artifacts(saved, root)
                for key in ("package", "source"):
                    saved = complete["steps"]["python_delivery"][key]["receipt"]
                    DatasetPublication(saved["directory"], expected_index_sha256=saved["index_sha256"]).inspect()
                verify_basis(root / "restored-analysis", baseline)
                verify_payloads(root / "restored-analysis", payloads)
                operation["completed_at"] = complete["completed_at"]
                operation.pop("interruption", None); save(operation_path, operation)
                print(json.dumps({"status": "COMPLETE", "reused": True, "operation_id": args.operation_id,
                                  "result": str(root / "result.json"), **file_record(root / "result.json")}), flush=True)
                return 0

            workspace = AnalysisWorkspace(analysis, checkout=checkout, node=node)
            try:
                reviewed = workspace.publications.review(args.query_export,
                    manifest_sha256=args.manifest_sha256, sample_rows=0)
                need(reviewed["source"]["row_count"] == 3 and
                     reviewed["source"]["columns"] == ["event_index", "domain", "title", "bot"],
                     "This receiving programme selects the original three-row document event export")
            finally:
                workspace.close()
            operation["steps"]["reviewed_export"] = reviewed["source"]
            save(operation_path, operation)
            config = {"schema": SCHEMA, "operation_id": args.operation_id, "workspace_id": workspace_id,
                      "directory": str(root), "analysis_directory": str(analysis), "checkout": str(checkout),
                      "node": node, "python": sys.executable, "playwright": str(args.playwright.resolve()),
                      "chromium": str(args.chromium.resolve()), "temporary_root": request["temporary_root"],
                      "query_export_id": args.query_export, "export_manifest_sha256": args.manifest_sha256,
                      "expected_rows": reviewed["source"]["row_count"]}
            prepared = browser_phase(root, config, "prepare", operation, owner.fileno())
            operation["steps"]["prepare_browser"] = {key: prepared[key] for key in ("path", "bytes", "sha256")}
            save(operation_path, operation)
            prepared_result = prepared["result"]
            package_id, index_sha = prepared_result["package_id"], prepared_result["package_index_sha256"]
            package_request = prepared_result["requests"]["package"]["body"]
            workspace = AnalysisWorkspace(analysis, checkout=checkout, node=node)
            try:
                package, index, manifest, conflicts = workspace.publications.sources._package(package_id, index_sha)
                need(not conflicts and index["source"]["manifest_sha256"] == args.manifest_sha256 and
                     index["source"]["query_export_id"] == args.query_export and
                     manifest["package"]["row_count"] == reviewed["source"]["row_count"], "Original complete package changed")
                need(workspace._job(package_id)["request"] == package_request, "Original package request changed")
            finally:
                workspace.close()
            merchant_package = {**package, "workspace_id": workspace_id}
            publish_config = {**config, "package_id": package_id, "package_index_sha256": index_sha,
                              "package_request": package_request, "merchant_package": merchant_package,
                              "browser_journal": prepared_result["browser_journal"]}
            published = browser_phase(root, publish_config, "publish", operation, owner.fileno())
            operation["steps"]["publish_browser"] = {key: published[key] for key in ("path", "bytes", "sha256")}
            save(operation_path, operation)
            browser = published["result"]
            source_job_id = browser["steps"]["source"]["download_job_id"]
            source_index_sha = browser["steps"]["source"]["index_sha256"]
            original_publication = browser["steps"]["source"]["publication"]
            need(browser["files"]["publication.zip"]["sha256"] ==
                 prepared_result["files"]["publication.zip"]["sha256"], "Original package ZIP changed")
            operation["steps"]["native_preservation"] = verify_basis(analysis, baseline)
            operation["steps"]["original_payloads"] = verify_payloads(analysis, payloads)
            output = private(root / "output")
            workspace = AnalysisWorkspace(analysis, checkout=checkout, node=node)
            try:
                job = workspace._job(source_job_id)
                need(job["status"] == "COMPLETE" and job["result"]["source_files"]["index_sha256"] == source_index_sha,
                     "Original native source export receipt changed")
                operation["steps"]["python_delivery"] = publication_delivery(workspace, package_id, source_job_id, output)
                save(operation_path, operation)
                archive_request = {"id": operation["ids"]["archive"], "include_previous_backups": False}
                archive_job = wait_job(workspace, archive_request)
                with workspace.archives.download(archive_request["id"], "workspace.zip") as (stream, record):
                    archived = copy_download(stream, output / "analysis-workspace.zip", record)
                with workspace.archives.download(archive_request["id"], "archive-manifest.json") as (stream, record):
                    archived_manifest = copy_download(stream, output / "analysis-archive-manifest.json", record)
            finally:
                workspace.close()
            operation["steps"]["complete_backup"] = {"job_id": archive_job["id"], "archive": archived,
                                                      "manifest": archived_manifest}
            save(operation_path, operation)
            restored = root / "restored-analysis"
            cold = restore_archive(archived["path"], restored, operation=operation["ids"]["cold_restore"],
                                   expected_sha256=archived["sha256"])
            need(cold["workspace_id"] == workspace_id and cold["state"] == "complete",
                 "Complete Analysis publication workspace did not restore")
            need(restore_archive(archived["path"], restored, operation=operation["ids"]["cold_restore"],
                                 expected_sha256=archived["sha256"])["reused"] is True,
                 "Original cold receiving replay did not reuse its exact receipt")
            verify_basis(restored, baseline); verify_payloads(restored, payloads)
            offline_config = {**config, "analysis_directory": str(restored), "package_id": package_id,
                "package_index_sha256": index_sha, "package_request": package_request,
                "source_download_job_id": source_job_id, "source_index_sha256": source_index_sha,
                "source_download_request": browser["requests"]["download"]["body"],
                "browser_journal": browser["browser_journal"]}
            received = browser_phase(root, offline_config, "restore", operation, owner.fileno())
            operation["steps"]["restore_browser"] = {key: received[key] for key in ("path", "bytes", "sha256")}
            restored_browser = received["result"]
            for name, item in browser["files"].items():
                need(restored_browser["files"][name]["bytes"] == item["bytes"] and
                     restored_browser["files"][name]["sha256"] == item["sha256"],
                     "Restored browser package bytes changed")
            operation["steps"]["cold_restore"] = {"operation_id": operation["ids"]["cold_restore"], **cold,
                "native": verify_basis(restored, baseline), "original_payloads": verify_payloads(restored, payloads)}
            result = {"schema": SCHEMA, "operation_id": args.operation_id, "workspace_id": workspace_id,
                "status": "COMPLETE", "completed_at": operation.get("completed_at") or now(),
                "source_files": source_files, "original_backup_sha256": args.backup_sha256,
                "query_export_id": args.query_export, "query_manifest_sha256": args.manifest_sha256,
                "rows": reviewed["source"]["row_count"], "package_id": package_id,
                "package_index_sha256": index_sha, "source_job_id": source_job_id,
                "source_index_sha256": source_index_sha, "publication": original_publication,
                "steps": operation["steps"],
                "claim_scope": "Original saved typed export; actual Frictionless merchant/workbench/publisher, real browser and native MCP; complete package/source files, original Analysis workspace archive and cold restore. No original data query/import or paid acquisition rerun."}
            verify_artifacts(result, root)
            save(root / "result.json", result, immutable=True)
            operation["completed_at"] = result["completed_at"]; operation.pop("interruption", None)
            save(operation_path, operation)
            print(json.dumps({"status": "COMPLETE", "operation_id": args.operation_id,
                              "result": str(root / "result.json"), **file_record(root / "result.json")}), flush=True)
            return 0
        except BaseException as error:
            operation["interruption"] = {"at": now(), "type": type(error).__name__,
                                          "error": getattr(error, "code", str(error))}
            try:
                save(operation_path, operation)
            except BaseException:
                pass
            raise


if __name__ == "__main__":
    raise SystemExit(main())
