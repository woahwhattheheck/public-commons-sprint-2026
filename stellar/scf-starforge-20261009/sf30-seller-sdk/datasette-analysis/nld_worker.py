#!/usr/bin/env python3
"""One retained NLD execution, with native UID recovery and complete target review.

The parent invokes this file with shell=False. It never installs packages, fetches
a publisher, reads an external credential file or silently re-runs a dispatched
operation. Its local SQLite target is the explicitly selected reference target.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import csv
import fcntl
import hashlib
import importlib.metadata
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile

from nld_contract import (SCHEMA, RUN_SCHEMA, NLD_VERSION, NLD_COMMIT, META, need, now,
    identifier, encoded, identity, load, read, file_identity, publish, publish_json,
    private_directory, sync, verify_project, target_report, quote, check_file, closure, NldError)

SUCCESS = {"SUCCEEDED", "SUCCEEDED_WITH_WARNING"}

@contextmanager
def project_lock(root):
    root = private_directory(root)
    lock = root / ".operate.lock"
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise NldError("NLD_ORIGINAL_PROJECT_BUSY", "Continue the original active process.") from error
        yield
    finally:
        os.close(fd)

def runtime(manifest):
    need((3, 12) <= sys.version_info[:2] < (3, 14), "NLD_PYTHON_ABI_REQUIRED", "The pinned publisher requires Python 3.12 or 3.13.")
    need(importlib.metadata.version("nld-core") == NLD_VERSION, "NLD_SELECTED_RUNTIME_VERSION")
    spec = importlib.util.find_spec("nld")
    locations = list(spec.submodule_search_locations or []) if spec else []
    need(len(locations) == 1, "NLD_RUNTIME_PACKAGE_LOCATION")
    package = Path(locations[0]).resolve()
    checked = []
    for declared in manifest["upstream"]["required_sources"]:
        check_file(package, declared)
        checked.append(declared)
    packages = {}
    for key in ("nld-core", "pydantic", "sqlglot", "pyarrow", "pandas", "PyYAML", "click"):
        packages[key] = importlib.metadata.version(key)
    return {"schema": SCHEMA + "/runtime", "python": sys.version,
            "executable": sys.executable, "packages": packages,
            "selected_upstream_commit": NLD_COMMIT,
            "source_verification": "All declared integration modules match the selected original bytes.",
            "verified_sources": checked}

def normalize_request(request, project):
    need(isinstance(request, dict) and set(request).issubset(
        {"schema", "run_id", "project_id", "definition_id", "strategy", "keys", "limit", "operator", "note"}),
        "NLD_RUN_REQUEST_FIELDS")
    need(request.get("schema") == RUN_SCHEMA, "NLD_RUN_REQUEST_SCHEMA")
    identifier(request.get("run_id")); identifier(request.get("project_id"))
    identifier(request.get("definition_id"), full=True)
    need(request["project_id"] == project["project_id"] and request["definition_id"] == project["id"],
         "NLD_RUN_PROJECT_CHANGED")
    strategy = request.get("strategy")
    need(strategy in {"FULL", "DELTA", "BACKFILL", "BACKFILL_DELTA"}, "NLD_RUN_STRATEGY")
    keys, limit = request.get("keys"), request.get("limit")
    need(keys is None or isinstance(keys, list) and 0 < len(keys) <= 100000
         and all(isinstance(k, str) and len(k) == 64 and all(c in "0123456789abcdef" for c in k) for k in keys)
         and len(keys) == len(set(keys)), "NLD_RUN_KEYS")
    need(limit is None or type(limit) is int and 1 <= limit <= 1000000, "NLD_RUN_LIMIT")
    need(not (keys is not None and limit is not None), "NLD_SELECT_KEYS_OR_LIMIT",
         "Native keys override limit; choose exactly one selection to keep that intent explicit.")
    if strategy in {"FULL", "DELTA"}:
        need(keys is None and limit is None, "NLD_RUN_SELECTION_WITH_FULL_OR_DELTA")
    else:
        need(keys is not None or limit is not None, "NLD_BACKFILL_SELECTION_REQUIRED")
    for key in ("operator", "note"):
        need(isinstance(request.get(key), str) and request[key].strip() and len(request[key]) <= 4000,
             "NLD_RUN_OPERATOR_REVIEW_REQUIRED", key)
    return {**request, "keys": keys, "limit": limit}

def sqlite_rows(root, projection, flow_name):
    target = root / "target.sqlite"
    need(target.is_file() and not target.is_symlink(), "NLD_TARGET_REQUIRED")
    db = sqlite3.connect(target.as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    try:
        return [dict(row) for row in db.execute(
            "SELECT " + ",".join(quote(c) for c in projection["columns"]) +
            " FROM " + quote(flow_name) + " ORDER BY " + quote("_sf_business_key"))]
    finally:
        db.close()

def _table_shape(db, table, columns):
    existing = db.execute("SELECT type FROM sqlite_master WHERE name=?", (table,)).fetchone()
    if existing is None:
        sql = "CREATE TABLE " + quote(table) + " (" + ",".join(
            quote(c) + " TEXT" + (" PRIMARY KEY NOT NULL" if c == "_sf_business_key" else "")
            for c in columns) + ")"
        db.execute(sql)
    actual = db.execute("PRAGMA table_info(" + quote(table) + ")").fetchall()
    need([r[1] for r in actual] == columns and all(r[2].upper() == "TEXT" for r in actual)
         and [r[1] for r in actual if r[5]] == ["_sf_business_key"], "NLD_LOCAL_TARGET_SCHEMA_CHANGED", table)

def stage_input(root, manifest, projection):
    """Provision only the owned local reference tables; NLD writes the target rows."""
    need(isinstance(manifest.get("flow_name"), str)
         and manifest["flow_name"].casefold() != "retained_input", "NLD_TARGET_RESERVED")
    target = root / "target.sqlite"
    need(not target.is_symlink(), "NLD_TARGET_SYMLINK")
    db = sqlite3.connect(target)
    try:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE")
        _table_shape(db, manifest["flow_name"], projection["columns"])
        _table_shape(db, "retained_input", projection["columns"])
        db.execute('DELETE FROM "retained_input"')
        columns = projection["columns"]
        db.executemany("INSERT INTO retained_input (" + ",".join(quote(c) for c in columns) +
                       ") VALUES (" + ",".join("?" for _ in columns) + ")",
                       ([row[c] for c in columns] for row in projection["rows"]))
        actual = db.execute("SELECT count(*) FROM retained_input").fetchone()[0]
        need(actual == len(projection["rows"]), "NLD_STAGING_ROW_COUNT")
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()
    os.chmod(target, 0o600)
    return file_identity(target)

def _settings(root, directory):
    config = private_directory(directory / "runtime-config")
    # These are generated local bindings, not externally supplied secrets.
    # Fresh restored paths are written only into this run's private directory.
    body = ('[sf_target]\ntype = "sqlite"\ndatabase_name = ' + json.dumps(str(root / "target.sqlite")) +
            '\nschema_name = "main"\n\n[sf_state]\ntype = "local"\nbase_path = ' +
            json.dumps(str(root)) + '\n').encode()
    publish(config / "secrets.toml", body)
    return config

def _native_task(root, definition, manifest, projection, request, directory):
    from nld.task.context import NldExecutionContext
    from nld.task.context.request import TaskRequest
    from nld.service import EntityTypeNames
    from nld.flow.incremental.models import PlannedStatePolicy
    from nld.flow.task.data_flow_executor import DataFlowExecutor
    params = {"root_folder_path": str(definition), "config_folder_path": str(_settings(root, directory)),
              "full": request["strategy"] == "FULL", "with_delta": request["strategy"] == "BACKFILL_DELTA"}
    if request["keys"] is not None:
        params["keys"] = request["keys"]
    if request["limit"] is not None:
        params["limit"] = request["limit"]
    os.chdir(definition)
    if str(definition) not in sys.path:
        sys.path.insert(0, str(definition))
    context = NldExecutionContext(TaskRequest(execution_name="sf-datasette-" + request["run_id"], params=params),
                                  with_project=True)
    context.set_current()
    context.load_entities(entity_types=[EntityTypeNames.DATA_FLOW_DEFINITION], namespace=manifest["namespace"])
    namespaced = context.entity_registry.get_data_flow_definition(
        entity_key=manifest["flow_name"], namespace=manifest["namespace"])
    executor = DataFlowExecutor(namespaced, params=params, planned_state_policy=PlannedStatePolicy.RECOMPUTE)
    task = executor.init_data_flow_task(connections_should_be_opened=False, extra_init_params={
        "task_uuid": request["run_id"], "retained_receipt_directory": str(directory)})
    credentials = task.target_connector.connection_wrapper.credentials
    need(credentials.type == "sqlite" and Path(credentials.database_name).resolve() == root / "target.sqlite",
         "NLD_REFERENCE_TARGET_CONNECTION_CHANGED")
    local = context.get_data_connector("sf_state", open_connection=False)
    need(local.connection_wrapper.credentials.type == "local"
         and Path(local.connection_wrapper.credentials.base_path).resolve() == root,
         "NLD_REFERENCE_STATE_CONNECTION_CHANGED")
    need(task.flow_execution_info.flow_uid == request["run_id"], "NLD_NATIVE_UID_CHANGED")
    task.target_connector.open_connection()
    local.open_connection()
    return context, executor, task

def _close_context(context):
    if context:
        for name in context.get_available_data_connector_names():
            connector = context.get_data_connector(name, open_connection=False)
            if connector.connection_is_opened():
                connector.close_connection()
        context.clear_current()

def recover_native(root, directory, manifest, request):
    """Read the exact original state files, including the actual current info.

    The local publisher backend's combined reader can return no history when the
    global state file is absent after BACKFILL. Inspect its retained complete
    per-execution body as well; no state is written or substituted here.
    """
    if (directory / "native-error.json").exists():
        return None
    candidates, identities = [], []
    state_root = root / "native-state"
    if not state_root.exists():
        return None
    for path in sorted(state_root.rglob("*.json")):
        item = file_identity(path, relative_to=root)
        # The state can grow; reading any unsupported large file is explicit.
        value = load(path)
        possible = []
        if isinstance(value, dict):
            possible.append(value)
            if isinstance(value.get("last_processed"), dict):
                possible.append(value["last_processed"])
            if isinstance(value.get("executions"), list):
                possible.extend(value["executions"])
        for body in possible:
            if isinstance(body, dict) and body.get("flow_uid") == request["run_id"]:
                need(body.get("flow_name") == manifest["flow_name"]
                     and body.get("flow_namespace") == manifest["namespace"], "NLD_NATIVE_UID_COLLISION")
                if body.get("execution_status") in (SUCCESS | {"FAILED"}) and body.get("ended_at"):
                    candidates.append(body)
                    identities.append(item)
    need(not candidates or all(body == candidates[0] for body in candidates), "NLD_NATIVE_RECOVERY_CONFLICT")
    if not candidates:
        return None
    return {"schema": SCHEMA + "/native-return", "request_sha256": identity(request),
            "projection_id": manifest["projection_id"], "flow": candidates[0],
            "returned_at": None, "recovered_at": now(),
            "recovery": {"basis": "exact native UID terminal body", "original_state_files": identities},
            "lifecycle_error": None}

def snapshot_target(root, directory):
    destination = directory / "target.sqlite"
    if destination.exists():
        return file_identity(destination)
    fd, pending = tempfile.mkstemp(prefix=".sqlite-backup-", dir=directory)
    os.close(fd)
    try:
        source = sqlite3.connect((root / "target.sqlite").as_uri() + "?mode=ro", uri=True)
        target = sqlite3.connect(pending)
        try:
            source.backup(target)
            integrity = target.execute("PRAGMA integrity_check").fetchall()
            need(integrity == [("ok",)], "NLD_TARGET_BACKUP_INTEGRITY")
        finally:
            source.close(); target.close()
        with open(pending, "rb") as source:
            os.fsync(source.fileno())
        os.link(pending, destination)
        sync(directory)
        Path(pending).unlink()
        return file_identity(destination)
    except BaseException:
        # Keep the original prefix; never replace a partial with another silent run.
        raise

def retain_failure(root, manifest, projection, request, directory, flow):
    """Freeze the actual failed target before another reviewed native UID may write."""
    receipt_path = directory / "failed-receipt.json"
    if receipt_path.exists():
        receipt = load(receipt_path)
        need(receipt["request_sha256"] == identity(request) and receipt["native_uid"] == request["run_id"],
             "NLD_FAILED_RECEIPT_CHANGED")
        for member in receipt["files"]:
            check_file(directory, member)
        return receipt
    need(flow.get("flow_uid") == request["run_id"] and flow.get("execution_status") == "FAILED"
         and flow.get("ended_at"), "NLD_FAILURE_NOT_TERMINAL",
         "The native result is uncertain; preserve the same UID without dispatching another flow.")
    selection_file = directory / "native-selection.json"
    selection = load(selection_file) if selection_file.exists() else None
    if selection is not None:
        need(selection["flow_uid"] == request["run_id"] and selection["projection_id"] == projection["id"],
             "NLD_FAILED_SELECTION_CHANGED")
    actual = sqlite_rows(root, projection, manifest["flow_name"])
    keys = set(selection["selected_keys"]) if selection is not None else set()
    review = target_report(projection, actual, keys)
    if selection is None:
        review["selected_processing_keys"] = None
        for row in review["outcomes"]:
            row["selected_in_run"] = None
    review["native_outcome"] = "FAILED"
    review["selection_evidence"] = "retained-native-selection" if selection is not None else "unavailable"
    publish_json(directory / "failed-target-review.json", review)
    publish_json(directory / "failed-target-rows.json", {"columns": projection["columns"], "rows": actual})
    backup = snapshot_target(root, directory)
    connection = sqlite3.connect((directory / "target.sqlite").as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        saved = [dict(r) for r in connection.execute("SELECT " + ",".join(quote(c) for c in projection["columns"]) +
                 " FROM " + quote(manifest["flow_name"]) + " ORDER BY " + quote("_sf_business_key"))]
        need(saved == actual, "NLD_FAILED_TARGET_BACKUP_CHANGED")
    finally:
        connection.close()
    state_root = root / "native-state"
    if state_root.exists():
        for item in closure(state_root):
            publish(directory / "native-state" / item["path"],
                    read(state_root / item["path"], maximum=64 * 1024 * 1024))
    files = closure(directory, exclude=("runtime-config",))
    receipt = {"schema": RUN_SCHEMA + "/failed", "status": "FAILED",
               "request_sha256": identity(request), "run_id": request["run_id"],
               "native_uid": request["run_id"], "definition_id": manifest["id"],
               "projection_id": projection["id"], "flow": flow,
               "target_snapshot": backup, "files": files, "retained_at": now(),
               "retry": "No automatic replay. A new operator-reviewed UID may run only after this complete failed target is retained."}
    publish_json(receipt_path, receipt)
    return receipt

def finalize(root, definition, manifest, projection, request, directory, native):
    need(native["request_sha256"] == identity(request) and native["projection_id"] == projection["id"],
         "NLD_NATIVE_RETURN_INPUT_CHANGED")
    flow = native["flow"]
    need(flow.get("flow_uid") == request["run_id"] and flow.get("execution_status") in SUCCESS
         and flow.get("ended_at") and not native.get("lifecycle_error"), "NLD_NATIVE_NOT_SUCCEEDED")
    selection = load(directory / "native-selection.json")
    need(selection["flow_uid"] == request["run_id"] and selection["projection_id"] == projection["id"],
         "NLD_NATIVE_SELECTION_CHANGED")
    actual = sqlite_rows(root, projection, manifest["flow_name"])
    report = target_report(projection, actual, set(selection["selected_keys"]))
    selected_outcomes = [row for row in report["outcomes"] if row["selected_in_run"]]
    need(len(selected_outcomes) == len(selection["selected_keys"])
         and all(row["state"] == "matches" for row in selected_outcomes), "NLD_SELECTED_RESULT_CHANGED")
    publish_json(directory / "target-review.json", report)
    publish_json(directory / "target-rows.json", {"columns": projection["columns"], "rows": actual})
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(projection["columns"])
    for row in actual:
        writer.writerow([row.get(c) if row.get(c) is not None else "" for c in projection["columns"]])
    publish(directory / "target-rows.csv", output.getvalue().encode())
    # JSON and _sf_presence/_sf_types remain the null/type authority; CSV blanks
    # are a conventional presentation, not a replacement original source.
    backup = snapshot_target(root, directory)
    snap = sqlite3.connect((directory / "target.sqlite").as_uri() + "?mode=ro", uri=True)
    snap.row_factory = sqlite3.Row
    try:
        need([tuple(r) for r in snap.execute("PRAGMA integrity_check")] == [("ok",)], "NLD_TARGET_BACKUP_INTEGRITY")
        columns_sql = ",".join(quote(c) for c in projection["columns"])
        snapshot_rows = [dict(r) for r in snap.execute("SELECT " + columns_sql + " FROM " +
                         quote(manifest["flow_name"]) + " ORDER BY " + quote("_sf_business_key"))]
        need(snapshot_rows == actual, "NLD_TARGET_BACKUP_ROWS_CHANGED")
        staged = [dict(r) for r in snap.execute("SELECT " + columns_sql +
                  " FROM retained_input ORDER BY " + quote("_sf_business_key"))]
        need(staged == sorted(projection["rows"], key=lambda r: r["_sf_business_key"]),
             "NLD_TARGET_BACKUP_SOURCE_CHANGED")
    finally:
        snap.close()
    state_files = []
    state_root = root / "native-state"
    if state_root.exists():
        for item in closure(state_root):
            path = state_root / item["path"]
            destination = directory / "native-state" / item["path"]
            publish(destination, read(path, maximum=64 * 1024 * 1024))
            state_files.append(file_identity(destination, relative_to=directory))
    files = closure(directory, exclude=("runtime-config",))
    completed = {"schema": RUN_SCHEMA + "/completed", "run_id": request["run_id"],
                 "project_id": request["project_id"], "definition_id": manifest["id"],
                 "projection_id": projection["id"], "request_sha256": identity(request),
                 "native_uid": flow["flow_uid"], "native_status": flow["execution_status"],
                 "coverage": {k: report[k] for k in ("source_rows", "target_rows", "selected_processing_keys",
                              "matching_rows", "missing_rows", "different_rows", "retained_outside_selection",
                              "coverage_denominator", "coverage")},
                 "target_snapshot": backup, "files": files, "completed_at": now()}
    publish_json(directory / "completed.json", completed)
    return completed

def run(root, definition_id, raw_request, *, resume=False):
    root = Path(root).expanduser().absolute()
    identifier(definition_id, full=True)
    definition = root / "definitions" / definition_id
    with project_lock(root):
        manifest, projection = verify_project(definition)
        need(manifest["id"] == definition_id, "NLD_DEFINITION_DIRECTORY_CHANGED")
        request = normalize_request(raw_request, manifest)
        if request["keys"] is not None:
            need(set(request["keys"]).issubset({r["_sf_source_key"] for r in projection["rows"]}),
                 "NLD_KEYS_OUTSIDE_CURRENT_SOURCE")
        directory = private_directory(root / "runs" / request["run_id"])
        intent_path = directory / "intent.json"
        fresh = not intent_path.exists()
        publish_json(intent_path, request)
        if (directory / "completed.json").exists():
            completed = load(directory / "completed.json")
            need(completed["request_sha256"] == identity(request), "NLD_COMPLETED_REQUEST_CHANGED")
            for member in completed["files"]:
                check_file(directory, member)
            return {**completed, "reused": True}
        dispatched = (directory / "dispatch.json").exists()
        native = load(directory / "native-return.json") if (directory / "native-return.json").exists() else None
        if native is not None:
            if native["flow"].get("execution_status") == "FAILED":
                retain_failure(root, manifest, projection, request, directory, native["flow"])
                raise NldError("NLD_NATIVE_FAILED", "The original failed target and full native evidence are retained.")
            return finalize(root, definition, manifest, projection, request, directory, native)
        if dispatched:
            need(resume, "NLD_DISPATCH_UNCERTAIN", "Resume the exact native UID; do not submit it again.")
            if (directory / "native-error.json").exists():
                error = load(directory / "native-error.json")
                retain_failure(root, manifest, projection, request, directory, error["flow"])
                raise NldError("NLD_NATIVE_FAILED", "The exact failed target is retained; the original UID was not dispatched again.")
            native = recover_native(root, directory, manifest, request)
            need(native is not None, "NLD_DISPATCH_UNCERTAIN",
                 "No unambiguous terminal original UID is retained. Preserve all files and reconcile the original native operation.")
            publish_json(directory / "native-return.json", native)
            if native["flow"].get("execution_status") == "FAILED":
                retain_failure(root, manifest, projection, request, directory, native["flow"])
                raise NldError("NLD_NATIVE_FAILED", "The recovered failed native UID and actual target are retained.")
            return finalize(root, definition, manifest, projection, request, directory, native)
        for other in (root / "runs").iterdir():
            if other == directory or not other.is_dir() or not (other / "dispatch.json").exists() or (other / "completed.json").exists():
                continue
            failed = load(other / "failed-receipt.json") if (other / "failed-receipt.json").exists() else None
            need(failed is not None and failed.get("native_uid") == other.name
                 and failed.get("flow", {}).get("execution_status") == "FAILED"
                 and failed.get("flow", {}).get("ended_at"),
                 "NLD_PRIOR_NATIVE_OPERATION_UNRESOLVED", other.name)
            for member in failed["files"]:
                check_file(other, member)
        runtime_record = runtime(manifest)
        publish_json(directory / "runtime.json", runtime_record)
        context = None
        try:
            stage_input(root, manifest, projection)
            context, executor, task = _native_task(root, definition, manifest, projection, request, directory)
            publish_json(directory / "dispatch.json", {"schema": RUN_SCHEMA + "/dispatch",
                "request_sha256": identity(request), "run_id": request["run_id"], "at": now(),
                "native_uid": task.flow_execution_info.flow_uid, "project_definition": manifest["id"]})
            try:
                flow = executor.execute_data_flow_task(task)
            except BaseException as error:
                failure = {"schema": SCHEMA + "/native-error", "request_sha256": identity(request),
                           "flow": task.flow_execution_info.model_dump(mode="json"),
                           "exception": {"type": type(error).__name__, "message": str(error)}, "at": now()}
                publish_json(directory / "native-error.json", failure)
                retain_failure(root, manifest, projection, request, directory, failure["flow"])
                raise
            native = {"schema": SCHEMA + "/native-return", "request_sha256": identity(request),
                      "projection_id": projection["id"], "flow": flow.model_dump(mode="json"),
                      "returned_at": now(), "recovery": None, "lifecycle_error": None}
            publish_json(directory / "native-return.json", native)
        finally:
            _close_context(context)
        if native["flow"].get("execution_status") == "FAILED":
            retain_failure(root, manifest, projection, request, directory, native["flow"])
            raise NldError("NLD_NATIVE_FAILED", "The original failed target and full native return are retained.")
        return finalize(root, definition, manifest, projection, request, directory, native)

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--definition", required=True)
    parser.add_argument("--request", required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    try:
        value = run(args.project, args.definition, load(args.request), resume=args.resume)
        print(json.dumps(value, ensure_ascii=False), flush=True)
        return 0
    except BaseException as error:
        print(json.dumps({"schema": SCHEMA, "error": getattr(error, "code", type(error).__name__),
                          "message": str(error)}, ensure_ascii=False), file=sys.stderr, flush=True)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
