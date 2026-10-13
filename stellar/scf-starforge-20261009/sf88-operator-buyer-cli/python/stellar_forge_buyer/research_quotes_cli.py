"""Installed commands for complete original Research customer quotations."""
from __future__ import annotations

from pathlib import Path
import signal
import threading

from .errors import StateError
from .research_workspace import ResearchWorkspace, _file_delivery
from .research_customer_updates import _retained_json
from .research_quotes import (
    ResearchQuoteBundle, ResearchQuoteExport, COMMANDS, CASE_ACTIONS, PRICING_ACTIONS,
    KINDS, _object, _INPUT_LIMIT, _FILE_LIMIT,
)
from .storage import digest, read


def _standard(commands, name, description):
    parser = commands.add_parser(name, help=description)
    parser.add_argument("--output", help="Retain the complete JSON reply in this file.")
    return parser


def _input(parser):
    parser.add_argument("--input", required=True, help="Complete original JSON input; its raw bytes are retained.")
    parser.add_argument("--input-sha256")


def _operation_id(parser):
    parser.add_argument("--id", required=True, help="Original quotation operation UUID.")


def add_quotes_commands(commands):
    _standard(commands, "quotes-configuration", "Inspect the original cases, pricing and merchant selections.")
    parser = _standard(commands, "quotes-cases", "Read one original commercial case page.")
    parser.add_argument("--q")
    parser.add_argument("--status")
    parser.add_argument("--due-on")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=50)
    parser = _standard(commands, "quotes-case", "Open the full original selected case and quote history.")
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--revision")
    parser = _standard(commands, "quotes-list", "Read the original snapshot-bound quotation operation page.")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--snapshot")
    parser.add_argument("--dossier-id")
    parser.add_argument("--kind", choices=KINDS)
    for name in ("quotes-operation", "quotes-files", "quotes-file-info"):
        parser = _standard(commands, name, "Read the complete original operation or its file metadata.")
        _operation_id(parser)
        if name == "quotes-file-info":
            parser.add_argument("--name", required=True)
    parser = _standard(commands, "quotes-case-file-info", "Review the original selected case or tariff file.")
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--tariff", action="store_true")
    _input(parser)

    for command in COMMANDS:
        parser = _standard(commands, "quotes-" + command, "Retain and submit one complete original native request.")
        _input(parser)
        parser.add_argument("--call-id", required=True, help="Stable Python call ID; the native UUID remains in --input.")
        parser.add_argument("--resume", action="store_true")
        if command == "native-case":
            parser.add_argument("--case-id", required=True)
            parser.add_argument("--action", choices=CASE_ACTIONS, required=True)
        elif command == "pricing":
            parser.add_argument("--profile", required=True)
            parser.add_argument("--action", choices=PRICING_ACTIONS, required=True)

    parser = _standard(commands, "quotes-export-operation", "Retain every complete file in one original operation.")
    _operation_id(parser)
    parser.add_argument("--operation-sha256")
    parser.add_argument("--call-id", required=True)
    parser.add_argument("--resume", action="store_true")
    for name in ("quotes-export-case", "quotes-export-tariff"):
        parser = _standard(commands, name, "Retain the original selected revision and full commercial file.")
        parser.add_argument("--case-id", required=True)
        _input(parser)
        parser.add_argument("--sha256")
        parser.add_argument("--bytes", type=int)
        parser.add_argument("--call-id", required=True)
        parser.add_argument("--resume", action="store_true")
    parser = _standard(commands, "quotes-download", "Receive one complete original file under its exact metadata promise.")
    _operation_id(parser)
    parser.add_argument("--name", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--bytes", type=int, required=True)
    parser.add_argument("--call-id", required=True)
    parser.add_argument("--file", help="Optional exclusive complete copy of the received file.")
    parser.add_argument("--resume", action="store_true")
    parser = _standard(commands, "quotes-copy-export", "Copy a complete native export into a portable receiving directory.")
    parser.add_argument("call_id")
    parser.add_argument("--target", required=True)
    parser.add_argument("--copy-id", required=True)
    parser.add_argument("--resume", action="store_true")
    for name, help_text in (
            ("quotes-saved", "Read and verify the first completed local result."),
            ("quotes-resume", "Recover the same durable call and original native request."),
            ("quotes-run-inspect", "Read the original operator input, selection, attempts and files.")):
        parser = _standard(commands, name, help_text)
        parser.add_argument("call_id")
    parser = _standard(commands, "quotes-replay", "Submit the original request in a distinct saved local attempt.")
    parser.add_argument("call_id")
    parser.add_argument("--replay-id", required=True)
    for name, help_text in (
            ("quotes-bundle-inspect", "Verify the complete portable bundle in --directory, with no host or Node."),
            ("quotes-bundle-file", "Copy one original bundle file after complete receiving verification.")):
        parser = _standard(commands, name, help_text)
        parser.add_argument("--manifest-sha256", required=True)
        if name == "quotes-bundle-file":
            parser.add_argument("--name", required=True)
            parser.add_argument("--file", required=True)


def _input_object(arguments):
    body = read(Path(arguments.input).expanduser().absolute(), _INPUT_LIMIT)
    if arguments.input_sha256 is not None and digest(body) != arguments.input_sha256:
        raise StateError("RESEARCH_QUOTE_RETAINED_INPUT_CHANGED")
    return _object(body)


def _copy_file(file, destination):
    target = Path(destination).expanduser().absolute()
    if target.exists() or target.is_symlink():
        with _file_delivery({**file.delivery, "file": str(target), "path": str(target)}).open():
            pass
    else:
        file.save_as(target)
    return {"file": str(target), "bytes": file.delivery["bytes"], "sha256": file.delivery["sha256"]}


def run_quotes_command(arguments):
    command = arguments.command
    if command in {"quotes-bundle-inspect", "quotes-bundle-file"}:
        bundle = ResearchQuoteBundle.reopen(arguments.directory,
            expected_manifest_sha256=arguments.manifest_sha256)
        result = ({"manifest": bundle.manifest, "receiving": bundle.verify()}
                  if command == "quotes-bundle-inspect" else
                  _copy_file(bundle.file(arguments.name), arguments.file))
    else:
        if not arguments.checkout:
            raise ValueError("--checkout selects the original installed Node runtime")
        event, previous = threading.Event(), {}
        if threading.current_thread() is threading.main_thread():
            for kind in (signal.SIGINT, signal.SIGTERM):
                previous[kind] = signal.signal(kind, lambda *_: event.set())
        try:
            with ResearchWorkspace(checkout=arguments.checkout, node=arguments.node,
                    connection_file=arguments.connection, directory=arguments.directory,
                    timeout=arguments.timeout, request_timeout_ms=arguments.request_timeout_ms) as workspace:
                client, options = workspace.quotes(), {"cancel_event": event}
                if command == "quotes-configuration":
                    result = client.configuration(**options)
                elif command == "quotes-cases":
                    result = client.cases(q=arguments.q, status=arguments.status, due_on=arguments.due_on,
                                          offset=arguments.offset, limit=arguments.limit, **options)
                elif command == "quotes-case":
                    result = client.case(arguments.case_id, revision=arguments.revision, **options)
                elif command == "quotes-list":
                    result = client.list(offset=arguments.offset, limit=arguments.limit,
                        snapshot=arguments.snapshot, dossier_id=arguments.dossier_id, kind=arguments.kind, **options)
                elif command == "quotes-operation":
                    result = client.operation(arguments.id, **options)
                elif command == "quotes-files":
                    result = client.files(arguments.id, **options)
                elif command == "quotes-file-info":
                    result = client.file_info(arguments.id, arguments.name, **options)
                elif command == "quotes-case-file-info":
                    result = client.case_file_info(arguments.case_id, _input_object(arguments),
                                                   tariff=arguments.tariff, **options)
                elif command.removeprefix("quotes-") in COMMANDS:
                    result = client.submit_file(command.removeprefix("quotes-"), arguments.input,
                        call_id=arguments.call_id, expected_input_sha256=arguments.input_sha256,
                        case_id=getattr(arguments, "case_id", None), action=getattr(arguments, "action", None),
                        profile=getattr(arguments, "profile", None), resume=arguments.resume, **options)
                elif command == "quotes-export-operation":
                    result = client.export_operation(arguments.id, call_id=arguments.call_id,
                        expected_operation_sha256=arguments.operation_sha256, resume=arguments.resume, **options)
                elif command in {"quotes-export-case", "quotes-export-tariff"}:
                    result = client.export_case(arguments.case_id, input_file=arguments.input,
                        call_id=arguments.call_id, expected_input_sha256=arguments.input_sha256,
                        expected_sha256=arguments.sha256, expected_bytes=arguments.bytes,
                        tariff=command == "quotes-export-tariff", resume=arguments.resume, **options)
                elif command == "quotes-download":
                    result = client.download(arguments.id, arguments.name, call_id=arguments.call_id,
                        expected_sha256=arguments.sha256, expected_bytes=arguments.bytes,
                        resume=arguments.resume, **options)
                    if arguments.file:
                        result = {**result, "copy": _copy_file(client.downloaded_file(result), arguments.file)}
                elif command == "quotes-copy-export":
                    result = client.copy_export(arguments.call_id, arguments.target, copy_id=arguments.copy_id,
                                                 resume=arguments.resume, **options)
                elif command == "quotes-saved":
                    result = client.saved(arguments.call_id)
                elif command == "quotes-resume":
                    result = client.recover(arguments.call_id, **options)
                elif command == "quotes-replay":
                    result = client.replay(arguments.call_id, replay_id=arguments.replay_id, **options)
                elif command == "quotes-run-inspect":
                    result = client.inspect_run(arguments.call_id, **options)
                else:
                    raise StateError("RESEARCH_QUOTES_COMMAND_INVALID")
        finally:
            for kind, handler in previous.items():
                signal.signal(kind, handler)
    if arguments.output:
        path = Path(arguments.output).expanduser().absolute()
        _retained_json(path, result, limit=_FILE_LIMIT)
        return {"state": "SAVED", "file": str(path), "command": command}
    return result


def main(argv=None):
    from .research_cli import main as research_main
    return research_main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
