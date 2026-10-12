"""MIT. Shared manifest and retained-file input for Islandora operators."""
from __future__ import annotations
import base64
import csv
import io
import json
from pathlib import Path
from harvest import InputError

MAX_BROWSER_FILE = 32 * 1024 * 1024

def payload_bytes(payload):
    value = payload.get("bodyBase64")
    if not isinstance(value, str):
        raise InputError("Select an original file to receive")
    try:
        body = base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as error:
        raise InputError("The selected file could not be decoded") from error
    if len(body) > MAX_BROWSER_FILE:
        raise InputError("Use the native Islandora command for files larger than 32 MiB")
    return body

def manifest_document(body, kind):
    """Read complete JSON/CSV manifests without losing repeated rows or cells."""
    if kind not in {"assets", "relationships"}:
        raise InputError("Choose a file or parent manifest")
    if isinstance(body, bytes):
        try:
            text = body.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise InputError("The manifest must use UTF-8 text") from error
    elif isinstance(body, str):
        text = body.lstrip("\ufeff")
    else:
        raise InputError("Read the complete manifest file")
    if not text.strip():
        raise InputError("The selected manifest is empty")
    if text.lstrip().startswith(("[", "{")):
        try:
            rows = json.loads(text)
        except ValueError as error:
            raise InputError("The manifest JSON is incomplete or invalid") from error
        if isinstance(rows, dict):
            candidates = ("assets", "files", "entries") if kind == "assets" else ("relationships", "relations", "entries")
            rows = next((rows[key] for key in candidates if key in rows), None)
    else:
        try:
            reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
            names = reader.fieldnames
            if not names or any(not name for name in names) or len(names) != len(set(names)):
                raise InputError("The manifest needs unique, nonempty column names")
            rows = []
            for row in reader:
                if None in row or any(value is None for value in row.values()):
                    raise InputError("Each manifest row must match its complete header")
                if any(value.strip() for value in row.values()):
                    rows.append(row)
        except csv.Error as error:
            raise InputError("The manifest contains an incomplete CSV record") from error
    if not isinstance(rows, list):
        raise InputError("Use a JSON array of records or a CSV with a header")
    required = ("identifier", "path") if kind == "assets" else ("child", "parent")
    for number, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            raise InputError("Manifest row " + str(number) + " must be an object")
        for name in required:
            if not isinstance(row.get(name), str) or not row[name].strip():
                raise InputError("Manifest row " + str(number) + " needs " + name)
    if not rows:
        raise InputError("The manifest contains no records")
    return rows

def selected_log(desk, identity, run_id):
    from islandora import path_under
    job = desk.job(identity)
    run = next((item for item in job.get("runs", []) if item["id"] == run_id), None)
    if run is None:
        raise InputError("Select an existing native run")
    return run, path_under(desk.directory(identity), run["log"])

def log_page(desk, identity, run_id, offset=0, limit=65536):
    offset, limit = int(offset), int(limit)
    if offset < 0 or not 1 <= limit <= 1024 * 1024:
        raise InputError("Use a positive log page of at most 1 MiB")
    run, path = selected_log(desk, identity, run_id)
    size = path.stat().st_size if path.is_file() else 0
    reset = offset > size
    if reset:
        offset = 0
    chunk = b""
    if size:
        with path.open("rb") as source:
            source.seek(offset)
            chunk = source.read(limit)
    return {"runId": run_id, "offset": offset, "next": offset + len(chunk), "size": size,
            "text": chunk.decode("utf-8", errors="replace"), "reset": reset,
            "running": run.get("status") == "RUNNING", "exitCode": run.get("exitCode")}

def desk_state(desk):
    result = desk.state()
    result["workerError"] = getattr(desk, "last_error", None)
    result["capabilities"] = [name for name in ("inspect_target", "associations", "configure")
                              if callable(getattr(desk, name, None))]
    return result
