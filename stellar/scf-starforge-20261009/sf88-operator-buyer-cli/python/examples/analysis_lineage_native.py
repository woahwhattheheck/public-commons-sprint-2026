#!/usr/bin/env python3
"""Continue one original Analysis -> OpenLineage -> portable receiving workflow.

Requires a complete existing Analysis backup and an already-completed root job.
No import, query, acquisition, model or workbook is rerun by this programme.
The maintained resource owner must reconcile an interrupted process family
before invoking this same directory again.
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

SCHEMA = "stellar-forge.analysis-lineage-native-receiving.v1"
HERE = Path(__file__).resolve().parent
PYTHON_ROOT = HERE.parent
ID = re.compile(r"[a-f0-9]{32}")
HASH = re.compile(r"[a-f0-9]{64}")
SUPPORTED = {"import", "response-import", "query", "query-export", "workbook"}
PREFIX = "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/"
SOURCE_FILES = [
    PREFIX + "stellar_forge_buyer/analysis_lineage.py",
    PREFIX + "stellar_forge_buyer/analysis_lineage_projection.py",
    PREFIX + "stellar_forge_buyer/analysis_lineage_reports.py",
    PREFIX + "stellar_forge_buyer/lineage_http.py",
    PREFIX + "stellar_forge_buyer/_analysis_lineage_ui.py",
    PREFIX + "stellar_forge_buyer/analysis_workspace.py",
    PREFIX + "stellar_forge_buyer/runtime.py",
    PREFIX + "stellar_forge_buyer/workspace_archive.py",
    PREFIX + "stellar_forge_buyer/workspace_archive_receive.py",
    PREFIX + "analysis-lineage-bridge.mjs",
    PREFIX + "analysis-lineage-facet.schema.json",
    PREFIX + "examples/analysis_lineage_native.py",
    PREFIX + "examples/analysis_lineage_browser.mjs",
    PREFIX + "examples/analysis_lineage_collector.mjs",
    PREFIX + "examples/analysis_lineage_mcp.mjs",
    "stellar-forge/mcp-paid-agent/native-analysis.mjs",
    "stellar-forge/mcp-paid-agent/native-analysis-schema.mjs",
    "stellar-forge/mcp-paid-agent/native-analysis-lineage.mjs",
    "stellar-forge/mcp-paid-agent/native-analysis-lineage-schema.mjs",
    "stellar-forge/mcp-paid-agent/native-analysis-lineage-download.mjs",
    "stellar-forge/mcp-paid-agent/native-file.mjs",
    "stellar-forge/mcp-paid-agent/serve.mjs",
    "stellar-forge/mcp-merchant-operator/retained-download.mjs",
    "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs",
    *["stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/" + name
      for name in ("server.mjs", "producer.mjs", "client.mjs", "store.mjs", "model.mjs")],
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
            if name == "sf_analysis_jobs" or name.startswith("sf_analysis_lineage_") or name.endswith("_control"):
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
        child = subprocess.Popen([config["node"], str(HERE / "analysis_lineage_browser.mjs"),
                                  "--configuration", str(path), "--phase", phase],
                                 cwd=config["checkout"], env={**os.environ, "PYTHONPATH": str(PYTHON_ROOT),
                                 "PYTHONDONTWRITEBYTECODE": "1"},
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


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--analysis-backup", required=True, type=Path)
    parser.add_argument("--backup-sha256", required=True)
    parser.add_argument("--root-job", required=True)
    parser.add_argument("--checkout", required=True, type=Path, help="Actual full original repository-layout runtime")
    parser.add_argument("--node", required=True)
    parser.add_argument("--playwright", required=True, type=Path, help="Actual installed Playwright module entry")
    parser.add_argument("--chromium", required=True, type=Path, help="Actual compatible Chromium executable")
    parser.add_argument("--temporary-root", default="/dev" if sys.platform.startswith("linux") else None)
    parser.add_argument("--operation-id", default="SCF-ANALYSIS-LINEAGE-B9D2-20261012")
    args = parser.parse_args(argv)
    need(ID.fullmatch(args.root_job) and HASH.fullmatch(args.backup_sha256), "Use original full job and archive identities")
    need(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}", args.operation_id), "Operation identity is invalid")
    os.umask(0o077)
    root = private(args.directory)
    checkout = args.checkout.expanduser().resolve()
    need((checkout / (PREFIX + "stellar_forge_buyer/analysis_lineage.py")).resolve() ==
         (PYTHON_ROOT / "stellar_forge_buyer/analysis_lineage.py").resolve(),
         "Invoke the receiving programme from the same selected original runtime")
    node = shutil.which(args.node)
    need(node is not None, "An existing Node runtime is required")
    source_files = [{"path": path, **file_record(checkout / path)} for path in SOURCE_FILES]
    native_runtime = {"node": {"path": str(Path(node).resolve()), **file_record(Path(node).resolve())},
                      "python": {"path": str(Path(sys.executable).resolve()), **file_record(Path(sys.executable).resolve())},
                      "playwright": {"path": str(args.playwright.resolve()), **file_record(args.playwright.resolve())},
                      "chromium": {"path": str(args.chromium.resolve()), **file_record(args.chromium.resolve())}}
    request = {"operation_id": args.operation_id, "directory": str(root), "checkout": str(checkout),
               "analysis_backup": str(args.analysis_backup.expanduser().absolute()),
               "backup_sha256": args.backup_sha256, "root_job_id": args.root_job,
               "source_files": source_files, "runtime": native_runtime,
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
        from stellar_forge_buyer.analysis_lineage_reports import LineagePublication

        try:
            original = inspect_archive(args.analysis_backup, expected_sha256=args.backup_sha256)
            native_manifest = original["manifest"]
            workspace_id = native_manifest["workspace_id"]
            analysis = root / "analysis"
            receipt = restore_archive(args.analysis_backup, analysis, operation=operation["ids"]["initial_restore"],
                                      expected_sha256=args.backup_sha256)
            need(receipt["workspace_id"] == workspace_id and receipt["state"] == "complete",
                 "Original backup was not received completely")
            payloads = [item for item in native_manifest["files"] if item["path"] != "datasets.sqlite3"]
            baseline_path = root / "native-baseline.json"
            if baseline_path.exists():
                baseline = read_json(baseline_path)
            else:
                baseline = native_basis(analysis)
                need(args.root_job in baseline["completed_jobs"] and
                     baseline["completed_jobs"][args.root_job]["kind"] in SUPPORTED,
                     "Select one original completed supported Analysis operation")
                save(baseline_path, baseline, immutable=True)
            verify_basis(analysis, baseline)
            verify_payloads(analysis, payloads)
            operation["steps"]["input"] = {"workspace_id": workspace_id, "archive": original["archive"],
                                           "manifest_sha256": original["manifest_sha256"],
                                           "baseline": file_record(baseline_path),
                                           "restore_operation_id": operation["ids"]["initial_restore"],
                                           "original_root_job_id": args.root_job}
            save(operation_path, operation)
            if (root / "result.json").exists():
                complete = read_json(root / "result.json")
                need(complete.get("schema") == SCHEMA and complete.get("status") == "COMPLETE" and
                     complete.get("operation_id") == args.operation_id and complete.get("workspace_id") == workspace_id and
                     complete.get("source_files") == source_files and
                     complete.get("original_backup_sha256") == args.backup_sha256 and
                     complete.get("original_root_job_id") == args.root_job,
                     "Original completed receiving result changed")
                verify_artifacts(complete, root)
                for phase in ("publish", "restore"):
                    browser_result = read_json(root / ("browser-" + phase + "-result.json"))
                    need(browser_result.get("configuration_sha256") ==
                         file_record(root / ("browser-" + phase + "-configuration.json"))["sha256"],
                         "Original completed browser configuration changed")
                    verify_artifacts(browser_result, root)
                verify_basis(root / "restored-analysis", baseline)
                verify_payloads(root / "restored-analysis", payloads)
                operation["completed_at"] = complete["completed_at"]
                operation.pop("interruption", None)
                save(operation_path, operation)
                print(json.dumps({"status": "COMPLETE", "reused": True, "operation_id": args.operation_id,
                                  "result": str(root / "result.json"), **file_record(root / "result.json")}), flush=True)
                return 0
            config = {"schema": SCHEMA, "operation_id": args.operation_id,
                      "workspace_id": workspace_id, "directory": str(root), "analysis_directory": str(analysis),
                      "checkout": str(checkout), "node": node, "python": sys.executable,
                      "playwright": str(args.playwright.resolve()), "chromium": str(args.chromium.resolve()),
                      "temporary_root": request["temporary_root"], "root_job_id": args.root_job}
            published = browser_phase(root, config, "publish", operation, owner.fileno())
            operation["steps"]["publication_browser"] = {key: published[key] for key in ("path", "bytes", "sha256")}
            save(operation_path, operation)
            browser = published["result"]
            handover = browser["files"]["handover.zip"]
            need(Path(handover["path"]).parent == root / "output", "Original handover location changed")
            portable = LineagePublication(handover["path"], expected_sha256=handover["sha256"])
            review = portable.inspect()
            need(review["workspace_id"] == workspace_id and review["plan_id"] == browser["plan_id"] and
                 review["publication"]["status"] == "ACCEPTED", "Original publication is not accepted")
            need(portable.plan["request"]["job_id"] == args.root_job, "Original root job changed")
            operation["steps"]["native_preservation"] = verify_basis(analysis, baseline)
            operation["steps"]["original_payloads"] = verify_payloads(analysis, payloads)
            save(operation_path, operation)

            archive_request = {"id": operation["ids"]["archive"], "include_previous_backups": False}
            workspace = AnalysisWorkspace(analysis, checkout=checkout, node=node)
            try:
                selected = workspace.lineage.plan(browser["plan_id"])
                need(selected["plan_sha256"] == browser["plan_sha256"] and
                     selected["publication"]["status"] == "ACCEPTED", "Original saved publication changed")
                archive_job = wait_job(workspace, archive_request)
                output = private(root / "output")
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
                 "Original full workspace did not restore")
            need(restore_archive(archived["path"], restored, operation=operation["ids"]["cold_restore"],
                                 expected_sha256=archived["sha256"])["reused"] is True,
                 "Original receiving replay did not reuse its exact receipt")
            verify_basis(restored, baseline)
            verify_payloads(restored, payloads)
            offline_config = {**config, "analysis_directory": str(restored), "plan_id": browser["plan_id"],
                              "plan_sha256": browser["plan_sha256"],
                              "publication_job_id": browser["publication_job_id"],
                              "original_handover": handover}
            received = browser_phase(root, offline_config, "restore", operation, owner.fileno())
            operation["steps"]["restored_browser"] = {key: received[key] for key in ("path", "bytes", "sha256")}
            operation["steps"]["cold_restore"] = {"operation_id": operation["ids"]["cold_restore"], **cold,
                                                  "native": verify_basis(restored, baseline),
                                                  "original_payloads": verify_payloads(restored, payloads)}
            result = {"schema": SCHEMA, "operation_id": args.operation_id, "workspace_id": workspace_id,
                      "status": "COMPLETE", "completed_at": operation.get("completed_at") or now(),
                      "source_files": source_files, "original_backup_sha256": args.backup_sha256,
                      "original_root_job_id": args.root_job, "plan_id": browser["plan_id"],
                      "plan_sha256": browser["plan_sha256"], "publication_job_id": browser["publication_job_id"],
                      "event_source_sha256": review["events_sha256"], "publication": review["publication"],
                      "steps": operation["steps"],
                      "claim_scope": "Original local collector and HTTP, retained Analysis source, real browser, full native workspace export and cold restore; no acquisition or data job rerun."}
            save(root / "result.json", result, immutable=True)
            operation["completed_at"] = result["completed_at"]
            operation.pop("interruption", None)
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
