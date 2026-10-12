"""Installed commands for the full native paid Research delivery journey."""
from __future__ import annotations

from pathlib import Path
import signal
import threading

from .errors import StateError
from .research_workspace import ResearchWorkspace, _file_delivery
from .research_customer_updates import _retained_json
from .research_commerce import (
    ResearchCommerceArchive, NATIVE_WRITES, COLLECTIONS, FILE_PARTS,
)
from .storage import digest, parse, read

_LIMIT = 2 * 1024 * 1024
_RESPONSE_LIMIT = 66 * 1024 * 1024 + 65536


def _object(path, sha256=None):
    body = read(Path(path).expanduser().absolute(), _LIMIT)
    if sha256 is not None and digest(body) != sha256:
        raise StateError("RESEARCH_COMMERCE_INPUT_FILE_CHANGED")
    value = parse(body)
    if not isinstance(value, dict):
        raise StateError("RESEARCH_COMMERCE_JSON_OBJECT_REQUIRED")
    return value


def _standard(commands, name, description):
    parser = commands.add_parser(name, help=description)
    parser.add_argument("--output", help="Save the complete immutable JSON reply in this file.")
    return parser


def _selected(parser, *, kind=True, part=False):
    if kind:
        parser.add_argument("--kind", choices=COLLECTIONS, required=True)
    parser.add_argument("--id", required=True)
    if part:
        parser.add_argument("--part", choices=FILE_PARTS, required=True)


def add_commerce_commands(commands):
    _standard(commands, "commerce-configuration", "Inspect original declared merchant and Buyer selections.")
    parser = _standard(commands, "commerce-list", "Read an exact native collection page.")
    parser.add_argument("--kind", choices=COLLECTIONS, required=True)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--snapshot")
    for name in ("commerce-publication", "commerce-purchase"):
        parser = _standard(commands, name, "Open the full original native publication or acquisition.")
        _selected(parser, kind=False)
        if name == "commerce-purchase":
            parser.add_argument("--refresh", action="store_true")
    parser = _standard(commands, "commerce-file", "Read original complete file metadata.")
    _selected(parser, part=True)
    for name in NATIVE_WRITES:
        parser = _standard(commands, name, "Retain and submit this complete original native request.")
        if name == "commerce-purchase-receive":
            source = parser.add_mutually_exclusive_group(required=True)
            source.add_argument("--input", help="Full original requestId/buyer/filename/base64 input.")
            source.add_argument("--publication-file", help="Exact original public publication JSON.")
            parser.add_argument("--buyer")
            parser.add_argument("--request-id")
            parser.add_argument("--publication-sha256")
        else:
            parser.add_argument("--input", required=True)
        parser.add_argument("--input-sha256")
        parser.add_argument("--call-id", help="Stable local attempt identity; native UUID remains in the input.")
        parser.add_argument("--resume", action="store_true")
    parser = _standard(commands, "commerce-export", "Download and retain the entire selected original file.")
    _selected(parser, part=True)
    parser.add_argument("--call-id", required=True)
    parser.add_argument("--sha256")
    parser.add_argument("--file", help="Optional complete exclusive copy of the retained native export.")
    parser.add_argument("--resume", action="store_true")
    for name, description in (
            ("commerce-saved", "Read the first complete saved local result without a native call."),
            ("commerce-resume", "Continue the same durable native attempt and original input."),
            ("commerce-operation", "Inspect the original operator records for one saved Python call.")):
        parser = _standard(commands, name, description)
        parser.add_argument("call_id")
    parser = _standard(commands, "commerce-replay", "Submit the original native request in a separate durable attempt.")
    parser.add_argument("call_id")
    parser.add_argument("--replay-id", required=True)
    parser = _standard(commands, "commerce-archive-inspect", "Inspect the entire original compressed handover.")
    parser.add_argument("--file", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--bytes", type=int, required=True)
    parser = _standard(commands, "commerce-archive-receive", "Receive every original archive member locally.")
    parser.add_argument("--file", help="Original archive; an existing retained receive can omit it.")
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--bytes", type=int, required=True)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--call-id", required=True)
    parser.add_argument("--target", help="Original native receiving directory; defaults inside the saved Python call.")
    parser.add_argument("--resume", action="store_true")


def _copy_export(client, result, file):
    saved = client.exported_file(result)
    destination = Path(file).expanduser().absolute()
    if destination.exists() or destination.is_symlink():
        with _file_delivery({**saved.delivery, "file": str(destination), "path": str(destination)}).open():
            pass
    else:
        saved.save_as(destination)
    return {"file": str(destination), "bytes": saved.delivery["bytes"], "sha256": saved.delivery["sha256"]}


def run_commerce_command(arguments):
    if not arguments.checkout:
        raise ValueError("--checkout selects the original installed Node runtime")
    # A local archive receive or a completed call can operate without a host.
    # A live native action resolves the actual optional --connection itself.
    event = threading.Event()
    previous = {}
    if threading.current_thread() is threading.main_thread():
        for kind in (signal.SIGINT, signal.SIGTERM):
            previous[kind] = signal.signal(kind, lambda *_: event.set())
    try:
        with ResearchWorkspace(checkout=arguments.checkout, node=arguments.node,
                connection_file=arguments.connection, directory=arguments.directory,
                timeout=arguments.timeout, request_timeout_ms=arguments.request_timeout_ms) as workspace:
            client, command = workspace.commerce(), arguments.command
            options = {"cancel_event": event}
            if command == "commerce-configuration":
                result = client.configuration(**options)
            elif command == "commerce-list":
                result = client.list(arguments.kind, offset=arguments.offset, limit=arguments.limit,
                                     snapshot=arguments.snapshot, **options)
            elif command == "commerce-publication":
                result = client.publication(arguments.id, **options)
            elif command == "commerce-purchase":
                result = client.purchase(arguments.id, refresh=arguments.refresh, **options)
            elif command == "commerce-file":
                result = client.file(arguments.kind, arguments.id, arguments.part, **options)
            elif command in NATIVE_WRITES:
                if command == "commerce-purchase-receive" and arguments.publication_file:
                    if not arguments.buyer or not arguments.request_id:
                        raise ValueError("--buyer and --request-id are required with --publication-file")
                    result = client.receive_publication_file(arguments.publication_file,
                        buyer=arguments.buyer, request_id=arguments.request_id,
                        call_id=arguments.call_id, expected_sha256=arguments.publication_sha256,
                        resume=arguments.resume, **options)
                else:
                    result = client.submit(command, _object(arguments.input, arguments.input_sha256),
                        call_id=arguments.call_id, resume=arguments.resume, **options)
            elif command == "commerce-export":
                result = client.export(arguments.kind, arguments.id, arguments.part,
                    call_id=arguments.call_id, expected_sha256=arguments.sha256,
                    resume=arguments.resume, **options)
                if arguments.file:
                    result = {**result, "copy": _copy_export(client, result, arguments.file)}
            elif command == "commerce-saved":
                result = client.saved(arguments.call_id)
            elif command == "commerce-resume":
                result = client.recover(arguments.call_id, **options)
            elif command == "commerce-replay":
                result = client.replay(arguments.call_id, replay_id=arguments.replay_id, **options)
            elif command == "commerce-operation":
                result = client.operation(arguments.call_id, **options)
            elif command == "commerce-archive-inspect":
                result = client.inspect_archive(arguments.file,
                    expected_sha256=arguments.sha256, expected_bytes=arguments.bytes, **options)
            elif command == "commerce-archive-receive":
                result = client.receive_archive(path=arguments.file, directory=arguments.target,
                    expected_sha256=arguments.sha256, expected_bytes=arguments.bytes,
                    manifest_sha256=arguments.manifest_sha256, call_id=arguments.call_id,
                    resume=arguments.resume, **options)
                ResearchCommerceArchive(result)
            else:
                raise StateError("RESEARCH_COMMERCE_COMMAND_INVALID")
    finally:
        for kind, handler in previous.items():
            signal.signal(kind, handler)
    if arguments.output:
        path = Path(arguments.output).expanduser().absolute()
        _retained_json(path, result, limit=_RESPONSE_LIMIT)
        return {"state": "SAVED", "file": str(path), "command": arguments.command}
    return result
