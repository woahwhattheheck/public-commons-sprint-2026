#!/usr/bin/env python3
"""Run or receive one original SQL Server read operation. Python 3.10+, Node 22.16+."""
from __future__ import annotations
import argparse
import base64
import contextlib
import csv
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import zipfile

MAX_FILE = 64 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
MAX_FILES = 2000
DRIVER_REF = "f18c68077478e1cf7063e5c38be86f0edab39d7a"
JOB_SCHEMA = "commons-bi-sql-server-job/1"
RESULT_SCHEMA = "commons-bi-sql-server-result/1"

def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()

def digest(data):
    return hashlib.sha256(data).hexdigest()

def read(path, maximum=MAX_FILE):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
        raise ValueError("An original operation file is not a regular file within its declared limit.")
    data = path.read_bytes()
    if len(data) > maximum:
        raise ValueError("An original operation file exceeds its limit.")
    return data

def relative(name):
    if (not isinstance(name, str) or not name or "\\" in name or "\0" in name
        or PurePosixPath(name).is_absolute() or ":" in name
        or any(p in ("", ".", "..") for p in name.split("/"))):
        raise ValueError("Use an exact portable relative file path.")
    return name

def atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".sql-write-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)

def document(path):
    return json.loads(read(path).decode("utf-8"))

def identity(path):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("Retain a regular native file.")
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(chunk)
    return {"bytes": info.st_size, "sha256": sha.hexdigest()}

def verify_job(job_path):
    job_path = Path(job_path).resolve()
    raw = read(job_path, 2 * 1024 * 1024)
    job = json.loads(raw.decode("utf-8"))
    if (job.get("schema") != JOB_SCHEMA or job.get("driver_ref") != DRIVER_REF
        or job.get("action") not in ("catalog", "preflight", "capture")
        or job.get("origin") not in ("sqlserver", "protocol-example")):
        raise ValueError("The original SQL Server job contract is invalid.")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", str(job.get("job_id", ""))):
        raise ValueError("The original job needs its stable identity.")
    seen = set()
    for item in job.get("files", []):
        name = relative(item["path"])
        if name in seen:
            raise ValueError("The original job names an input twice.")
        seen.add(name)
        actual = identity(job_path.parent / name)
        if actual != {"bytes": item.get("bytes"), "sha256": item.get("sha256")}:
            raise ValueError("The original input file bytes differ: " + name)
    source_file = relative(job.get("source_file"))
    if source_file not in seen or identity(job_path.parent / source_file)["sha256"] != job.get("source_sha256"):
        raise ValueError("The original source declaration is missing or changed.")
    return job, raw

def scalar(value, null_token):
    if value is None:
        return null_token
    if isinstance(value, str):
        if value == null_token:
            raise ValueError("A source value collides with this capture's explicit null token.")
        return value
    if isinstance(value, dict) and set(value) == {"base64"} and isinstance(value["base64"], str):
        base64.b64decode(value["base64"], validate=True)
        return value["base64"]
    raise ValueError("A native SQL value differs from its exact server-text or binary representation.")

def snapshot_files(job_path, operation):
    """Freeze only committed original pages. A live next page cannot enter this snapshot."""
    job_path, operation = Path(job_path).resolve(), Path(operation).resolve()
    job, raw = verify_job(job_path)
    state_raw = read(operation / "state.json")
    state = json.loads(state_raw.decode("utf-8"))
    job_hash = digest(raw)
    if state.get("job_sha256") != job_hash or state.get("job_id") != job["job_id"]:
        raise ValueError("The native state belongs to a different original job.")
    files = {"job.json": raw, "state.json": state_raw}
    for item in job["files"]:
        files["input/" + item["path"]] = read(job_path.parent / item["path"])
    for item in [*state.get("pages", []), *state.get("observations", [])]:
        name = relative(item["path"])
        body = read(operation / name)
        if len(body) != item.get("bytes") or digest(body) != item.get("sha256"):
            raise ValueError("A committed original native observation differs: " + name)
        if name in files and files[name] != body:
            raise ValueError("Two native files share a different identity.")
        files[name] = body
    return job, state, files

def capture_csv(state, files, null_token):
    columns = state.get("columns", [])
    if not columns or len(columns) > 64 or len(set(columns)) != len(columns):
        raise ValueError("Retain the exact unique projected native columns.")
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(columns)
    rows = 0
    for page in state.get("pages", []):
        result = json.loads(files[page["path"]].decode("utf-8"))
        if (result.get("schema") != "stellar-forge.mssql-result.v1"
            or result.get("snapshot") != "single-statement-database-isolation"
            or not isinstance(result.get("truncated"), bool)
            or result.get("columns") != columns or result.get("columnTypes") != state.get("column_types")):
            raise ValueError("A committed page has different native columns.")
        values = result.get("rows")
        if not isinstance(values, list) or len(values) != result.get("rowCount") or len(values) != page.get("rows"):
            raise ValueError("A committed page row count differs.")
        for value in values:
            if not isinstance(value, dict) or set(value) != set(columns):
                raise ValueError("A source row differs from the exact selected projection.")
            writer.writerow([scalar(value[c], null_token) for c in columns])
            rows += 1
    if rows != state.get("rows"):
        raise ValueError("The complete captured row count differs from native state.")
    data = output.getvalue().encode("utf-8")
    if len(data) > MAX_FILE:
        raise ValueError("The complete CSV exceeds the receiving input limit; all original pages remain on this host.")
    return data, rows

def package_result(job_path, operation, *, checkpoint=False):
    operation = Path(operation).resolve()
    job, state, files = snapshot_files(job_path, operation)
    null_token = "__SQL_NULL_" + digest(files["job.json"])[:20] + "__"
    state_hash = digest(files["state.json"])
    result = {
        "schema": RESULT_SCHEMA, "job_id": job["job_id"], "job_sha256": digest(files["job.json"]),
        "operation_id": job["operation_id"], "source_sha256": job["source_sha256"],
        "driver_ref": DRIVER_REF, "origin": state["origin"], "action": job["action"],
        "status": state["status"], "complete": state.get("complete", False),
        "checkpoint": bool(checkpoint), "state_sha256": state_hash,
        "server_version": state.get("server_version"), "column_types": state.get("column_types", []),
        "columns": state.get("columns", []), "rows": state.get("rows", 0),
        "pages": len(state.get("pages", [])), "started_at": state["started_at"],
        "captured_at": state.get("completed_at", state["updated_at"]),
        "null_token": null_token, "parameters": job.get("parameters", {}),
        "pagination": job.get("pagination", {"mode": "single"}),
        "query_name": job.get("query_name"), "error": state.get("error"),
        "consistency": {
            "statement": "single-statement-database-isolation",
            "collection": "one observed statement per page; concurrent source changes may span the retained capture window",
            "cross_page_snapshot_claimed": False,
        },
    }
    if job["action"] == "capture" and state.get("columns"):
        body, rows = capture_csv(state, files, null_token)
        filename = "capture/rows.csv"
        files[filename] = body
        result["capture"] = {"path": filename, "bytes": len(body), "sha256": digest(body), "rows": rows}
    result["files"] = [{"path": name, "bytes": len(body), "sha256": digest(body),
                        "role": "capture" if name == "capture/rows.csv" else "native-source"}
                       for name, body in sorted(files.items())]
    files["result.json"] = encode(result) + b"\n"
    manifest = {"schema": "commons-bi-sql-server-files/1", "job_id": job["job_id"],
                "files": [{"path": n, "bytes": len(b), "sha256": digest(b)} for n, b in sorted(files.items())]}
    if len(files) + 1 > MAX_FILES or sum(map(len, files.values())) > MAX_TOTAL:
        raise ValueError("This receiving package exceeds its file or expanded-byte limit; original files remain retained.")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, body in sorted(files.items()):
            if len(body) > MAX_FILE:
                raise ValueError("One result source exceeds its original receiving limit.")
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100600 << 16
            archive.writestr(info, body)
        archive.writestr("MANIFEST.json", encode(manifest) + b"\n")
    data = output.getvalue()
    if len(data) > MAX_FILE:
        raise ValueError("The compressed receiving package exceeds 64 MiB; original files remain retained.")
    return data, result, files

def read_result(data):
    if not isinstance(data, bytes) or len(data) > MAX_FILE:
        raise ValueError("Choose a complete receiving ZIP of at most 64 MiB.")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            names = [relative(i.filename) for i in entries]
            if (len(entries) > MAX_FILES or len(names) != len(set(names))
                or any(i.is_dir() or stat.S_ISLNK(i.external_attr >> 16) or i.file_size > MAX_FILE for i in entries)
                or sum(i.file_size for i in entries) > MAX_TOTAL):
                raise ValueError("The receiving ZIP has invalid or excessive members.")
            files = {i.filename: archive.read(i) for i in entries}
    except (zipfile.BadZipFile, UnicodeDecodeError, KeyError) as exc:
        raise ValueError("The original receiving ZIP could not be read.") from exc
    manifest = json.loads(files.pop("MANIFEST.json").decode("utf-8"))
    if manifest.get("schema") != "commons-bi-sql-server-files/1":
        raise ValueError("The original receiving manifest is missing.")
    declared = manifest.get("files", [])
    expected = [{"path": n, "bytes": len(b), "sha256": digest(b)} for n, b in sorted(files.items())]
    if declared != expected:
        raise ValueError("An original receiving file differs from the complete manifest.")
    result = json.loads(files["result.json"].decode("utf-8"))
    job = json.loads(files["job.json"].decode("utf-8"))
    state = json.loads(files["state.json"].decode("utf-8"))
    if (result.get("schema") != RESULT_SCHEMA or result.get("job_sha256") != digest(files["job.json"])
        or result.get("job_id") != job.get("job_id") or result.get("operation_id") != job.get("operation_id")
        or result.get("source_sha256") != job.get("source_sha256") or result.get("origin") != job.get("origin")
        or result.get("driver_ref") != DRIVER_REF or state.get("job_sha256") != result["job_sha256"]
        or result.get("state_sha256") != digest(files["state.json"])
        or state.get("status") != result.get("status") or state.get("complete") != result.get("complete")):
        raise ValueError("The result differs from its exact original job or native state.")
    if (job.get("schema") != JOB_SCHEMA or job.get("driver_ref") != DRIVER_REF
        or state.get("schema") != "commons-bi-sql-server-state/1"
        or state.get("job_id") != job["job_id"] or state.get("driver_ref") != DRIVER_REF
        or state.get("origin") != job.get("origin") or manifest.get("job_id") != job["job_id"]
        or result.get("action") != job.get("action")
        or result.get("columns") != state.get("columns", [])
        or result.get("column_types") != state.get("column_types", [])
        or result.get("rows") != state.get("rows", 0)
        or result.get("pages") != len(state.get("pages", []))
        or result.get("parameters") != job.get("parameters", {})
        or result.get("pagination") != job.get("pagination", {"mode": "single"})
        or result.get("null_token") != "__SQL_NULL_" + digest(files["job.json"])[:20] + "__"
        or bool(result.get("complete")) != (state.get("status") == "complete")):
        raise ValueError("The receiving result metadata differs from its complete original native state.")
    for item in [*state.get("pages", []), *state.get("observations", [])]:
        name = relative(item["path"])
        if name not in files or len(files[name]) != item.get("bytes") or digest(files[name]) != item.get("sha256"):
            raise ValueError("A committed native page or observation differs from state.")
    source_name = "input/" + relative(job["source_file"])
    if source_name not in files or digest(files[source_name]) != job.get("source_sha256"):
        raise ValueError("The exact native source declaration differs.")
    if (job.get("action") == "capture" and result.get("complete") and state.get("pages")
        and json.loads(files[state["pages"][-1]["path"]]).get("truncated") is not False):
        raise ValueError("A truncated final page cannot be a complete capture.")
    result_entries = [{"path": n, "bytes": len(b), "sha256": digest(b),
                       "role": "capture" if n == "capture/rows.csv" else "native-source"}
                      for n, b in sorted(files.items()) if n != "result.json"]
    if result.get("files") != result_entries:
        raise ValueError("The native result's complete file list differs.")
    for item in job["files"]:
        path = "input/" + relative(item["path"])
        if path not in files or len(files[path]) != item["bytes"] or digest(files[path]) != item["sha256"]:
            raise ValueError("The returned original source inputs differ.")
    if result.get("capture"):
        csv_data, rows = capture_csv(state, files, result["null_token"])
        capture = result["capture"]
        if (capture.get("path") != "capture/rows.csv" or files.get("capture/rows.csv") != csv_data
            or capture.get("sha256") != digest(csv_data) or capture.get("rows") != rows
            or result.get("rows") != rows):
            raise ValueError("The receiving CSV does not equal all committed native rows.")
    return result, job, state, files

def restore_checkpoint(data, job_path, operation):
    result, job, state, files = read_result(data)
    original, raw = verify_job(job_path)
    if files["job.json"] != raw:
        raise ValueError("This checkpoint belongs to a different original job.")
    operation = Path(operation)
    if operation.exists() and any(operation.iterdir()):
        raise ValueError("Restore the original checkpoint into a new operation directory.")
    operation.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name, body in files.items():
        if name in ("job.json", "result.json") or name.startswith("input/") or name.startswith("capture/"):
            continue
        atomic(operation / relative(name), body)
    # The native lock is an OS-process guard; it is deliberately not transferred.
    atomic(operation / "received-checkpoint.json", encode({
        "job_sha256": digest(raw), "bundle_sha256": digest(data),
        "original_status": state["status"], "received_at": time.time(),
        "continuation": "Inspect the original state, then explicitly continue any remaining reads."
    }) + b"\n")
    return result

@contextlib.contextmanager
def operation_lock(operation):
    operation = Path(operation)
    operation.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = operation / "controller.lock"
    if target.is_symlink():
        raise ValueError("The native operation lock cannot be a link.")
    handle = target.open("a+b")
    try:
        if os.name == "nt":
            import msvcrt
            if handle.tell() == 0:
                handle.write(b" ")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        handle.close()

def run(job_path, operation, *, mode="execute", node=None):
    job_path, operation = Path(job_path).resolve(), Path(operation).resolve()
    job, raw = verify_job(job_path)
    if job["origin"] != "sqlserver":
        raise ValueError("The native CLI accepts SQL Server jobs. Practice carriers use their explicitly separate entrypoint.")
    with operation_lock(operation):
        state_path = operation / "state.json"
        previous_result = operation / "result.bundle.zip"
        if previous_result.exists():
            prior = read(previous_result)
            result, _, state, _ = read_result(prior)
            if result["job_sha256"] != digest(raw):
                raise ValueError("The original native result belongs to a different job.")
            if state_path.exists() and digest(read(state_path)) == result["state_sha256"] and (result["status"] == "complete" or mode == "inspect"):
                return {"status": result["status"], "job_id": job["job_id"], "reused": True,
                        "path": str(previous_result), "sha256": digest(prior)}
        if mode == "inspect":
            if not state_path.exists():
                return {"status": "prepared", "job_id": job["job_id"], "native_started": False}
        else:
            executable = node or os.environ.get("BI_SQL_NODE") or shutil.which("node")
            if not executable:
                raise ValueError("Use the existing Node 22.16+ executable through --node or BI_SQL_NODE.")
            command = [executable, str(Path(__file__).with_name("capture.mjs")),
                       "--job=" + str(job_path), "--operation=" + str(operation), "--mode=" + mode]
            number = len(list(operation.glob("controller-*.json"))) + 1
            intent = {"schema": "commons-bi-sql-controller/1", "job_id": job["job_id"],
                      "job_sha256": digest(raw), "mode": mode, "created_at": time.time(), "state": "intent"}
            control_path = operation / ("controller-" + str(number).zfill(4) + ".json")
            atomic(control_path, encode(intent) + b"\n")
            log_path = operation / ("controller-" + str(number).zfill(4) + ".log")
            with log_path.open("ab") as output:
                os.chmod(log_path, 0o600)
                child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT)
                intent.update(state="running", pid=child.pid)
                atomic(control_path, encode(intent) + b"\n")
                code = child.wait()
            intent.update(state="finished", exit_code=code, completed_at=time.time())
            atomic(control_path, encode(intent) + b"\n")
            if not state_path.exists():
                raise ValueError("The native worker ended before creating its original state; inspect the retained controller log.")
        data, result, _ = package_result(job_path, operation, checkpoint=mode == "inspect")
        immutable = operation / ("result-" + digest(data) + ".zip")
        if not immutable.exists():
            atomic(immutable, data)
        atomic(previous_result, data)
        atomic(operation / "result.json", encode(result) + b"\n")
        return {"status": result["status"], "job_id": job["job_id"], "complete": result["complete"],
                "path": str(previous_result), "sha256": digest(data), "rows": result["rows"], "pages": result["pages"]}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job", required=True)
    parser.add_argument("--operation", required=True)
    parser.add_argument("--node")
    parser.add_argument("--mode", choices=("execute", "continue", "inspect"), default="execute")
    args = parser.parse_args()
    value = run(args.job, args.operation, mode=args.mode, node=args.node)
    print(json.dumps(value, ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        raise SystemExit(1)
