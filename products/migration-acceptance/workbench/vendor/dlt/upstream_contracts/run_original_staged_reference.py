#!/usr/bin/env python3
"""Run the unchanged dlt GitHub staged reference and retain its complete native result.

Use the pinned installed dlt/DuckDB interpreter:
  python -B run_original_staged_reference.py --operation /owned/dlt-reference

The sibling source_manifest.json and upstream/ contain the complete original
reference inputs. An interrupted invocation follows the original dlt package
queues. Failed native jobs remain available through the original dlt interfaces.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
from decimal import Decimal
import fcntl
import hashlib
import html
import importlib.metadata
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import traceback
import uuid

OPERATION_ID = "DLTHUB-PIPELINE-MIGRATION-0C7A-20261013"
UPSTREAM_COMMIT = "2360d229c77f7f64692acc31a4555f4cfcd50ed3"
PIPELINE_NAME = "dlt_github_pipeline"
DATASET_NAME = "github_3"
INPUT = "tests/normalize/cases/github.issues.load_page_5_duck.json"
STAGED = "tests/pipeline/cases/github_pipeline"
SCHEMA = "commons.dlt-original-staged-reference/v1"


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def identity(path):
    path = Path(path)
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return {"bytes": path.stat().st_size, "sha256": value.hexdigest()}


def json_value(value):
    if isinstance(value, Decimal):
        return {"$type": "decimal", "value": str(value)}
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return {"$type": type(value).__name__, "value": value.isoformat()}
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"$type": "bytes", "hex": bytes(value).hex()}
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, uuid.UUID):
        return {"$type": "uuid", "value": str(value)}
    raise TypeError("Unsupported original value: " + type(value).__name__)


def atomic(path, body):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".write-", delete=False) as out:
            temporary = Path(out.name)
            out.write(body)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def write_json(path, value):
    atomic(path, (json.dumps(value, ensure_ascii=False, indent=2,
                            allow_nan=False, default=json_value) + "\n").encode("utf-8"))


def emit(event, **fields):
    print(json.dumps({"time": now(), "event": event, **fields},
                     ensure_ascii=False, allow_nan=False, default=json_value), flush=True)


def safe_relative(value):
    path = PurePosixPath(value)
    if (not value or path.is_absolute() or ".." in path.parts or "\\" in value
            or "\0" in value or path.as_posix() != value):
        raise ValueError("Invalid original source path: " + repr(value))
    return path


def retain_source(root, companion):
    manifest_path = companion / "source_manifest.json"
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if (manifest.get("schema") != "commons.upstream-source-companion/v1"
            or manifest.get("upstream_repository") != "dlt-hub/dlt"
            or manifest.get("upstream_commit") != UPSTREAM_COMMIT
            or manifest.get("upstream_version") != "1.31.0"):
        raise ValueError("Use the complete pinned dlt source companion")
    if (root / "source").is_symlink():
        raise ValueError("Retain the original source in the owned operation directory")
    files = manifest["original_files"]
    if len(files) != 78 or len({row["path"] for row in files}) != 78:
        raise ValueError("Receive all 78 original source leaves")
    verified = []
    for row in files:
        relative = safe_relative(row["path"])
        path = companion / "upstream" / relative
        data = path.read_bytes()
        object_body = b"blob " + str(len(data)).encode("ascii") + b"\0" + data
        if (len(data) != row["bytes"] or digest(data) != row["sha256"]
                or hashlib.sha1(object_body).hexdigest() != row["git_blob"]):
            raise ValueError("Original upstream source changed: " + row["path"])
        verified.append((relative, data))
    for relative, data in verified:
        path = root / "source" / relative
        if path.is_symlink() or not path.resolve().is_relative_to((root / "source").resolve()):
            raise ValueError("Source target escapes its retained root")
        if path.exists() and path.read_bytes() != data:
            raise ValueError("Another source edition occupies " + str(path))
        if not path.exists():
            atomic(path, data)
    saved_manifest = root / "source_manifest.json"
    if saved_manifest.exists() and saved_manifest.read_bytes() != manifest_bytes:
        raise ValueError("Existing original source manifest differs")
    if not saved_manifest.exists():
        atomic(saved_manifest, manifest_bytes)
    for name in ("README.md", "STAGED_REFERENCE.md"):
        path = companion / name
        if path.is_file():
            data = path.read_bytes()
            destination = root / "guides" / name
            if destination.exists() and destination.read_bytes() != data:
                raise ValueError("Retained original guide differs: " + name)
            if not destination.exists():
                atomic(destination, data)
    return manifest, digest(manifest_bytes)


def runtime_identity(manifest):
    import dlt
    import duckdb

    if importlib.metadata.version("dlt") != "1.31.0":
        raise ValueError("Select the installed dlt 1.31.0 engine from the pinned commit")
    package = Path(dlt.__file__).resolve().parent
    checked = []
    for row in manifest["original_files"]:
        if row["path"].startswith("dlt/") and row["path"].endswith(".py"):
            relative = Path(row["path"]).relative_to("dlt")
            path = package / relative
            if identity(path) != {"bytes": row["bytes"], "sha256": row["sha256"]}:
                raise ValueError("Installed dlt source differs from the pinned engine: " + str(relative))
            checked.append(row["path"])
    from dlt.destinations.impl.duckdb.factory import duckdb as destination
    from dlt.destinations.impl.duckdb.factory import duckdb_merge_strategies_selector
    caps = destination().capabilities()
    merge = list(duckdb_merge_strategies_selector(
        caps.supported_merge_strategies, table_schema={}))
    if "delete-insert" not in merge:
        raise ValueError("The installed native destination does not support this original reference strategy")
    return {
        "host": platform.node(), "python": sys.executable, "python_version": sys.version,
        "dlt_version": importlib.metadata.version("dlt"),
        "dlt_package": str(package), "verified_original_python_files": checked,
        "duckdb_version": duckdb.__version__, "original_lock_duckdb_version": "1.5.3",
        "merge_strategies": merge, "original_reference_merge_strategy": "delete-insert",
        "cdc_available": "cdc" in merge,
        "preferred_loader_file_format": caps.preferred_loader_file_format,
        "supported_loader_file_formats": list(caps.supported_loader_file_formats),
        "installed_distributions": sorted(
            [{"name": item.metadata.get("Name", ""), "version": item.version}
             for item in importlib.metadata.distributions()], key=lambda item: item["name"].lower()),
    }


def attach(root):
    # Do not call dlt.attach without an original local state: its native fallback
    # may initialize/restore a different destination operation.
    state = root / "pipelines" / PIPELINE_NAME / "state.json"
    if not state.is_file():
        return None
    import dlt
    pipeline = dlt.attach(PIPELINE_NAME, pipelines_dir=str(root / "pipelines"))
    if pipeline.pipeline_name != PIPELINE_NAME or pipeline.dataset_name != DATASET_NAME:
        raise ValueError("Retain the original reference pipeline and dataset")
    if Path(pipeline.working_dir).resolve() != state.parent.resolve():
        raise ValueError("Native pipeline resolved outside its selected operation")
    if pipeline.staging is not None:
        raise ValueError("The original reference uses its local DuckDB destination directly")
    # Resolve the original client configuration without opening a destination connection.
    config = pipeline.destination_client().config
    if (config.destination_type != "duckdb"
            or Path(config.credentials.database).resolve()
            != (root / "destination" / "reference.duckdb").resolve()):
        raise ValueError("Native destination differs from this selected reference operation")
    return pipeline


def snapshot(root, label):
    pipeline = attach(root)
    result = {"captured_at": now(), "label": label, "pipeline_name": PIPELINE_NAME,
              "dataset_name": DATASET_NAME, "present": pipeline is not None,
              "extracted": [], "normalized": [], "completed": [], "packages": []}
    if pipeline is not None:
        result["state"] = pipeline.state
        result["schemas"] = {
            name: pipeline.schemas[name].to_dict(bump_version=False)
            for name in pipeline.schema_names}
        result["extracted"] = list(pipeline.list_extracted_load_packages())
        result["normalized"] = list(pipeline.list_normalized_load_packages())
        result["completed"] = list(pipeline.list_completed_load_packages())
        for load_id in dict.fromkeys(result["extracted"] + result["normalized"] + result["completed"]):
            info = pipeline.get_load_package_info(load_id)
            result["packages"].append(info.asdict())
    path = root / "snapshots" / (label + ".json")
    write_json(path, result)
    emit("native_snapshot", path=str(path), extracted=result["extracted"],
         normalized=result["normalized"], completed=result["completed"])
    return result


def run_stage(root, phase, state, lock_fd, inherited_fds=()):
    script = root / "source" / STAGED / ("github_" + phase + ".py")
    log = root / "logs" / (str(len(state["stages"]) + 1).zfill(3) + "-" + phase + ".log")
    log.parent.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, "-B", str(script)]
    entry = {"phase": phase, "command": command, "cwd": str(root / "source" / "_storage"),
             "started_at": now(), "state": "starting", "log": str(log.relative_to(root))}
    state["stages"].append(entry)
    write_json(root / "operation.json", state)
    with log.open("ab", buffering=0) as output:
        child = subprocess.Popen(command, cwd=root / "source" / "_storage",
                                 stdout=output, stderr=subprocess.STDOUT, pass_fds=tuple(sorted(set((lock_fd, *inherited_fds)))))
        try:
            entry.update(pid=child.pid, state="running")
            write_json(root / "operation.json", state)
            emit("native_stage_started", phase=phase, pid=child.pid, log=str(log))
            last = time.monotonic()
            while child.poll() is None:
                time.sleep(0.5)
                if time.monotonic() - last >= 30:
                    emit("native_stage_running", phase=phase, pid=child.pid,
                         log_bytes=log.stat().st_size)
                    last = time.monotonic()
        except BaseException:
            # Close this receiver's own child before capturing its database/files.
            # SIGINT first lets the original dlt engine retain interrupted state.
            if child.poll() is None:
                child.send_signal(signal.SIGINT)
                try:
                    child.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    child.terminate()
                    try:
                        child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()
            entry.update(exit_code=child.returncode, finished_at=now(), state="interrupted",
                         log_identity=identity(log))
            write_json(root / "operation.json", state)
            raise
        entry.update(exit_code=child.returncode, finished_at=now(),
                     state="complete" if child.returncode == 0 else "failed",
                     log_identity=identity(log))
    write_json(root / "operation.json", state)
    snapshot(root, str(len(state["stages"])).zfill(3) + "-" + phase)
    emit("native_stage_finished", phase=phase, exit_code=child.returncode, log=str(log))
    if child.returncode:
        raise RuntimeError("Original " + phase + " exited " + str(child.returncode)
                           + "; inspect its complete log and native package state")


def quote_identifier(value):
    return '"' + value.replace('"', '""') + '"'


def destination_export(root):
    import duckdb
    database = root / "destination" / "reference.duckdb"
    if not database.is_file():
        raise ValueError("The original loader has not produced its selected DuckDB database")
    output = root / "destination_exports" / (now().replace(":", "-") + "-" + uuid.uuid4().hex[:8])
    output.mkdir(parents=True, exist_ok=False)
    tables, original_ids = [], None
    with duckdb.connect(str(database), read_only=True) as connection:
        catalog = connection.execute(
            "SELECT table_schema, table_name FROM information_schema.tables "
            "WHERE table_schema NOT IN ('information_schema','pg_catalog') "
            "AND table_type='BASE TABLE' ORDER BY table_schema,table_name").fetchall()
        for number, (schema, name) in enumerate(catalog, 1):
            qualified = quote_identifier(schema) + "." + quote_identifier(name)
            columns = connection.execute(
                "SELECT column_name,data_type,is_nullable,ordinal_position "
                "FROM information_schema.columns WHERE table_schema=? AND table_name=? "
                "ORDER BY ordinal_position", [schema, name]).fetchall()
            count = connection.execute("SELECT count(*) FROM " + qualified).fetchone()[0]
            path = output / (str(number).zfill(3) + ".csv")
            literal_path = "'" + str(path).replace("'", "''") + "'"
            connection.execute("COPY (SELECT * FROM " + qualified + ") TO " + literal_path
                               + " (FORMAT CSV, HEADER TRUE)")
            tables.append({
                "schema": schema, "name": name, "row_count": count,
                "columns": [{"name": row[0], "type": row[1], "nullable": row[2],
                             "position": row[3]} for row in columns],
                "file": str(path.relative_to(root)), **identity(path)})
            if schema == DATASET_NAME and name == "issues":
                original_ids = [row[0] for row in connection.execute(
                    "SELECT id FROM " + qualified).fetchall()]
    source = json.loads((root / "source" / INPUT).read_text(encoding="utf-8"))
    expected = [row["id"] for row in source]
    if len(expected) != 100 or len(set(expected)) != len(expected):
        raise ValueError("The complete original reference input differs")
    check = {
        "source_issue_count": len(expected),
        "destination_issue_count": len(original_ids) if original_ids is not None else None,
        "source_identity": identity(root / "source" / INPUT),
        "source_label_links": sum(len(row["labels"]) for row in source),
        "source_assignee_links": sum(len(row["assignees"]) for row in source),
        "missing_issue_ids": sorted(set(expected) - set(original_ids or [])),
        "unexpected_issue_ids": sorted(set(original_ids or []) - set(expected)),
        "duplicate_destination_issue_ids": (
            len(original_ids) != len(set(original_ids))) if original_ids is not None else None,
    }
    check["original_issue_identity_matches"] = (
        original_ids is not None and len(original_ids) == len(expected)
        and set(original_ids) == set(expected))
    result = {"database": str(database.relative_to(root)), "tables": tables,
              "original_input": check, "exported_at": now(),
              "manifest": str((output / "tables.json").relative_to(root))}
    write_json(output / "tables.json", result)
    return result


def report(root, state):
    def esc(value):
        return html.escape(str(value), quote=True)
    def link(path, label):
        return '<a href="' + esc(path) + '">' + esc(label) + "</a>"
    rows = "".join(
        "<tr><td>" + esc(item["phase"]) + "</td><td>" + esc(item["state"])
        + "</td><td>" + esc(item.get("exit_code", "running")) + "</td><td>"
        + link(item["log"], "Complete original output") + "</td></tr>"
        for item in state.get("stages", []))
    destination = state.get("destination_export", {})
    tables = "".join(
        "<tr><td>" + esc(item["schema"] + "." + item["name"]) + "</td><td>"
        + esc(item["row_count"]) + "</td><td>"
        + link(item["file"], "Complete CSV") + "</td></tr>"
        for item in destination.get("tables", []))
    runtime = state.get("runtime", {})
    failure = ("<section><h2>Native result</h2><pre>"
               + esc(state["error"]["traceback"]) + "</pre></section>") if state.get("error") else ""
    body = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Original dlt staged reference</title>
<style>
:root{font-family:Arial,Helvetica,sans-serif;color:#181818;background:#fff}
*{box-sizing:border-box}body{margin:0}main{max-width:1200px;margin:auto;padding:32px}
header{border-bottom:2px solid #222;padding-bottom:18px}h1{font-size:28px;margin:8px 0}
h2{font-size:20px}p{line-height:1.5;max-width:95ch}section{padding:18px 0;border-bottom:1px solid #ddd}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd}
th{background:#f2f2f2}a{color:#202020}code,pre{font-size:12px;overflow-wrap:anywhere}
pre{white-space:pre-wrap;background:#f5f5f5;padding:16px}.scroll{overflow:auto}
dl{display:grid;grid-template-columns:180px 1fr;gap:8px}dd{margin:0}
@media(max-width:700px){main{padding:18px}dl{display:block}dd{margin:6px 0 16px}}
@media print{main{padding:0}.scroll{overflow:visible}table{font-size:10px}}
</style></head><body><main><header><p>TokenJunkieLabs · Pipeline migration workshare</p>
<h1>Original dlt staged reference</h1><p>Complete original input, native package history and destination exports.</p>
</header>"""
    body += "<section><h2>Operation</h2><dl><dt>State</dt><dd>" + esc(state["state"])
    body += "</dd><dt>Native pipeline</dt><dd>" + esc(PIPELINE_NAME) + "</dd><dt>Dataset</dt><dd>" + esc(DATASET_NAME)
    body += "</dd><dt>dlt</dt><dd>" + esc(runtime.get("dlt_version", "See native result"))
    body += "</dd><dt>DuckDB</dt><dd>" + esc(runtime.get("duckdb_version", "See native result"))
    body += "</dd><dt>Native merge strategies</dt><dd>" + esc(", ".join(runtime.get("merge_strategies", [])))
    body += "</dd></dl><p>" + link("operation.json", "Complete operation") + " · "
    body += link("source_manifest.json", "All original source identities") + " · "
    body += link("source/" + INPUT, "Unchanged 100-issue input") + "</p></section>"
    body += "<section><h2>Original stages</h2><div class=scroll><table><thead><tr>"
    body += "<th>Stage</th><th>Result</th><th>Exit</th><th>Output</th></tr></thead><tbody>" + rows + "</tbody></table></div></section>"
    body += failure
    if destination:
        check = destination["original_input"]
        body += "<section><h2>Complete destination</h2><p>Original issue identities: "
        body += esc(check["source_issue_count"]) + " source / " + esc(check["destination_issue_count"])
        body += " destination. Complete identity match: " + esc(check["original_issue_identity_matches"])
        body += ".</p><p>The unchanged source contains " + esc(check["source_label_links"])
        body += " label links and " + esc(check["source_assignee_links"])
        body += " assignee links. Each destination table below retains its actual native row count and column types.</p>"
        body += "<div class=scroll><table><thead><tr><th>Native table</th><th>Rows</th><th>Complete output</th>"
        body += "</tr></thead><tbody>" + tables + "</tbody></table></div><p>"
        body += link(destination["manifest"], "All table identities, column types and source comparison") + "</p></section>"
    body += "<section><h2>Retained native history</h2><ul>"
    for path in sorted((root / "snapshots").glob("*.json")):
        body += "<li>" + link(str(path.relative_to(root)), path.stem) + "</li>"
    body += "</ul><p>The original dlt pipeline directory, DuckDB database, source, logs and outputs travel together in the saved operating archive.</p></section>"
    body += "</main></body></html>"
    atomic(root / "index.html", body.encode("utf-8"))


def archive(root):
    target = root.with_name(root.name + "-complete.tar.gz")
    temporary = target.with_name(target.name + ".partial-" + str(os.getpid()))
    members = []
    try:
        with tarfile.open(temporary, "w:gz") as out:
            for path in sorted(root.rglob("*")):
                relative = path.relative_to(root)
                if path.is_symlink():
                    raise ValueError("Unexpected link in retained operation: " + str(relative))
                if not path.is_file() or relative.as_posix() == ".reference.lock":
                    continue
                members.append({"path": relative.as_posix(), **identity(path)})
                out.add(path, arcname=relative.as_posix(), recursive=False)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    receipt = {"schema": SCHEMA + "/archive", "operation_id": OPERATION_ID,
               "archive": str(target), **identity(target), "members": members, "created_at": now()}
    write_json(target.with_suffix(target.suffix + ".json"), receipt)
    emit("complete_operating_archive", path=str(target), bytes=receipt["bytes"],
         sha256=receipt["sha256"], members=len(members))
    return receipt


def main(*, inherited_fds=()):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation", type=Path, required=True)
    parser.add_argument("--companion", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--inspect", action="store_true",
                        help="Read and export the same retained native pipeline without advancing stages")
    args = parser.parse_args()
    os.umask(0o077)
    root, companion = args.operation.expanduser().resolve(), args.companion.expanduser().resolve()
    if root == companion or root.is_relative_to(companion) or companion.is_relative_to(root):
        raise ValueError("Keep the owned operation separate from the source companion")
    if root.exists() and not (root / "selection.json").is_file():
        remaining = [path for path in root.iterdir() if path.name != ".reference.lock"]
        if remaining or (root / ".reference.lock").is_symlink():
            raise ValueError("Use an empty owned directory or this original retained reference operation")
    root.mkdir(parents=True, exist_ok=True)
    with (root / ".reference.lock").open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        selection = {"schema": SCHEMA, "operation_id": OPERATION_ID, "upstream_commit": UPSTREAM_COMMIT,
                     "pipeline_name": PIPELINE_NAME, "dataset_name": DATASET_NAME,
                     "operation": str(root), "database": str(root / "destination" / "reference.duckdb"),
                     "pipelines": str(root / "pipelines")}
        selected_path = root / "selection.json"
        if selected_path.exists():
            if json.loads(selected_path.read_text(encoding="utf-8")) != selection:
                raise ValueError("Continue the original selected reference operation")
        else:
            write_json(selected_path, selection)
        state_path = root / "operation.json"
        state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {
            **selection, "created_at": now(), "stages": [], "continuations": []}
        state.update(state="receiving", current_pid=os.getpid(), updated_at=now())
        state["continuations"].append({"started_at": now(), "pid": os.getpid(), "inspect": args.inspect})
        state.pop("error", None)
        write_json(state_path, state)
        try:
            manifest, manifest_sha = retain_source(root, companion)
            state["source_manifest_sha256"] = manifest_sha
            for path in (root / "source" / "_storage", root / "destination", root / "pipelines",
                         root / "logs", root / "snapshots", root / "destination_exports"):
                if path.is_symlink() or not path.resolve().is_relative_to(root):
                    raise ValueError("Retain native operation directories inside the selected root")
                path.mkdir(parents=True, exist_ok=True)
            os.environ.update({
                "PIPELINES_DIR": str(root / "pipelines"),
                # with_config resolves the named pipeline scope before its global fallback.
                "DLT_GITHUB_PIPELINE__PIPELINES__DLT_GITHUB_PIPELINE__PIPELINES_DIR": str(root / "pipelines"),
                "DESTINATION__DUCKDB__CREDENTIALS": str(root / "destination" / "reference.duckdb"),
                "DLT_GITHUB_PIPELINE__DESTINATION__DUCKDB__CREDENTIALS": str(root / "destination" / "reference.duckdb"),
                "DLT_GITHUB_PIPELINE__DESTINATION__DUCKDB__CREDENTIALS__DATABASE": str(root / "destination" / "reference.duckdb"),
                "RUNTIME__DLTHUB_TELEMETRY": "false",
                "PYTHONDONTWRITEBYTECODE": "1",
            })
            # Keep the unchanged scripts on the selected original reference despite host defaults.
            pipeline_scope = "DLT_GITHUB_PIPELINE__PIPELINES__DLT_GITHUB_PIPELINE__"
            for name, value in {
                "DATASET_NAME": DATASET_NAME, "DATASET_NAME_LAYOUT": "%s",
                "DESTINATION_TYPE": "duckdb", "DESTINATION_NAME": "duckdb",
                "DEV_MODE": "false", "FULL_REFRESH": "false",
            }.items():
                os.environ[pipeline_scope + name] = value
            state["runtime"] = runtime_identity(manifest)
            write_json(state_path, state)
            before = snapshot(root, "invocation-" + str(len(state["continuations"])).zfill(3) + "-before")
            if not args.inspect:
                if not before["extracted"] and not before["normalized"] and not before["completed"]:
                    run_stage(root, "extract", state, lock.fileno(), inherited_fds)
                pending = snapshot(root, "invocation-" + str(len(state["continuations"])).zfill(3) + "-pending")
                if pending["extracted"]:
                    run_stage(root, "normalize", state, lock.fileno(), inherited_fds)
                pending = snapshot(root, "invocation-" + str(len(state["continuations"])).zfill(3) + "-normalized")
                if pending["normalized"]:
                    run_stage(root, "load", state, lock.fileno(), inherited_fds)
            final = snapshot(root, "invocation-" + str(len(state["continuations"])).zfill(3) + "-final")
            state["native_queues"] = {key: final[key] for key in ("extracted", "normalized", "completed")}
            if final["extracted"] or final["normalized"]:
                raise ValueError("Original pending packages remain; inspect their retained native state")
            if not final["completed"]:
                raise ValueError("The original reference has no completed load package")
            state["failed_jobs"] = [
                {"load_id": package["load_id"], **job}
                for package in final["packages"] for job in package["jobs"]
                if job["state"] == "failed_jobs"]
            state["pending_transitions"] = [
                package["load_id"] for package in final["packages"]
                if package.get("has_pending_transitions")]
            state["destination_export"] = destination_export(root)
            if any(row.get("state") == "aborted" for row in final["packages"]):
                raise ValueError("An original package was aborted; preserve its native recovery decision")
            if state["failed_jobs"] or state["pending_transitions"]:
                raise ValueError("Original failed jobs or unfinalized native transitions remain; inspect their full package state")
            if not state["destination_export"]["original_input"]["original_issue_identity_matches"]:
                raise ValueError("Original issue identities differ; full source and destination exports are retained")
            state.update(state="complete", completed_at=now())
        except BaseException as error:
            state.update(state="failed", failed_at=now(),
                         error={"type": type(error).__name__, "message": str(error),
                                "traceback": traceback.format_exc()})
            emit("native_reference_failed", error=str(error))
        write_json(state_path, state)
        report(root, state)
        copied = root / "run_original_staged_reference.py"
        source_bytes = Path(__file__).resolve().read_bytes()
        if not copied.exists() or copied.read_bytes() != source_bytes:
            atomic(copied, source_bytes)
        receipt = archive(root)
        emit("native_reference_finished", state=state["state"], operation=str(root),
             report=str(root / "index.html"), archive=receipt["archive"])
        return 0 if state["state"] == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())
