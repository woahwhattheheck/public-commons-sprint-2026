#!/usr/bin/env python3
"""MIT. Complete local FHIR Bulk Data acquisition, projection and receiving CLI."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import time

from fhir_workspace import Workspace, InputError, original_workspace
from fhir_acquisition import ProviderError
from fhir_source import epoch, json_value

MAX_JSON = 4 * 1024 * 1024


def absolute(value, label):
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise InputError(label + " must be an absolute local path")
    return path


@contextmanager
def input_file(value, limit=512 * 1024 * 1024):
    path = absolute(value, "Input")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise InputError("Select a regular input file within the supported size")
        yield stream
        after = os.fstat(stream.fileno())
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise InputError("The original input file changed while it was being read")


def read_json(value):
    if value == "-":
        data = sys.stdin.buffer.read(MAX_JSON + 1)
        if len(data) > MAX_JSON:
            raise InputError("JSON input exceeds 4 MiB")
    else:
        with input_file(value, MAX_JSON) as stream:
            data = stream.read(MAX_JSON + 1)
    result = json_value(data)
    if not isinstance(result, dict):
        raise InputError("Select an original JSON object")
    return result


def output_file(value, source):
    path = absolute(value, "Output")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.parent.is_symlink() or not path.parent.is_dir():
        raise InputError("Choose a regular output directory")
    digest, count = hashlib.sha256(), 0
    try:
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600), "wb") as out:
            while block := source.read(1024 * 1024):
                out.write(block)
                digest.update(block)
                count += len(block)
            out.flush()
            os.fsync(out.fileno())
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except BaseException:
        # Only a newly created partial output belongs to this operation.
        if "out" in locals():
            path.unlink(missing_ok=True)
        raise
    return {"file": str(path), "bytes": count, "sha256": digest.hexdigest()}


def emit(value, stream=None):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, default=str), file=stream or sys.stdout, flush=True)


def run_export(ws, export_id, operation_id, max_wait_seconds=3600):
    """Continue the same saved native request, preserving the provider's next poll."""
    deadline = time.monotonic() + max_wait_seconds
    last = None
    while True:
        operation = ws.advance(export_id, operation_id)
        detail = {"operationId": operation["operationId"], "state": operation["state"],
                  "phase": operation["phase"], "completedFiles": sum(
                      row["state"] == "complete" for row in operation["files"]),
                  "fileCount": len(operation["files"]), "notBefore": operation.get("notBefore")}
        if detail != last:
            emit(detail, sys.stderr)
            last = detail
        if operation["state"] in {"complete", "failed", "cancelled", "cancel_unknown", "kickoff_unknown"}:
            return operation
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return operation
        due = operation.get("notBefore")
        delay = max(0.0, float(epoch(due)) - time.time()) if due else 0.0
        if delay > remaining:
            return operation
        if delay:
            # Keep interruptions responsive while honoring the exact native clock.
            while delay > 0:
                wait = min(delay, 30.0)
                time.sleep(wait)
                delay -= wait


def common(parser):
    parser.add_argument("--workspace", default=argparse.SUPPRESS, help="Absolute original private workspace")
    parser.add_argument("--credentials-file", default=argparse.SUPPRESS, help="Absolute local authentication profile file")


def parser():
    p = argparse.ArgumentParser(description="FHIR Bulk Data source, original native dataset and complete receiving")
    common(p)
    sub = p.add_subparsers(dest="command", required=True)

    def command(name, help):
        item = sub.add_parser(name, help=help)
        common(item)
        return item

    for name, help in [
            ("init", "Create or reopen the original private workspace"),
            ("state", "Read all saved source, request and dataset identities"),
            ("catalogue", "Read protocol, mapping and source controls"),
            ("auth-profiles", "Read configured profile names and allowed origins")]:
        command(name, help)

    q = command("connection-save", "Retain a complete reviewed connection")
    q.add_argument("--file", required=True)
    q = command("connection", "Open a retained connection")
    q.add_argument("--id", required=True)
    q = command("discover", "Retain original CapabilityStatement and SMART discovery")
    q.add_argument("--connection", required=True)
    q = command("discovery", "Open a saved original discovery")
    q.add_argument("--id", required=True)
    q = command("groups", "Retain one original Group page")
    q.add_argument("--connection", required=True)
    q.add_argument("--url", help="Exact saved nextUrl from the preceding page")
    q = command("group-page", "Open a saved original Group page")
    q.add_argument("--id", required=True)

    q = command("export-save", "Retain the complete explicit native export request")
    q.add_argument("--file", required=True)
    q = command("export", "Open a saved export definition")
    q.add_argument("--id", required=True)
    for name, help in [("advance", "Perform the next original export step"),
                       ("run", "Continue the same operation through native receiving")]:
        q = command(name, help)
        q.add_argument("--export", required=True)
        q.add_argument("--operation", required=True, help="Retained UUID chosen before the original request")
        if name == "run":
            q.add_argument("--max-wait-seconds", type=int, default=3600)
    q = command("operation", "Reopen the exact native request and received result")
    q.add_argument("--id", required=True)
    q = command("adopt-status", "Receive the actual status URL for the same original operation")
    q.add_argument("--operation", required=True)
    q.add_argument("--status-url", required=True)
    q.add_argument("--reason", required=True)
    q = command("cancel", "Retain and send an explicit original provider cancellation")
    q.add_argument("--operation", required=True)
    q.add_argument("--request-id", required=True)

    q = command("source-add", "Receive a complete original FHIR source ZIP")
    q.add_argument("--file", required=True)
    q.add_argument("--label")
    q.add_argument("--name")
    for name, help in [("source", "Open complete original inventory"),
                       ("source-members", "List all retained original file members"),
                       ("source-packet", "Export the original complete source ZIP")]:
        q = command(name, help)
        q.add_argument("--id", required=True)
        if name == "source-packet":
            q.add_argument("--out", required=True)
    q = command("source-rows", "Read exact original NDJSON rows")
    q.add_argument("--id", required=True)
    q.add_argument("--resource-type")
    q.add_argument("--kind", choices=["output", "error", "deleted"], default="output")
    q.add_argument("--offset", type=int, default=0)
    q.add_argument("--limit", type=int, default=50)
    q.add_argument("--query", default="")
    q = command("source-row", "Open the exact source-file physical line")
    q.add_argument("--id", required=True)
    q.add_argument("--file-id", required=True)
    q.add_argument("--line", type=int, required=True)
    q = command("source-member", "Export one unchanged retained source member")
    q.add_argument("--id", required=True)
    q.add_argument("--name", required=True)
    q.add_argument("--out", required=True)

    q = command("mapping", "Create a full editable mapping from original fields")
    q.add_argument("--source", required=True)
    q.add_argument("--resource-type", required=True)
    q.add_argument("--name")
    q = command("preview", "Preview the complete reviewed projection")
    q.add_argument("--source", required=True)
    q.add_argument("--plan-file", required=True)
    q.add_argument("--limit", type=int, default=25)
    q = command("plan-save", "Save the complete reviewed mapping")
    q.add_argument("--file", required=True)
    q = command("plan", "Open a saved mapping")
    q.add_argument("--id", required=True)
    q = command("build", "Build and review the original native dataset")
    q.add_argument("--source", required=True)
    q.add_argument("--plan", required=True)
    q = command("build-review", "Open the retained native build review")
    q.add_argument("--id", required=True)
    q = command("query", "Use original native fields/filter/range/sort/cursor parameters")
    q.add_argument("--build", required=True)
    q.add_argument("--params-file", help="JSON object of original scalar string parameters")
    q = command("compare", "Compare two saved editions with the same reviewed mapping")
    q.add_argument("--before", required=True)
    q.add_argument("--after", required=True)
    q = command("changes", "Read one page of original source differences")
    q.add_argument("--id", required=True)
    q.add_argument("--offset", type=int, default=0)
    q.add_argument("--limit", type=int, default=50)
    q = command("changes-export", "Export complete original edition differences")
    q.add_argument("--id", required=True)
    q.add_argument("--out", required=True)
    q = command("compose", "Apply reviewed original deltas and explicit deletions in order")
    q.add_argument("--file", required=True)

    q = command("dataset-export", "Export native data/config and source-bound merchant lineage")
    q.add_argument("--build", required=True)
    q.add_argument("--out", required=True, help="Absolute new output directory")
    q = command("packet-export", "Export original source-backed customer dataset ZIP")
    q.add_argument("--build", required=True)
    q.add_argument("--out", required=True)
    q = command("packet-import", "Rebuild an original source-backed dataset ZIP")
    q.add_argument("--file", required=True)
    q = command("workspace-export", "Export the complete editable workspace")
    q.add_argument("--out", required=True)
    q = command("workspace-import", "Receive or resume the same complete original workspace ZIP")
    q.add_argument("--file", required=True)
    q = command("serve", "Open the complete private browser operator")
    q.add_argument("--port", type=int, default=0)
    return p


def execute(args, ws):
    name = args.command
    if name in {"init", "state"}:
        return ws.state()
    if name == "catalogue":
        return ws.catalogue()
    if name == "auth-profiles":
        return ws.auth_profiles()
    if name == "connection-save":
        return ws.save_connection(read_json(args.file))
    if name == "connection":
        return ws.connection(args.id)
    if name == "discover":
        return ws.discover(args.connection)
    if name == "discovery":
        return ws.discovery(args.id)
    if name == "groups":
        return ws.groups(args.connection, args.url)
    if name == "group-page":
        return ws.group_page(args.id)
    if name == "export-save":
        return ws.save_export(read_json(args.file))
    if name == "export":
        return ws.export_plan(args.id)
    if name in {"advance", "run"}:
        if name == "run":
            if not 0 <= args.max_wait_seconds <= 7 * 86400:
                raise InputError("Choose a continuation window from 0 to 604800 seconds")
            return run_export(ws, args.export, args.operation, args.max_wait_seconds)
        return ws.advance(args.export, args.operation)
    if name == "operation":
        return ws.operation(args.id)
    if name == "adopt-status":
        return ws.adopt_status(args.operation, {"statusUrl": args.status_url, "reason": args.reason})
    if name == "cancel":
        return ws.cancel(args.operation, args.request_id)
    if name == "source-add":
        with input_file(args.file, original_workspace.MAX_SOURCE) as stream:
            return ws.add_source(stream, args.label, args.name or Path(args.file).name)
    if name == "source":
        return ws.source(args.id)
    if name == "source-members":
        return ws.source_members(args.id)
    if name == "source-rows":
        return ws.source_rows(args.id, args.resource_type, args.kind, args.offset, args.limit, args.query)
    if name == "source-row":
        return ws.source_row(args.id, args.file_id, args.line)
    if name == "source-packet":
        with ws.source_path(args.id).open("rb") as stream:
            return output_file(args.out, stream)
    if name == "source-member":
        with ws.open_source_member(args.id, args.name) as stream:
            return output_file(args.out, stream)
    if name == "mapping":
        return ws.default_mapping(args.source, args.resource_type, args.name)
    if name == "preview":
        return ws.projection_preview(args.source, read_json(args.plan_file), args.limit)
    if name == "plan-save":
        return ws.save_plan(read_json(args.file))
    if name == "plan":
        return {"id": args.id, "plan": ws.plan(args.id)}
    if name == "build":
        return ws.build(args.source, args.plan)
    if name == "build-review":
        return ws.build_view(args.id)
    if name == "query":
        return ws.query(args.build, read_json(args.params_file) if args.params_file else {})
    if name == "compare":
        return ws.compare(args.before, args.after)
    if name == "changes":
        return ws.comparison_page(args.id, args.offset, args.limit)
    if name == "changes-export":
        with ws.comparison_file(args.id).open("rb") as stream:
            return output_file(args.out, stream)
    if name == "compose":
        return ws.compose(read_json(args.file))
    if name == "dataset-export":
        return ws.export_dataset(args.build, absolute(args.out, "Output"))
    if name == "packet-export":
        return ws.export_packet(args.build, absolute(args.out, "Output"))
    if name == "packet-import":
        with input_file(args.file):
            return ws.import_packet(absolute(args.file, "Input"))
    if name == "workspace-export":
        return ws.export_workspace(absolute(args.out, "Output"))
    if name == "workspace-import":
        with input_file(args.file):
            return ws.import_workspace(absolute(args.file, "Input"))
    if name == "serve":
        if not 0 <= args.port <= 65535:
            raise InputError("Choose a loopback port from 0 to 65535")
        from fhir_server import OperatorServer
        with OperatorServer(ws, args.port) as server:
            emit({"url": server.url, "workspace": str(ws.root)})
            try:
                server.serve_forever(poll_interval=0.2)
            except KeyboardInterrupt:
                pass
        return None
    raise InputError("Unknown FHIR Bulk Data command")


def main(argv=None):
    p = parser()
    args = p.parse_args(argv)
    if not getattr(args, "workspace", None):
        p.error("--workspace is required")
    try:
        path = absolute(args.workspace, "Workspace")
        create = args.command in {"init", "serve", "workspace-import", "packet-import"} and not path.exists()
        credentials = getattr(args, "credentials_file", None)
        if credentials:
            credentials = absolute(credentials, "Credentials")
        with Workspace(path, create=create, credentials_file=credentials) as ws:
            result = execute(args, ws)
        if result is not None:
            emit(result)
        if args.command in {"run", "advance"} and result["state"] != "complete":
            return 75
        return 0
    except KeyboardInterrupt:
        emit({"error": "Interrupted; reopen the same retained operation ID to continue"}, sys.stderr)
        return 130
    except (InputError, OSError, ValueError) as exc:
        error = {"error": str(exc), "kind": exc.__class__.__name__}
        for attribute, key in [("provider_status", "providerStatus"), ("retry_after", "retryAfter"),
                               ("not_before", "notBefore"), ("receipt", "receipt")]:
            value = getattr(exc, attribute, None)
            if value is not None:
                error[key] = value
        emit(error, sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
