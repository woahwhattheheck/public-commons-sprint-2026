#!/usr/bin/env python3
"""MIT. Connected Systems discovery, retained acquisition, native editions and customer receiving."""
from __future__ import annotations
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import zipfile
from csapi_workspace import Workspace, InputError, json_bytes, load_json, atomic

def read_json(path, expected=dict):
    with sys.stdin.buffer if path == "-" else Path(path).open("rb") as stream:
        raw = stream.read(262145)
    if len(raw) > 262144:
        raise InputError("Reviewed JSON input exceeds 256 KiB")
    value = load_json(raw)
    if not isinstance(value, expected):
        raise InputError("Expected a complete reviewed JSON " + ("object" if expected is dict else "array"))
    return value

def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1048576), b""):
            h.update(block)
    return h.hexdigest()

def publish_file(source, target):
    """Publish complete original bytes without replacing another output."""
    source, target = Path(source), Path(target).absolute()
    expected = {"bytes": source.stat().st_size, "sha256": file_hash(source)}
    def same():
        if target.is_symlink() or not target.is_file():
            raise InputError("Select a regular output file")
        if target.stat().st_size != expected["bytes"] or file_hash(target) != expected["sha256"]:
            raise InputError("Existing output contains different bytes; preserve it and choose another name")
    if target.exists() or target.is_symlink():
        same()
        return {"file": str(target), **expected, "replayed": True}
    fd, name = tempfile.mkstemp(prefix="." + target.name + "-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as output, source.open("rb") as original:
            os.fchmod(output.fileno(), 0o600)
            shutil.copyfileobj(original, output, 65536)
            output.flush()
            os.fsync(output.fileno())
        if file_hash(name) != expected["sha256"]:
            raise InputError("Output copy differs from the retained original")
        try:
            os.link(name, target)
        except FileExistsError:
            same()
        return {"file": str(target), **expected}
    finally:
        if os.path.exists(name):
            os.unlink(name)

def emit(value, out=None):
    data = json_bytes(value)
    if out is None:
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
        return
    target = Path(out).absolute()
    fd, name = tempfile.mkstemp(prefix=".connected-systems-result-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        publish_file(name, target)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def save_startup(path, value):
    target = Path(path).absolute()
    parent = target.parent.resolve(strict=True)
    info = parent.stat()
    if os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise InputError("Keep the process capability record in a private operator-owned directory")
    if target.exists() or target.is_symlink():
        info = target.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or
            os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077)):
            raise InputError("Existing startup record must be one private regular file")
        previous = load_json(target.read_bytes())
        if previous.get("schema") != value["schema"] or previous.get("workspace") != value["workspace"]:
            raise InputError("Existing startup record belongs to another workspace")
    atomic(target, json_bytes(value))

def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace", required=True, help="Original private Connected Systems workspace")
    p.add_argument("--node", help="Existing Node executable for the unchanged SF30 engine")
    sub = p.add_subparsers(dest="action", required=True)
    def command(name, help_text="", output=True):
        c = sub.add_parser(name, help=help_text)
        if output:
            c.add_argument("--out", help="Create an exact JSON result file; an existing exact result is accepted")
        return c
    command("init", "Create one original workspace")
    command("state")
    c = command("records", "Read a complete retained collection with an exact view guard")
    c.add_argument("--collection", required=True, choices=("sources", "plans", "builds", "comparisons", "connections", "queries", "documents", "operations"))
    c.add_argument("--offset", type=int, default=0); c.add_argument("--limit", type=int, default=100)
    c.add_argument("--expected-view-sha256", help="Required after offset zero; returned by the original first page")
    c = command("connection-save"); c.add_argument("--input", required=True)
    c = command("connection"); c.add_argument("--id", required=True)
    c = command("browse")
    c.add_argument("--connection", required=True); c.add_argument("--resource", required=True)
    c.add_argument("--params", help="JSON file containing ordered name/value pairs")
    c.add_argument("--operation", required=True, help="Retained request ID; reuse only for these exact inputs")
    c = command("document"); c.add_argument("--id", required=True)
    c = command("document-file", output=False); c.add_argument("--id", required=True); c.add_argument("--out", required=True)
    c = command("query-save"); c.add_argument("--input", required=True)
    c = command("query-definition"); c.add_argument("--id", required=True)
    c = command("acquire")
    c.add_argument("--query", required=True); c.add_argument("--operation", required=True); c.add_argument("--label")
    c = command("operation"); c.add_argument("--id", required=True)
    c = command("source-add"); c.add_argument("--file", required=True); c.add_argument("--label")
    c = command("source"); c.add_argument("--id", required=True)
    c = command("source-rows"); c.add_argument("--id", required=True); c.add_argument("--offset", type=int, default=0); c.add_argument("--limit", type=int, default=100)
    c = command("source-files"); c.add_argument("--id", required=True)
    c = command("source-file", output=False); c.add_argument("--id", required=True); c.add_argument("--name", required=True); c.add_argument("--out", required=True)
    c = command("mapping"); c.add_argument("--source", required=True); c.add_argument("--name")
    c = command("mapping-save"); c.add_argument("--input", required=True)
    c = command("mapping-read"); c.add_argument("--id", required=True)
    c = command("build"); c.add_argument("--source", required=True); c.add_argument("--mapping", required=True); c.add_argument("--expected", help="Original expected build review JSON, when reconstructing")
    c = command("build-read"); c.add_argument("--id", required=True)
    c = command("query"); c.add_argument("--build", required=True); c.add_argument("--params", default="{}", help="Native query parameters as a JSON object of strings")
    c = command("compare"); c.add_argument("--before", required=True); c.add_argument("--after", required=True)
    c = command("changes"); c.add_argument("--id", required=True); c.add_argument("--offset", type=int, default=0); c.add_argument("--limit", type=int, default=100)
    c = command("changes-file", output=False); c.add_argument("--id", required=True); c.add_argument("--out", required=True)
    c = command("export", output=False); c.add_argument("--build", required=True); c.add_argument("--out", required=True)
    c = command("export-dataset", output=False); c.add_argument("--build", required=True); c.add_argument("--out", required=True, help="New output directory")
    c = command("receive"); c.add_argument("--file", required=True)
    c = command("serve", output=False); c.add_argument("--host", default="127.0.0.1"); c.add_argument("--port", type=int, default=0); c.add_argument("--connection-file")
    return p

def main(argv=None):
    a = parser().parse_args(argv)
    node = a.node or os.environ.get("SF30_XML_NODE") or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE")
    if node:
        os.environ["SF30_XML_NODE"] = node
    if a.action == "init":
        with Workspace(a.workspace, create=True) as ws:
            emit({"workspace": str(ws.root), "state": ws.state()}, a.out)
        return
    with Workspace(a.workspace) as ws:
        action, out = a.action, getattr(a, "out", None)
        if action == "state":
            result = ws.state()
        elif action == "records":
            result = ws.records(a.collection, a.offset, a.limit, expected_view_sha256=a.expected_view_sha256)
        elif action == "connection-save":
            result = ws.save_connection(read_json(a.input))
        elif action == "connection":
            result = ws.connection(a.id)
        elif action == "browse":
            result = ws.browse(a.connection, a.resource, read_json(a.params, list) if a.params else None, operation_id=a.operation)
        elif action == "document":
            result = ws.document(a.id)
        elif action == "document-file":
            emit(publish_file(ws.document_path(a.id), a.out)); return
        elif action == "query-save":
            result = ws.save_query(read_json(a.input))
        elif action == "query-definition":
            result = ws.query_definition(a.id)
        elif action == "acquire":
            result = ws.acquire(a.query, a.operation, a.label)
        elif action == "operation":
            result = ws.operation(a.id)
        elif action == "source-add":
            with Path(a.file).open("rb") as stream:
                result = ws.add_source(stream, label=a.label, name=Path(a.file).name)
        elif action == "source":
            result = ws.source(a.id)
        elif action == "source-rows":
            result = ws.source_rows(a.id, a.offset, a.limit)
        elif action == "source-files":
            result = ws.source_files(a.id)
        elif action == "source-file":
            value = ws.source_file(a.id, a.name)
            with ws.scratch() as temp:
                source = temp / "original-member"
                with source.open("xb") as stream:
                    source.chmod(0o600); stream.write(value["body"])
                emit({**publish_file(source, a.out), "source": a.id, "member": value["name"], "mediaType": value["mediaType"]})
            return
        elif action == "mapping":
            result = ws.default_mapping(a.source, a.name)
        elif action == "mapping-save":
            result = ws.save_plan(read_json(a.input))
        elif action == "mapping-read":
            result = ws.plan(a.id)
        elif action == "build":
            result = ws.build(a.source, a.mapping, expected=read_json(a.expected) if a.expected else None)
        elif action == "build-read":
            result = ws.build_view(a.id)
        elif action == "query":
            params = load_json(a.params)
            if not isinstance(params, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in params.items()):
                raise InputError("Native query parameters must be a JSON object of strings")
            result = ws.query(a.build, params)
        elif action == "compare":
            result = ws.compare(a.before, a.after)
        elif action == "changes":
            result = ws.comparison_page(a.id, a.offset, a.limit)
        elif action == "changes-file":
            emit(publish_file(ws.comparison_file(a.id), a.out)); return
        elif action == "export":
            with ws.scratch() as temp:
                original = temp / "connected-systems-project.zip"
                ws.export_packet(a.build, original)
                emit({**publish_file(original, a.out), "build": a.build})
            return
        elif action == "export-dataset":
            emit(ws.export_dataset(a.build, Path(a.out))); return
        elif action == "receive":
            result = ws.import_packet(Path(a.file))
        elif action == "serve":
            from csapi_server import OperatorServer
            server = OperatorServer(ws, host=a.host, port=a.port)
            try:
                value = server.startup()
                if a.connection_file:
                    save_startup(a.connection_file, value)
                emit(value)
                server.serve_forever(poll_interval=0.25)
            except KeyboardInterrupt:
                pass
            finally:
                server.server_close()
            return
        else:
            raise InputError("Unknown Connected Systems operation")
        emit(result, out)

if __name__ == "__main__":
    try:
        main()
    except (InputError, OSError, ValueError, zipfile.BadZipFile) as error:
        body = {"error": type(error).__name__, "message": str(error)}
        for attribute, field in (("code", "code"), ("status", "status"), ("provider_status", "providerStatus"),
                                 ("retry_at", "retryAt"), ("retry_after", "retryAfter"), ("view_sha256", "viewSha256")):
            if getattr(error, attribute, None) is not None:
                body[field] = getattr(error, attribute)
        emit(body)
        raise SystemExit(1)
