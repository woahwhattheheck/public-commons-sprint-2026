"""Command-line synthesis in the original Analysis database or its live owner.

Every mutation consumes a retained request with its original 32-character ID.
Native runs wait for their original job and drain before this process closes.
--live borrows the existing private Analysis launch through the shipped SDK.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import signal
import sys
import threading

from .errors import BuyerError, StateError
from .storage import parse, private_directory, read, write
from .evidence_synthesis import engine_information
from .synthesis_client import WorkspaceSynthesisClient, receive_synthesis_file

_MAX_REQUEST = 128 * 1024 * 1024
_MAX_SOURCE = 64 * 1024 * 1024


def _need(condition, code):
    if not condition:
        raise StateError("ANALYSIS_SYNTHESIS_CLI_" + code)


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      sort_keys=True, separators=(",", ":")).encode("utf-8")


def _retain(path, value):
    raw = _json(value)
    if path.exists():
        _need(read(path, _MAX_REQUEST) == raw, "RECEIVING_SELECTION_CHANGED")
    else:
        write(path, raw, exclusive=True)
    _need(read(path, _MAX_REQUEST) == raw, "RECEIVING_RECORD_NOT_RETAINED")


def _request(arguments):
    value = parse(read(Path(arguments.request), _MAX_REQUEST))
    _need(isinstance(value, dict), "REQUEST_OBJECT_REQUIRED")
    if arguments.command == "import-publication":
        if arguments.source:
            raw = read(Path(arguments.source), _MAX_SOURCE)
            _need(bool(raw), "COMPLETE_PUBLICATION_REQUIRED")
            _need(hashlib.sha256(raw).hexdigest() == value.get("expected_sha256"),
                  "SELECTED_PUBLICATION_CHANGED")
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                raise StateError("ANALYSIS_SYNTHESIS_CLI_SOURCE_UTF8_REQUIRED") from None
            _need("raw_text" not in value or value["raw_text"] == text,
                  "SELECTED_PUBLICATION_CHANGED")
            value = {**value, "raw_text": text}
        fields = {"id", "name", "expected_revision", "raw_text", "expected_sha256",
                  "source_context", "results_pointer"}
        _need(fields <= value.keys() and not set(value) - fields - {"descriptor_pointer"},
              "PUBLICATION_REQUEST_FIELDS_INVALID")
        _need(isinstance(value["raw_text"], str), "COMPLETE_PUBLICATION_REQUIRED")
        try:
            raw = value["raw_text"].encode("utf-8")
        except UnicodeError:
            raise StateError("ANALYSIS_SYNTHESIS_CLI_SOURCE_UTF8_REQUIRED") from None
        _need(0 < len(raw) <= _MAX_SOURCE and hashlib.sha256(raw).hexdigest() == value["expected_sha256"],
              "SELECTED_PUBLICATION_CHANGED")
    elif arguments.command == "save-protocol":
        _need(set(value) == {"id", "name", "expected_revision", "publication", "definition"},
              "PROTOCOL_REQUEST_FIELDS_INVALID")
    else:
        _need(set(value) == {"id", "protocol_name", "protocol_revision", "protocol_sha256"},
              "RUN_REQUEST_FIELDS_INVALID")
    return value


@contextmanager
def _signals():
    stopped = threading.Event()
    received = []
    previous = {}
    def stop(number, _frame):
        if not received:
            received.append(number)
        stopped.set()
    try:
        for number in (signal.SIGINT, signal.SIGTERM):
            previous[number] = signal.getsignal(number)
            signal.signal(number, stop)
        yield stopped, received
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)


def _wait_native(workspace, identifier, stopped):
    cancellation_sent = False
    while True:
        job = workspace.job(identifier)
        _need(job["kind"] == "synthesis", "ORIGINAL_SYNTHESIS_JOB_REQUIRED")
        if job["status"] != "RUNNING":
            return job
        if stopped.is_set() and not cancellation_sent:
            workspace.synthesis.cancel(identifier)
            cancellation_sent = True
        # A set stop event must not turn the drain into a busy loop.
        threading.Event().wait(0.2)


def _native_stream(open_original):
    @contextmanager
    def open_stream(offset):
        with open_original() as (stream, record):
            _need(type(offset) is int and 0 <= offset <= record["bytes"],
                  "RECEIVING_OFFSET_INVALID")
            stream.seek(offset)
            yield stream, {"status": 206 if offset else 200, "offset": offset,
                           "length": record["bytes"] - offset, "bytes": record["bytes"],
                           "sha256": record["sha256"]}
    return open_stream


def _receive_native(workspace, identifier, directory):
    directory = private_directory(Path(directory))
    result = workspace.synthesis.result(identifier)
    binding = {"workspace_id": workspace.identity, "run_id": identifier,
               "protocol": result["protocol"], "publication": result["publication"]}
    _retain(directory / "synthesis-selection.json", {"binding": binding, "result": result})
    files = []
    for record in result["files"]:
        original = lambda name=record["name"]: workspace.synthesis.download(identifier, name)
        received = receive_synthesis_file(record, directory / record["name"],
                                         _native_stream(original), binding=binding)
        files.append({key: value for key, value in received.items() if key != "resumed_from"})
    receipt = {"schema": "stellar-forge.synthesis-client-reception.v1", "status": "COMPLETE",
               "binding": binding, "directory": str(directory), "files": files}
    _retain(directory / "synthesis-reception.json", receipt)
    return receipt


def _source_native(workspace, arguments):
    with workspace.synthesis.download_publication(arguments.name, arguments.revision) as (_, record):
        selected = dict(record)
    return receive_synthesis_file(selected, arguments.output,
        _native_stream(lambda: workspace.synthesis.download_publication(arguments.name, arguments.revision)),
        binding={"workspace_id": workspace.identity, "publication": arguments.name,
                 "revision": arguments.revision})


def _read(owner, arguments):
    command = arguments.command
    if command == "history":
        return owner.history(kind=arguments.kind, before=arguments.before, limit=arguments.limit)
    if command == "publication":
        return owner.publication(arguments.name, revision=arguments.revision,
                                 offset=arguments.offset, limit=arguments.limit)
    if command == "protocol":
        return owner.protocol(arguments.name, revision=arguments.revision)
    if command == "review":
        return owner.review(arguments.name, revision=arguments.revision)
    if command == "result":
        return owner.result(arguments.id)
    raise StateError("ANALYSIS_SYNTHESIS_CLI_COMMAND_INVALID")


def _native(arguments, request):
    from .analysis_workspace import AnalysisWorkspace
    if arguments.command in {"cancel", "resume"}:
        raise StateError("ANALYSIS_SYNTHESIS_CLI_LIVE_OWNER_REQUIRED")
    with _signals() as (stopped, received_signal):
        workspace = None
        try:
            _need(not stopped.is_set(), "CANCELLED")
            workspace = AnalysisWorkspace(arguments.database, checkout=arguments.checkout, node=arguments.node)
            _need(not stopped.is_set(), "CANCELLED")
            owner = workspace.synthesis
            if arguments.command == "import-publication":
                result = owner.import_publication(request)
            elif arguments.command == "save-protocol":
                result = owner.save_protocol(request)
            elif arguments.command == "run":
                job = workspace.start("synthesis", request)
                job = _wait_native(workspace, job["id"], stopped)
                result = {"job": job}
                if job["status"] == "COMPLETE":
                    result["result"] = owner.result(job["id"])
                status = 0 if job["status"] == "COMPLETE" else 1
                if received_signal:
                    status = 128 + received_signal[0]
                return result, status
            elif arguments.command == "receive":
                result = _receive_native(workspace, arguments.id, arguments.output)
            elif arguments.command == "source":
                result = _source_native(workspace, arguments)
            elif arguments.command == "job":
                result = workspace.job(arguments.id)
                _need(result["kind"] == "synthesis", "ORIGINAL_SYNTHESIS_JOB_REQUIRED")
            else:
                result = _read(owner, arguments)
            return result, 128 + received_signal[0] if received_signal else 0
        finally:
            if workspace is not None:
                workspace.close()


def _live(arguments, request):
    client = WorkspaceSynthesisClient(arguments.database, workspace_id=arguments.workspace_id)
    command = arguments.command
    if command in {"import-publication", "save-protocol", "run"}:
        _need(arguments.operation is not None, "DURABLE_OPERATION_DIRECTORY_REQUIRED")
    if command == "import-publication":
        result = client.import_publication(request["raw_text"].encode("utf-8"),
            name=request["name"], expected_revision=request["expected_revision"],
            results_pointer=request["results_pointer"], source_context=request["source_context"],
            descriptor_pointer=request.get("descriptor_pointer", ""),
            operation=arguments.operation, request_id=request["id"])
    elif command == "save-protocol":
        result = client.save_protocol(name=request["name"], expected_revision=request["expected_revision"],
            publication=request["publication"], definition=request["definition"],
            operation=arguments.operation, request_id=request["id"])
    elif command == "run":
        with _signals() as (stopped, received_signal):
            _need(not stopped.is_set(), "CANCELLED")
            job = client.start(protocol_name=request["protocol_name"],
                protocol_revision=request["protocol_revision"], protocol_sha256=request["protocol_sha256"],
                operation=arguments.operation, request_id=request["id"])
            import time
            deadline = time.monotonic() + arguments.wait_seconds
            cancellation_sent = False
            while job["status"] == "RUNNING":
                if stopped.is_set() and not cancellation_sent:
                    client.cancel(job["id"])
                    cancellation_sent = True
                if not stopped.is_set() and time.monotonic() >= deadline:
                    break
                threading.Event().wait(0.2)
                job = client.job(job["id"])
            result = {"job": job}
            if job["status"] == "COMPLETE":
                result["result"] = client.result(job["id"])
            status = 0 if job["status"] in {"COMPLETE", "RUNNING"} else 1
            return result, 128 + received_signal[0] if received_signal else status
    elif command == "resume":
        result = client.resume(arguments.operation)
    elif command == "cancel":
        result = client.cancel(arguments.id)
    elif command == "job":
        result = client.job(arguments.id)
    elif command == "receive":
        result = client.receive_run(arguments.id, arguments.output)
    elif command == "source":
        result = client.receive_publication(arguments.name, arguments.revision, arguments.output)
    else:
        result = _read(client, arguments)
    return result, 0


def parser():
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--database", help="Original private Analysis database directory")
    value.add_argument("--checkout", help="Matching complete source root for the original native Analysis owner")
    value.add_argument("--node", default="node")
    value.add_argument("--live", action="store_true", help="Borrow the already running private Analysis owner")
    value.add_argument("--workspace-id", help="Require this original live workspace identity")
    value.add_argument("--operation", help="Private durable SDK request directory, reused after an uncertain reply")
    value.add_argument("--wait-seconds", type=float, default=300,
                       help="Live run wait before returning its retained RUNNING job; native run always drains")
    commands = value.add_subparsers(dest="command", required=True)
    commands.add_parser("engine", help="Show actual installed versions and required synthesis engine")
    for name in ("import-publication", "save-protocol", "run"):
        child = commands.add_parser(name)
        child.add_argument("--request", required=True, help="Retained native JSON request with its original id")
        if name == "import-publication":
            child.add_argument("--source", help="Complete original JSON bytes matching request.expected_sha256")
    history = commands.add_parser("history")
    history.add_argument("--kind", choices=("publications", "protocols", "runs"), default="protocols")
    history.add_argument("--before", type=int)
    history.add_argument("--limit", type=int, default=25)
    for name in ("publication", "protocol", "review"):
        child = commands.add_parser(name)
        child.add_argument("--name", required=True)
        child.add_argument("--revision", type=int, required=name == "review")
        if name == "publication":
            child.add_argument("--offset", type=int, default=0)
            child.add_argument("--limit", type=int, default=50)
    for name in ("job", "result", "cancel"):
        commands.add_parser(name).add_argument("--id", required=True)
    receive = commands.add_parser("receive", help="Receive every original result file with exact resumable bytes")
    receive.add_argument("--id", required=True)
    receive.add_argument("--output", required=True)
    source = commands.add_parser("source", help="Receive the complete retained publication JSON")
    source.add_argument("--name", required=True)
    source.add_argument("--revision", type=int, required=True)
    source.add_argument("--output", required=True)
    commands.add_parser("resume", help="Reconcile the same retained --live SDK operation")
    return value


def main(argv=None):
    arguments = parser().parse_args(argv)
    try:
        if arguments.command == "engine":
            result, status = engine_information(), 0
        else:
            _need(arguments.database is not None, "DATABASE_REQUIRED")
            _need(arguments.workspace_id is None or arguments.live, "LIVE_WORKSPACE_ID_REQUIRED")
            import math
            _need(math.isfinite(arguments.wait_seconds) and arguments.wait_seconds >= 0,
                  "WAIT_SECONDS_INVALID")
            if arguments.command == "resume":
                _need(arguments.live and arguments.operation is not None,
                      "DURABLE_LIVE_OPERATION_REQUIRED")
            request = _request(arguments) if arguments.command in {
                "import-publication", "save-protocol", "run"} else None
            result, status = (_live if arguments.live else _native)(arguments, request)
        print(_json(result).decode("utf-8"), flush=True)
        return status
    except BuyerError as error:
        print(_json({"error": error.code, "operation": error.operation}).decode("utf-8"),
              file=sys.stderr, flush=True)
        return 1
    except OSError as error:
        print(_json({"error": "ANALYSIS_SYNTHESIS_CLI_IO_FAILED", "errno": error.errno}).decode("utf-8"),
              file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
