"""Complete Python customer commissioning, file delivery and receiving commands."""
from __future__ import annotations

import json
from pathlib import Path
import signal

from .errors import StateError
from .research_workspace import ResearchWorkspace
from .research_customer_updates import (
    ResearchCustomerUpdates, ACTIONS, SECTIONS, PREVIEW_SECTIONS, FORMATS, _retained_json)
from .research_customer_receiving import ResearchCustomerCancelled, run_research_customer_delivery
from .storage import parse, read

_LIMIT = 16 * 1024 * 1024


def _object(file):
    value = parse(read(Path(file).expanduser().absolute(), _LIMIT))
    if not isinstance(value, dict):
        raise StateError("CUSTOMER_UPDATE_JSON_OBJECT_REQUIRED")
    return value


def _fields(value, names, required=()):
    if set(value) - set(names) or set(required) - set(value):
        raise StateError("CUSTOMER_UPDATE_FIELDS_INVALID")
    return value


def _standard(commands, name, help, *, dossier=True):
    parser = commands.add_parser(name, help=help)
    if dossier:
        parser.add_argument("--dossier", required=True)
    parser.add_argument("--output", help="Retain the complete JSON result in this new file.")
    return parser


def _paging(parser, sections):
    parser.add_argument("--revision", type=int)
    parser.add_argument("--section", choices=sections, default="overview")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=30)


def add_customer_commands(commands):
    parser = _standard(commands, "customer-list", "Read original project, brief, request, work and delivery history.")
    _paging(parser, SECTIONS)
    parser.add_argument("--project")
    parser.add_argument("--cycle")
    parser.add_argument("--query")
    parser = _standard(commands, "customer-record", "Read one exact native record and its source hash.")
    parser.add_argument("--path", required=True)
    parser.add_argument("--sha256")
    parser.add_argument("--label")
    parser.add_argument("--revision", type=int)
    parser = _standard(commands, "customer-preview", "Review an original source-bound work selection.")
    parser.add_argument("--input", required=True, help="Complete original preview input JSON.")
    parser = _standard(commands, "customer-work", "Reopen the frozen full work review.")
    parser.add_argument("--work-id", required=True)
    _paging(parser, PREVIEW_SECTIONS)
    parser = _standard(commands, "customer-plan", "Derive a source plan from an original retained Europe PMC query.")
    parser.add_argument("--input", required=True)
    parser = _standard(commands, "customer-validate", "Normalize a full request with the original native parser.")
    parser.add_argument("--input", required=True)
    parser = _standard(commands, "customer-prepare", "Select and retain an exact request for operator review.")
    parser.add_argument("--input", required=True,
                        help="action, data, actor, requestId and optional expectedRevision.")
    parser.add_argument("--file", required=True, help="Exclusive complete prepared-request destination.")
    parser = _standard(commands, "customer-submit", "Save and send exact original request bytes.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--sha256")
    parser.add_argument("--prepared", action="store_true")
    parser.add_argument("--resume", action="store_true")
    for name, description in (
            ("customer-saved", "Read the original saved Python request and attempt."),
            ("customer-recover", "Recover the same native operation and complete files."),
            ("customer-replay", "Reach the original native writer with the unchanged saved request.")):
        parser = _standard(commands, name, description)
        parser.add_argument("request_id")
        if name == "customer-replay":
            parser.add_argument("--replay-id", required=True,
                                help="A distinct durable client attempt; keeps the original native requestId.")
            parser.add_argument("--resume", action="store_true")
    parser = _standard(commands, "customer-export", "Retain a complete report, work snapshot or editable dossier.")
    selected = parser.add_mutually_exclusive_group(required=True)
    selected.add_argument("--delivery-id")
    selected.add_argument("--work-id")
    parser.add_argument("--request-id", required=True)
    parser.add_argument("--revision", type=int)
    parser.add_argument("--format", choices=FORMATS, default="json")
    parser.add_argument("--native-directory")
    parser.add_argument("--sha256")
    parser.add_argument("--file", help="Optional exclusive customer-facing copy of the full native export.")
    parser.add_argument("--resume", action="store_true")
    parser = _standard(commands, "customer-handover", "Publish all original reports, work and full editable source.")
    parser.add_argument("--request-id", required=True)
    parser.add_argument("--delivery-id", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--revision", type=int)
    parser.add_argument("--source-workspace",
                        help="Original Europe PMC library, actor and requestId selection JSON.")
    parser.add_argument("--resume", action="store_true")
    parser = _standard(commands, "customer-inspect", "Verify every selected handover member and native source history.")
    parser.add_argument("--source", required=True)
    parser.add_argument("--manifest-sha256")
    parser = _standard(commands, "customer-receive", "Receive the complete handover into this original dossier workspace.")
    parser.add_argument("--request-id", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--source-actor")
    parser.add_argument("--resume", action="store_true")
    parser = _standard(commands, "customer-operation", "Inspect retained original operation/selection/result files.")
    parser.add_argument("--native-directory", required=True)
    parser = _standard(commands, "customer-programme",
        "Continue the complete original baseline/update/receiving/correction programme.", dossier=False)
    parser.add_argument("--receiver-connection", required=True)
    parser.add_argument("--receiver-directory", required=True)
    parser.add_argument("--native-programme", required=True,
                        help="The existing native runResearchCustomerDelivery directory.")
    parser.add_argument("--case", required=True, help="That original programme's complete case.json.")
    parser.add_argument("--case-sha256")
    parser.add_argument("--request-id", required=True)
    parser.add_argument("--resume", action="store_true")


def _programme(sender, arguments):
    def stop(signum, frame):
        raise ResearchCustomerCancelled()
    previous = {kind: signal.signal(kind, stop) for kind in (signal.SIGINT, signal.SIGTERM)}
    try:
        with ResearchWorkspace(checkout=arguments.checkout, node=arguments.node,
                connection_file=arguments.receiver_connection, directory=arguments.receiver_directory,
                timeout=arguments.timeout, request_timeout_ms=arguments.request_timeout_ms) as receiver:
            return run_research_customer_delivery(sender=sender, receiver=receiver,
                directory=arguments.native_programme, case_file=arguments.case,
                expected_case_sha256=arguments.case_sha256, request_id=arguments.request_id,
                resume=arguments.resume)
    except ResearchCustomerCancelled:
        raise StateError("RESEARCH_CUSTOMER_PROGRAMME_CANCELLED") from None
    finally:
        for kind, handler in previous.items():
            signal.signal(kind, handler)


def run_customer_command(arguments):
    if not arguments.checkout or not arguments.connection:
        raise ValueError("--checkout and --connection select the original installed client; "
                         "completed file operations also work when that host is stopped")
    with ResearchWorkspace(checkout=arguments.checkout, node=arguments.node,
            connection_file=arguments.connection, directory=arguments.directory,
            timeout=arguments.timeout, request_timeout_ms=arguments.request_timeout_ms) as workspace:
        command = arguments.command
        if command == "customer-programme":
            result = _programme(workspace, arguments)
        else:
            client = ResearchCustomerUpdates(workspace, arguments.dossier)
            if command == "customer-list":
                result = client.read(section=arguments.section, revision=arguments.revision,
                    project_id=arguments.project, cycle_id=arguments.cycle, query=arguments.query,
                    offset=arguments.offset, limit=arguments.limit)
            elif command == "customer-record":
                result = client.record(arguments.path, sha256=arguments.sha256,
                    label=arguments.label, revision=arguments.revision)
            elif command == "customer-preview":
                value = _fields(_object(arguments.input), {"projectId", "cycleId", "requestEditionId",
                    "selection", "revision", "section", "offset", "limit", "fingerprint"},
                    {"projectId", "cycleId", "requestEditionId", "selection"})
                result = client.preview(project_id=value["projectId"], cycle_id=value["cycleId"],
                    request_edition_id=value["requestEditionId"], selection=value["selection"],
                    revision=value.get("revision"), section=value.get("section", "overview"),
                    offset=value.get("offset", 0), limit=value.get("limit", 30),
                    fingerprint=value.get("fingerprint"))
            elif command == "customer-work":
                result = client.work(arguments.work_id, revision=arguments.revision,
                    section=arguments.section, offset=arguments.offset, limit=arguments.limit)
            elif command == "customer-plan":
                value = _fields(_object(arguments.input), {"queryId", "queryRevision", "questionId",
                    "planId", "name", "constraints", "library"}, {"queryId", "queryRevision", "questionId", "planId"})
                result = client.europe_pmc_plan(query_id=value["queryId"], query_revision=value["queryRevision"],
                    question_id=value["questionId"], plan_id=value["planId"], name=value.get("name"),
                    constraints=value.get("constraints"), library=value.get("library"))
            elif command == "customer-validate":
                result = client.validate(_object(arguments.input))
            elif command == "customer-prepare":
                value = _fields(_object(arguments.input), {"requestId", "expectedRevision", "actor", "action", "data"},
                    {"requestId", "actor", "action", "data"})
                prepared = client.prepare(value["action"], value["data"], request_id=value["requestId"],
                    actor=value["actor"], expected_revision=value.get("expectedRevision"))
                file = client.save_prepared(prepared, arguments.file)
                result = {"prepared": prepared, "file": file.delivery}
            elif command == "customer-submit":
                if arguments.prepared:
                    if arguments.sha256:
                        from .storage import digest
                        if digest(read(Path(arguments.input).expanduser().absolute(), _LIMIT + 65536)) != arguments.sha256:
                            raise StateError("CUSTOMER_UPDATE_PREPARED_FILE_CHANGED")
                    result = client.submit_prepared(arguments.input, resume=arguments.resume)
                else:
                    result = client.submit_file(arguments.input, expected_sha256=arguments.sha256,
                                                resume=arguments.resume)
            elif command == "customer-saved":
                result = client.saved_request(arguments.request_id)
            elif command == "customer-recover":
                result = client.recover(arguments.request_id)
            elif command == "customer-replay":
                result = client.replay(arguments.request_id, replay_id=arguments.replay_id, resume=arguments.resume)
            elif command == "customer-export":
                file = client.export(request_id=arguments.request_id, delivery_id=arguments.delivery_id,
                    work_id=arguments.work_id, revision=arguments.revision, format=arguments.format,
                    directory=arguments.native_directory, expected_sha256=arguments.sha256,
                    resume=arguments.resume)
                result = file.native
                if arguments.file:
                    destination = Path(arguments.file).expanduser().absolute()
                    if destination.exists() or destination.is_symlink():
                        from .research_workspace import _file_delivery
                        with _file_delivery({**file.delivery, "file": str(destination), "path": str(destination)}).open():
                            pass
                    else:
                        file.save_as(destination)
                    result = {**result, "copy": {"file": str(destination),
                              "bytes": file.delivery["bytes"], "sha256": file.delivery["sha256"]}}
            elif command == "customer-handover":
                result = client.handover(request_id=arguments.request_id, delivery_id=arguments.delivery_id,
                    directory=arguments.target, revision=arguments.revision,
                    source_workspace=_object(arguments.source_workspace) if arguments.source_workspace else None,
                    resume=arguments.resume).inspected
            elif command == "customer-inspect":
                result = client.inspect_handover(arguments.source, manifest_sha256=arguments.manifest_sha256).inspected
            elif command == "customer-receive":
                result = client.receive_handover(arguments.source, request_id=arguments.request_id,
                    directory=arguments.target, manifest_sha256=arguments.manifest_sha256,
                    source_actor=arguments.source_actor, resume=arguments.resume)
            elif command == "customer-operation":
                result = client.operation(arguments.native_directory)
            else:
                raise StateError("CUSTOMER_UPDATE_COMMAND_INVALID")
    if arguments.output:
        path = Path(arguments.output).expanduser().absolute()
        _retained_json(path, result, limit=96 * 1024 * 1024 + 65536)
        return {"state": "SAVED", "file": str(path), "command": arguments.command}
    return result
