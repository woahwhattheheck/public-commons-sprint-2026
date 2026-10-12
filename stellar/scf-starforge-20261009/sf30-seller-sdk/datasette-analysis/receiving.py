#!/usr/bin/env python3
"""Receive a complete Datasette Analysis product through its original engines.

This is one native product operation: retained source -> HTTP operator -> original
report/workbook/archive -> original restore_archive -> reopened HTTP operator.
Repeated invocation keeps the same operator request and native receiving IDs.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import sys
import tempfile
import threading
import time

HERE = Path(__file__).resolve().parent
CHECKOUT = HERE.parents[3]
PYTHON = HERE.parents[1] / "sf88-operator-buyer-cli" / "python"
if str(PYTHON) not in sys.path:
    sys.path.insert(0, str(PYTHON))

from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace
from stellar_forge_buyer.storage import private_directory, sync_directory
from stellar_forge_buyer.workspace_archive_receive import restore_archive
from operator_client import DatasetteOperatorClient, DatasetteClientError
from operator_server import create_operator
from source import handover as read_handover, read_native_edition, read_retained

SCHEMA = "stellar-forge.datasette-native-receiving.v1"
DEFAULT_OPERATION = "SCF-DATASETTE-SOURCE-EDITIONS-07476-20261012"
ID = re.compile(r"[a-f0-9]{32}")
HASH = re.compile(r"[a-f0-9]{64}")
REF = re.compile(r"[a-f0-9]{40}")


def require(condition, code, detail=""):
    if not condition:
        raise ValueError(code + (": " + detail if detail else ""))


def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      sort_keys=True, separators=(",", ":")).encode("utf-8")


def now():
    return datetime.now(timezone.utc).isoformat()


def digest_file(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode), "DATASETTE_RECEIVING_FILE_REQUIRED", str(path))
        return {"bytes": info.st_size,
                "sha256": hashlib.file_digest(source, "sha256").hexdigest()}


def identify(operation_id, phase):
    return hashlib.sha256((operation_id + "\0" + phase).encode()).hexdigest()[:32]


def emit(event):
    print(json.dumps(event, ensure_ascii=False, allow_nan=False), flush=True)


def write_record(path, value):
    raw = encoded(value) + b"\n"
    descriptor, temporary = tempfile.mkstemp(prefix=".receiving-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as target:
            os.fchmod(target.fileno(), 0o600)
            target.write(raw)
            target.flush()
            os.fsync(target.fileno())
        if path.exists():
            require(not path.is_symlink() and path.is_file(),
                    "DATASETTE_RECEIVING_RECORD_INVALID", str(path))
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def load_record(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as source:
        raw = source.read(8 * 1024 * 1024 + 1)
    require(len(raw) <= 8 * 1024 * 1024, "DATASETTE_RECEIVING_RECORD_TOO_LARGE")
    return json.loads(raw)


def source_identity(checkout, source_ref, node):
    """Retain the actual executable module identities alongside the selected ref."""
    paths = [
        HERE / "source.py", HERE / "model.py", HERE / "recipes.py",
        HERE / "operator_server.py", HERE / "operator_client.py",
        HERE / "edition_bridge.mjs", Path(__file__),
        PYTHON / "stellar_forge_buyer" / "analysis_workspace.py",
        PYTHON / "stellar_forge_buyer" / "workspace_archive.py",
        PYTHON / "stellar_forge_buyer" / "workspace_archive_receive.py",
        PYTHON / "stellar_forge_buyer" / "response_documents.py",
    ]
    files = []
    for path in paths:
        relative = str(path.relative_to(checkout)) if path.is_relative_to(checkout) else str(path)
        files.append({"path": relative, **digest_file(path)})
    version = subprocess.run([node, "--version"], check=True, capture_output=True,
                             text=True, timeout=15).stdout.strip()
    return {"ref": source_ref, "checkout": str(checkout), "files": files,
            "runtime": {"python": platform.python_version(), "executable": sys.executable,
                        "node": version, "node_command": node,
                        "system": platform.system(), "machine": platform.machine()}}


@contextmanager
def operator(workspace_path, *, checkout, node, operation_id):
    analysis = AnalysisWorkspace(workspace_path, checkout=checkout, node=node)
    server = controller = thread = control = None
    try:
        server, control, _, controller = create_operator(
            analysis, operation_id=operation_id, port=0)
        thread = threading.Thread(
            target=server.serve_forever, kwargs={"poll_interval": 0.2},
            name="datasette-native-receiving-http", daemon=True)
        thread.start()
        client = DatasetteOperatorClient.from_workspace(workspace_path)
        status = client.status()
        require(status["workspace_id"] == analysis.identity
                and status["operation_id"] == operation_id,
                "DATASETTE_RECEIVING_OPERATOR_IDENTITY_CHANGED")
        yield client, analysis.identity
    finally:
        if server is not None and thread is not None:
            server.shutdown()
            thread.join()
        if server is not None:
            server.server_close()
        if controller is not None:
            controller.close()
        if control is not None:
            control.unlink(missing_ok=True)
            server.datasette_analysis_control.unlink(missing_ok=True)
        analysis.close()


def request(client, action, body, *, operation_id, resume, timeout, phase=None):
    request_id = identify(operation_id, "HTTP:" + (phase or action))
    emit({"phase": action.upper(), "request_id": request_id})
    result = client.submit(action, body, request_id=request_id)["request"]
    if result["status"] in {"FAILED", "INTERRUPTED"}:
        require(resume, "DATASETTE_RECEIVING_RESUME_REQUIRED", request_id)
        result = client.resume(request_id)["request"]
    if result["status"] == "RUNNING":
        def progress(value):
            current = (value.get("progress") or [])[-1:]
            emit({"phase": action.upper(), "request_id": request_id,
                  "status": value["status"], "progress": current})
        result = client.wait(request_id, timeout=timeout, progress=progress)
    require(result["status"] == "COMPLETE", "DATASETTE_RECEIVING_ACTION_FAILED",
            json.dumps({"request_id": request_id, "error": result.get("error")},
                       ensure_ascii=False))
    require(isinstance(result.get("result"), dict), "DATASETTE_RECEIVING_RESULT_REQUIRED")
    return result


def selected(status, edition_id):
    values = [edition for edition in status["state"]["editions"]
              if edition["edition_id"] == edition_id]
    require(len(values) == 1 and values[0]["status"] == "COMPLETE",
            "DATASETTE_RECEIVING_EDITION_INCOMPLETE", edition_id)
    return values[0]


def read_rows(client, *, edition_id, expected_columns, expected_rows):
    """Read every row through the operator and compare retained source scalars."""
    offset, total = 0, len(expected_rows)
    hasher = hashlib.sha256()
    hasher.update(encoded({"columns": expected_columns}) + b"\n")
    while True:
        page = client.rows(edition_id=edition_id, offset=offset, limit=250)
        require(page.get("edition_id") == edition_id
                and page.get("columns") == expected_columns
                and page.get("total") == total and page.get("offset") == offset,
                "DATASETTE_RECEIVING_ROW_PAGE_CHANGED", str(offset))
        rows = page.get("rows")
        require(isinstance(rows, list) and len(rows) <= 250
                and rows == expected_rows[offset:offset + len(rows)],
                "DATASETTE_RECEIVING_SOURCE_VALUE_CHANGED", str(offset))
        for row in rows:
            hasher.update(encoded(row) + b"\n")
        offset += len(rows)
        next_offset = page.get("next_offset")
        if next_offset is None:
            require(offset == total, "DATASETTE_RECEIVING_ROWS_INCOMPLETE",
                    str(offset) + "/" + str(total))
            break
        require(rows and type(next_offset) is int and next_offset == offset and offset < total,
                "DATASETTE_RECEIVING_ROW_CURSOR_INVALID", str(offset))
    return {"rows": total, "columns": expected_columns, "sha256": hasher.hexdigest()}


def download(client, descriptor, directory, *, edition_id=None):
    require(isinstance(descriptor.get("filename"), str)
            and Path(descriptor["filename"]).name == descriptor["filename"]
            and descriptor["filename"] not in {"", ".", ".."},
            "DATASETTE_RECEIVING_FILENAME_INVALID")
    target = directory / descriptor["filename"]
    result = client.download(descriptor["name"], target, edition_id=edition_id,
                             export_id=descriptor.get("export_id"),
                             expected_sha256=descriptor["sha256"])
    require(result["bytes"] == descriptor["bytes"]
            and result["sha256"] == descriptor["sha256"],
            "DATASETTE_RECEIVING_DOWNLOAD_CHANGED", descriptor["name"])
    return {"name": descriptor["name"], "filename": descriptor["filename"],
            "path": str(target), "bytes": result["bytes"], "sha256": result["sha256"]}



def customer_selection(client, edition, original, country, operation_id, timeout):
    """Save and run a useful country selection in the original Analysis API."""
    mapping = edition["source"].get("column_mapping", {})
    country_column = mapping.get("country", "country")
    columns = edition["collections"]["plants"]["columns"]
    require(country_column in columns, "DATASETTE_CUSTOMER_COUNTRY_COLUMN_REQUIRED")
    expected_count = sum(row.get(country_column) == country for row in original["rows"])
    require(expected_count > 0, "DATASETTE_CUSTOMER_COUNTRY_NOT_IN_SOURCE", country)
    projection = [mapping.get(name, name) for name in
                  ("country", "name", "gppd_idnr", "capacity_mw", "year_of_capacity_data")]
    projection = [name for name in projection if name in columns]
    quote = lambda value: '"' + value.replace('"', '""') + '"'
    sql = ("SELECT " + ",".join(quote(name) for name in projection)
           + " FROM " + quote(edition["collections"]["plants"]["name"])
           + " WHERE " + quote(country_column) + " = ? ORDER BY "
           + quote(mapping.get("name", "name") if mapping.get("name", "name") in columns
                   else country_column))
    fields = {"sql": sql, "parameters_text": json.dumps([country]), "max_rows": 100000}
    name = "datasette_customer_" + operation_id[:12]
    try:
        saved = client.saved_query(name)
    except DatasetteClientError as error:
        if error.code != "ANALYSIS_QUERY_NOT_FOUND":
            raise
        saved = client.save_query(name, fields, expected_revision=0)
    require(all(saved.get(key) == value for key, value in fields.items()),
            "DATASETTE_CUSTOMER_QUERY_CHANGED", name)
    state = client.analysis_state()
    job_id = identify(operation_id, "CUSTOMER_COUNTRY_QUERY")
    job = client.start_query({**fields, "expected_views": state["views"]}, job_id=job_id)
    deadline = time.monotonic() + timeout
    while job["status"] == "RUNNING":
        require(time.monotonic() < deadline, "DATASETTE_CUSTOMER_QUERY_STILL_RUNNING", job_id)
        time.sleep(0.05)
        job = client.analysis_job(job_id)
    require(job["status"] == "COMPLETE" and not job["result"]["truncated"]
            and job["result"]["total_rows"] == expected_count,
            "DATASETTE_CUSTOMER_QUERY_INCOMPLETE")
    return {"country": country, "rows": expected_count,
            "saved_query": {key: saved[key] for key in
                            ("name", "revision", "sql", "parameters_text", "max_rows")},
            "job_id": job_id, "result_sha256": job["result"]["result_sha256"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--handover", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--received-workspace", required=True, type=Path,
                        help="Absent destination for original restore_archive")
    parser.add_argument("--destination", required=True, type=Path,
                        help="Private output directory retained beyond this process")
    parser.add_argument("--checkout", type=Path, default=CHECKOUT)
    parser.add_argument("--source-ref", required=True, help="Exact selected source commit")
    parser.add_argument("--operation", default=DEFAULT_OPERATION)
    parser.add_argument("--operation-id", help="Original Datasette UUID32; defaults to operation-name hash")
    parser.add_argument("--node", default="node")
    parser.add_argument("--prefix", default="datasette")
    parser.add_argument("--handover-sha256")
    parser.add_argument("--expected-rows", type=int)
    parser.add_argument("--expected-capacity-mw")
    parser.add_argument("--customer-country", help="Save a country selection, export current work and receive it again")
    parser.add_argument("--resume", action="store_true",
                        help="Resume original failed/interrupted HTTP requests")
    parser.add_argument("--wait-seconds", type=float, default=3600)
    args = parser.parse_args(argv)
    os.umask(0o077)
    operation_id = args.operation_id or hashlib.sha256(args.operation.encode()).hexdigest()[:32]
    require(ID.fullmatch(operation_id), "DATASETTE_RECEIVING_OPERATION_ID_INVALID")
    require(REF.fullmatch(args.source_ref), "DATASETTE_RECEIVING_SOURCE_REF_REQUIRED")
    require(args.wait_seconds > 0, "DATASETTE_RECEIVING_WAIT_INVALID")
    checkout = args.checkout.expanduser().resolve(strict=True)
    handover = args.handover.expanduser().absolute()
    workspace_path = args.workspace.expanduser().absolute()
    receiving_path = args.received_workspace.expanduser().absolute()
    destination = private_directory(args.destination.expanduser().absolute(), create=True)
    require(workspace_path != receiving_path, "DATASETTE_RECEIVING_DISTINCT_WORKSPACES_REQUIRED")
    require(workspace_path != destination and receiving_path != destination,
            "DATASETTE_RECEIVING_OUTPUT_DIRECTORY_DISTINCT")
    # The original receiver requires a private parent and owns its absent target.
    private_directory(receiving_path.parent, create=True)
    received_files = private_directory(destination / "received-products", create=True)
    produced_files = private_directory(destination / "products", create=True)
    receipt_path = destination / "native-receiving.json"
    handover_identity = digest_file(handover)
    if args.handover_sha256 is not None:
        require(HASH.fullmatch(args.handover_sha256)
                and args.handover_sha256 == handover_identity["sha256"],
                "DATASETTE_RECEIVING_HANDOVER_CHANGED")
    sources = source_identity(checkout, args.source_ref, args.node)
    intent = {"operation": args.operation, "operation_id": operation_id,
              "handover": str(handover), "handover_file": handover_identity,
              "workspace": str(workspace_path), "received_workspace": str(receiving_path),
              "destination": str(destination), "source_ref": args.source_ref,
              "source_files": sources["files"], "prefix": args.prefix,
              "expected_rows": args.expected_rows,
              "expected_capacity_mw": args.expected_capacity_mw,
              "customer_country": args.customer_country}
    if receipt_path.exists():
        receipt = load_record(receipt_path)
        require(receipt.get("schema") == SCHEMA and receipt.get("intent") == intent,
                "DATASETTE_RECEIVING_ORIGINAL_INTENT_CHANGED")
    else:
        receipt = {"schema": SCHEMA, "intent": intent, "source": sources,
                   "created_at": now(), "phase": "PREPARED"}

    def save(phase, **values):
        receipt.update(phase=phase, updated_at=now(), **values)
        receipt.pop("error", None)
        write_record(receipt_path, receipt)
        emit({"phase": phase, "operation_id": operation_id, "receipt": str(receipt_path)})

    save("READ_SOURCE")
    try:
        # The original parser verifies every retained page, its continuation
        # chain and exact byte identity; preparation uses that same parser.
        selected_source = read_handover(str(handover))
        source_kind = selected_source["record"]["delivery"]["kind"]
        if source_kind == "native-edition":
            expected = read_native_edition(str(handover), node=args.node)
        else:
            require(source_kind == "retained-source", "DATASETTE_RECEIVING_SOURCE_KIND")
            expected = read_retained(str(handover))
        edition_id = expected["id"]
        expected_rows = expected["rows"]
        expected_columns = expected["columns"]
        require(expected_rows, "DATASETTE_RECEIVING_EMPTY_SOURCE")
        if args.expected_rows is not None:
            require(len(expected_rows) == args.expected_rows,
                    "DATASETTE_RECEIVING_EXPECTED_ROW_COUNT_CHANGED")
        save("SOURCE_READY", edition_id=edition_id,
             source_capture=expected["source"],
             retained_files=[{"name": item["name"], "bytes": len(item["raw"]),
                              "sha256": hashlib.sha256(item["raw"]).hexdigest()}
                             for item in expected["originals"]])
        with operator(workspace_path, checkout=checkout, node=args.node,
                      operation_id=operation_id) as (client, workspace_id):
            prepared = request(client, "prepare", {"handover": str(handover), "prefix": args.prefix},
                               operation_id=operation_id, resume=args.resume,
                               timeout=args.wait_seconds)
            edition = selected(client.status(), edition_id)
            require(prepared["result"]["edition_id"] == edition_id
                    and edition["row_count"] == len(expected_rows),
                    "DATASETTE_RECEIVING_PREPARED_EDITION_CHANGED")
            if args.expected_capacity_mw is not None:
                from decimal import Decimal
                require(Decimal(edition["summary"]["disclosed_capacity_mw"])
                        == Decimal(args.expected_capacity_mw),
                        "DATASETTE_RECEIVING_DISCLOSED_CAPACITY_CHANGED")
            source_rows = read_rows(client, edition_id=edition_id,
                                    expected_columns=expected_columns, expected_rows=expected_rows)
            product_names = {item["name"] for item in edition["files"]}
            require({"workbook", "workbook-handover", "report-html", "report-json", "report-tables"}
                    <= product_names, "DATASETTE_RECEIVING_PRODUCT_FILES_INCOMPLETE")
            saved_products = [download(client, item, produced_files, edition_id=edition_id)
                              for item in edition["files"]]
            save("PRODUCT_READY", workspace_id=workspace_id, edition=edition,
                 source_rows=source_rows, products=saved_products,
                 prepare_request_id=prepared["id"])
            exported = request(client, "export", {}, operation_id=operation_id,
                               resume=args.resume, timeout=args.wait_seconds)
            export_result = exported["result"]
            archive_files = [download(client, item, produced_files)
                             for item in export_result["files"]]
            archive = next((item for item in archive_files if item["name"] == "workspace"), None)
            require(archive is not None, "DATASETTE_RECEIVING_WORKSPACE_ARCHIVE_REQUIRED")
            save("EXPORTED", archive=archive, archive_files=archive_files,
                 export_request_id=exported["id"],
                 archive_native=export_result["workspace"])
        receive_id = identify(operation_id, "ORIGINAL_ARCHIVE_RECEIVE:" + edition_id)
        received = restore_archive(archive["path"], receiving_path, operation=receive_id,
                                   expected_sha256=archive["sha256"])
        require(received["state"] == "complete" and received["workspace_id"] == workspace_id
                and received["archive_sha256"] == archive["sha256"],
                "DATASETTE_RECEIVING_NATIVE_RESTORE_CHANGED")
        save("RECEIVED", receiving=received)
        with operator(receiving_path, checkout=checkout, node=args.node,
                      operation_id=operation_id) as (client, restored_workspace_id):
            status = client.status()
            reopened = selected(status, edition_id)
            require(restored_workspace_id == workspace_id
                    and status["state"]["current_edition"] == edition_id,
                    "DATASETTE_RECEIVING_REOPENED_IDENTITY_CHANGED")
            for name in ("row_count", "version_id", "source", "summary", "report", "workbook", "files"):
                require(reopened[name] == edition[name],
                        "DATASETTE_RECEIVING_REOPENED_EDITION_CHANGED", name)
            restored_rows = read_rows(client, edition_id=edition_id,
                                      expected_columns=expected_columns, expected_rows=expected_rows)
            require(restored_rows == source_rows, "DATASETTE_RECEIVING_REOPENED_ROWS_CHANGED")
            reopened_products = [download(client, item, received_files, edition_id=edition_id)
                                 for item in reopened["files"]]
            require([{key: item[key] for key in ("name", "filename", "bytes", "sha256")}
                     for item in reopened_products]
                    == [{key: item[key] for key in ("name", "filename", "bytes", "sha256")}
                        for item in saved_products],
                    "DATASETTE_RECEIVING_REOPENED_PRODUCTS_CHANGED")
            save("REOPENED" if args.customer_country is not None else "COMPLETE",
                 reopened={"workspace_id": restored_workspace_id,
                 "operation_id": status["operation_id"], "edition_id": edition_id,
                 "rows": restored_rows, "summary": reopened["summary"],
                 "products": reopened_products}, completed_at=now())
            if args.customer_country is not None:
                customer = customer_selection(client, reopened, expected, args.customer_country,
                                              operation_id, args.wait_seconds)
                refreshed = request(client, "export", {}, operation_id=operation_id,
                                    resume=args.resume, timeout=args.wait_seconds,
                                    phase="CUSTOMER_EXPORT")
                customer_outputs = private_directory(destination / "customer-products", create=True)
                refreshed_files = [download(client, item, customer_outputs)
                                   for item in refreshed["result"]["files"]]
                customer_archive = next(item for item in refreshed_files if item["name"] == "workspace")
                require(customer_archive["sha256"] != archive["sha256"],
                        "DATASETTE_CUSTOMER_EXPORT_REUSED_OLDER_WORKSPACE")
                save("CUSTOMER_EXPORTED", customer=customer, customer_archive=customer_archive,
                     customer_export_request_id=refreshed["id"])
        if args.customer_country is not None:
            customer_workspace = destination / "customer-workspace"
            restored_customer = restore_archive(
                customer_archive["path"], customer_workspace,
                operation=identify(operation_id, "CUSTOMER_ARCHIVE_RECEIVE:" + edition_id),
                expected_sha256=customer_archive["sha256"])
            with operator(customer_workspace, checkout=checkout, node=args.node,
                          operation_id=operation_id) as (client, customer_workspace_id):
                saved = client.saved_query(customer["saved_query"]["name"])
                require(customer_workspace_id == workspace_id
                        and all(saved.get(key) == value
                                for key, value in customer["saved_query"].items()),
                        "DATASETTE_CUSTOMER_EDIT_NOT_RETAINED")
                result = client.analysis_job(customer["job_id"])
                require(result["status"] == "COMPLETE"
                        and result["result"]["total_rows"] == customer["rows"]
                        and result["result"]["result_sha256"] == customer["result_sha256"],
                        "DATASETTE_CUSTOMER_QUERY_RESULT_NOT_RETAINED")
                save("COMPLETE", customer_reopened={
                    "workspace_id": customer_workspace_id, "workspace": str(customer_workspace),
                    "receiving": restored_customer, **customer}, completed_at=now())
        emit({"schema": SCHEMA, "status": "COMPLETE", "operation_id": operation_id,
              "edition_id": edition_id, "workspace_id": workspace_id,
              "rows": len(expected_rows), "summary": edition["summary"],
              "archive": archive, "received_workspace": str(receiving_path),
              "receipt": str(receipt_path), "customer": receipt.get("customer_reopened")})
        return 0
    except BaseException as error:
        receipt.update(phase="INTERRUPTED" if isinstance(error, KeyboardInterrupt) else "FAILED",
                       updated_at=now(), error={"code": str(getattr(error, "code", None)
                                                           or type(error).__name__),
                                               "message": str(error)})
        write_record(receipt_path, receipt)
        emit({"phase": receipt["phase"], "operation_id": operation_id,
              "error": receipt["error"], "receipt": str(receipt_path)})
        raise


if __name__ == "__main__":
    raise SystemExit(main())
