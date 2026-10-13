#!/usr/bin/env python3
"""Native CLI for the original retained migration workbench."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
from uuid import uuid4

from migration_store import MigrationError, basename, canonical, file_hash, parse_json, regular, sync_directory
from migration_workspace import MigrationWorkspace, schema

REQUEST_LIMIT = 16 * 1024 * 1024

def _file_path(value):
    path = Path(value).absolute()
    for part in [*reversed(path.parent.parents), path.parent]:
        if part.exists() and part.is_symlink():
            raise MigrationError("SYMLINK", "Use ordinary source and output paths")
    if path.exists() or path.is_symlink():
        regular(path)
    return path

def _read_request(path):
    if path == "-":
        raw = sys.stdin.buffer.read(REQUEST_LIMIT + 1)
    else:
        actual = _file_path(path)
        with open(actual, "rb") as handle:
            raw = handle.read(REQUEST_LIMIT + 1)
    if len(raw) > REQUEST_LIMIT:
        raise MigrationError("REQUEST_BUDGET", "Use a retained input file for original data; command JSON is limited to 16 MiB")
    try:
        result = parse_json(raw.decode("utf-8-sig"))
    except UnicodeDecodeError as exc:
        raise MigrationError("ENCODING", "Command/profile JSON must be UTF-8") from exc
    if not isinstance(result, dict):
        raise MigrationError("INVALID_PAYLOAD", "Command/profile JSON must contain an object")
    return result

def _mutation(args):
    return {"operation_id":args.operation_id,"expected_revision":args.expected_revision,"actor":args.actor}

def _stage(workspace, path, filename=None, expected_sha256=None, expected_bytes=None):
    actual = _file_path(path)
    fd = os.open(actual, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as original:
        info = os.fstat(original.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise MigrationError("SOURCE_TYPE", "Select an ordinary original file")
        return workspace.stage_file(original, filename or actual.name, expected_sha256=expected_sha256,
                                    expected_bytes=expected_bytes if expected_bytes is not None else info.st_size)

def _publish(chunks, output):
    """Create-only output, retaining failed prefixes and accepting only exact completed replay."""
    if output == "-":
        digest, count = hashlib.sha256(), 0
        for chunk in chunks:
            if not isinstance(chunk, bytes):
                raise MigrationError("OUTPUT_CONTRACT", "Native export yielded a non-binary chunk")
            sys.stdout.buffer.write(chunk)
            digest.update(chunk)
            count += len(chunk)
        sys.stdout.buffer.flush()
        return {"stdout":True,"bytes":count,"sha256":digest.hexdigest()}
    path = _file_path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / (path.name + ".partial-" + uuid4().hex)
    digest, count = hashlib.sha256(), 0
    try:
        with open(temporary, "xb") as handle:
            os.chmod(temporary, 0o600)
            for chunk in chunks:
                if not isinstance(chunk, bytes):
                    raise MigrationError("OUTPUT_CONTRACT", "Native export yielded a non-binary chunk")
                handle.write(chunk)
                digest.update(chunk)
                count += len(chunk)
            handle.flush()
            os.fsync(handle.fileno())
        wanted = {"sha256":digest.hexdigest(),"bytes":count}
        if path.exists() or path.is_symlink():
            regular(path)
            if file_hash(path) != wanted:
                raise MigrationError("OUTPUT_EXISTS", "Existing output has different bytes; both it and this new prefix are preserved",
                                     {"path":str(path),"partial":str(temporary),**wanted})
            reused = True
        else:
            os.link(temporary, path)
            reused = False
        sync_directory(path.parent)
        if file_hash(path) != wanted:
            raise MigrationError("OUTPUT_IDENTITY", "Published output did not retain its complete native bytes",
                                 {"path":str(path),"partial":str(temporary)})
        temporary.unlink()
        sync_directory(path.parent)
        return {"path":str(path),**wanted,"reused":reused}
    except BaseException as exc:
        if isinstance(exc, MigrationError):
            raise
        raise MigrationError("OUTPUT_INTERRUPTED", "Native output is incomplete; any owned partial remains available",
                             {"path":str(path),"partial":str(temporary),"written_bytes":count,"error":str(exc)}) from exc

def _binary_chunks(handle):
    while True:
        chunk = handle.read(1024 * 1024)
        if not chunk:
            return
        yield chunk

def _envelope_parser(parser):
    parser.add_argument("--operation-id", required=True, help="Stable original operation ID; reuse only for exactly the same semantic request")
    parser.add_argument("--expected-revision", required=True, type=int, help="Exact reviewed workspace revision")
    parser.add_argument("--actor", required=True, help="Recorded operator identity")

def parser():
    root = argparse.ArgumentParser(description="Retained file-share migration evidence, reviewed mappings and incremental rounds")
    root.add_argument("--workspace", help="Original workspace directory; required except schema and portable inspection/receiving")
    commands = root.add_subparsers(dest="command", required=True)
    new = commands.add_parser("create", help="Create one new original SQLite workspace")
    new.add_argument("--title", default="Migration workbench")
    commands.add_parser("schema", help="Print the exact installed API and accepted original input profiles")
    commands.add_parser("state", help="Print bounded current summaries and actual revision")
    stage = commands.add_parser("stage", help="Retain a complete original file without interpreting it")
    stage.add_argument("file")
    stage.add_argument("--filename")
    stage.add_argument("--sha256")
    stage.add_argument("--bytes", type=int)
    ingest = commands.add_parser("import-source", help="Stage an original file and execute its explicit report/inventory profile")
    ingest.add_argument("file")
    ingest.add_argument("--profile", required=True, help="UTF-8 JSON with format/context and optional explicit column maps")
    ingest.add_argument("--filename")
    ingest.add_argument("--sha256")
    ingest.add_argument("--bytes", type=int)
    _envelope_parser(ingest)
    command = commands.add_parser("command", help="Invoke any exact advertised read or mutation")
    command.add_argument("operation")
    command.add_argument("--payload", help="Complete UTF-8 JSON object path, or - for stdin; reads default to {}")
    resume = commands.add_parser("resume", help="Continue one original interrupted local operation without replacing it")
    resume.add_argument("target_operation_id")
    resume.add_argument("--reason", required=True)
    _envelope_parser(resume)
    export = commands.add_parser("export", help="Stream complete retained rows/findings or a reviewed principal map")
    export.add_argument("kind", choices=("source","reconciliation","mapping","case.dataset","case.plan","case.rehearsal","case.review","case.cutover"))
    export.add_argument("id")
    export.add_argument("--format", choices=("ndjson","csv"), default="ndjson")
    export.add_argument("--out", required=True, help="Create-only output file, or - for binary stdout")
    raw = commands.add_parser("file", help="Read back exact original object bytes through their retained digest")
    raw.add_argument("sha256")
    raw.add_argument("--out", required=True)
    backup = commands.add_parser("snapshot", help="Create a complete SQLite snapshot; portable delivery also includes its object/source closure")
    backup.add_argument("--out", required=True)
    inspect = commands.add_parser("inspect-delivery", help="Verify a whole original delivery before receiving")
    inspect.add_argument("archive")
    receive = commands.add_parser("receive", help="Restore the original SQLite/object/application delivery into its selected destination")
    receive.add_argument("archive")
    receive.add_argument("--into", required=True)
    receive.add_argument("--sha256", help="Optional independently retained full archive digest")
    receive.add_argument("--bytes", type=int, help="Optional independently retained full archive byte length")
    case = commands.add_parser("case", help="Original case/document projection, policy, rehearsal, review and cutover")
    case_commands = case.add_subparsers(dest="case_command", required=True)
    case_commands.add_parser("schema", help="Exact installed case field/action contract")
    case_list = case_commands.add_parser("list", help="One explicit page of original case editions")
    case_list.add_argument("kind", choices=("dataset","plan","rehearsal","review","cutover"))
    case_list.add_argument("--offset", type=int, default=0)
    case_list.add_argument("--limit", type=int, default=100)
    case_list.add_argument("--query")
    case_get = case_commands.add_parser("get", help="Complete immutable selected case edition")
    case_get.add_argument("kind", choices=("dataset","plan","rehearsal","review","cutover"))
    case_get.add_argument("id")
    case_preview = case_commands.add_parser("preview", help="Read-only explicit original field/value projection")
    case_preview.add_argument("--payload", required=True)
    case_create = case_commands.add_parser("create", help="Invoke an exact reviewed case mutation through the original operation")
    case_create.add_argument("kind", choices=("dataset","plan","rehearsal","review","cutover"))
    case_create.add_argument("--payload", required=True, help="Whole JSON object including the original operation envelope")
    report = commands.add_parser("report", help="Publish a complete read-only review and all original record exports")
    report.add_argument("--out", required=True, help="Original selected ordinary report directory")
    report.add_argument("--expected-revision", type=int, required=True)
    report.add_argument("--title", default="Migration workbench review")
    report.add_argument("--note", default="")
    deliver = commands.add_parser("prepare-delivery", help="Freeze the complete original workspace, objects, reports and application")
    _envelope_parser(deliver)
    deliver.add_argument("--title", default="Migration workbench handover")
    deliver.add_argument("--note", default="")
    delivery_file = commands.add_parser("delivery-file", help="Download the entire selected original prepared archive")
    delivery_file.add_argument("id")
    delivery_file.add_argument("--out", required=True)
    return root

def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "schema":
            result = schema()
        elif args.command in ("inspect-delivery","receive"):
            from migration_portable import inspect_delivery, receive_delivery
            original = _file_path(args.archive)
            if args.command=="inspect-delivery":
                result = inspect_delivery(original,verify=True)
            else:
                actual = file_hash(original)
                if (args.sha256 is not None and args.sha256!=actual["sha256"]) or (args.bytes is not None and args.bytes!=actual["bytes"]):
                    raise MigrationError("FILE_IDENTITY", "Selected delivery differs from the retained expected identity", actual)
                result = receive_delivery(original,args.into)
        else:
            if not args.workspace:
                raise MigrationError("WORKSPACE_REQUIRED", "Choose the original --workspace")
            with MigrationWorkspace(args.workspace, create=args.command=="create",
                                    title=getattr(args,"title","Migration workbench")) as workspace:
                if args.command == "create":
                    result = workspace.project
                elif args.command == "state":
                    result = workspace.dispatch("state",{})
                elif args.command == "stage":
                    result = _stage(workspace,args.file,args.filename,args.sha256,args.bytes)
                elif args.command == "import-source":
                    profile = _read_request(args.profile)
                    if set(profile)-{"format","context","columns","header_mapping","column_mapping_note"}:
                        raise MigrationError("IMPORT_PROFILE", "Profile must contain only original format/context and explicit column mapping fields")
                    original = _stage(workspace,args.file,args.filename,args.sha256,args.bytes)
                    payload = {**profile,**_mutation(args),"file_sha256":original["sha256"],
                               "bytes":original["bytes"],"filename":original["filename"]}
                    result = workspace.dispatch("source.import",payload)
                elif args.command == "command":
                    payload = _read_request(args.payload) if args.payload else {}
                    result = workspace.dispatch(args.operation,payload)
                elif args.command == "resume":
                    result = workspace.dispatch("operation.resume",{**_mutation(args),"target_operation_id":args.target_operation_id,"reason":args.reason})
                elif args.command == "export":
                    result = _publish(workspace.iter_export(args.kind,args.id,format=args.format),args.out)
                elif args.command == "file":
                    with workspace.open_file(args.sha256) as original:
                        result = _publish(_binary_chunks(original),args.out)
                elif args.command == "snapshot":
                    result = workspace.backup_to(args.out)
                elif args.command == "case":
                    if args.case_command == "schema":
                        result = workspace.dispatch("case.schema", {})
                    elif args.case_command == "list":
                        payload = {"kind":args.kind, "offset":args.offset, "limit":args.limit}
                        if args.query is not None:
                            payload["query"] = args.query
                        result = workspace.dispatch("case.list", payload)
                    elif args.case_command == "get":
                        result = workspace.dispatch("case." + args.kind + ".get", {"id":args.id})
                    elif args.case_command == "preview":
                        result = workspace.dispatch("case.dataset.preview", _read_request(args.payload))
                    else:
                        result = workspace.dispatch("case." + args.kind + ".create", _read_request(args.payload))
                elif args.command == "report":
                    from migration_reports import build_reports
                    from migration_portable import ordinary_directory, file_description, publish_bytes, canonical as portable_json
                    directory = ordinary_directory(args.out, create=True)
                    with workspace._mutex:
                        if workspace.project["revision"] != args.expected_revision:
                            raise MigrationError("REVISION_CONFLICT", "Retain the exact reviewed report revision",
                                                 {"actual_revision":workspace.project["revision"]})
                        names = build_reports(workspace, directory, source_revision=args.expected_revision,
                                              title=args.title, note=args.note)
                        result = {"schema":"commons.case-migration-report/v1",
                                  "workspace_id":workspace.project["id"], "revision":args.expected_revision,
                                  "title":args.title, "note":args.note,
                                  "files":[file_description(directory / name, name) for name in names]}
                        publish_bytes(directory / "REPORT.json", portable_json(result))
                elif args.command == "prepare-delivery":
                    result = workspace.dispatch("delivery.prepare", {**_mutation(args),
                        "title":args.title, "note":args.note})
                elif args.command == "delivery-file":
                    from migration_portable import PortableService
                    service = PortableService(workspace, workspace.root, Path(__file__).parent)
                    record, handle = service.open_delivery(args.id)
                    with handle:
                        output = _publish(_binary_chunks(handle), args.out)
                    result = {**output, "delivery":record}

                else:
                    raise MigrationError("UNKNOWN_COMMAND", "Unknown native command")
        stream = sys.stderr if isinstance(result,dict) and result.get("stdout") else sys.stdout
        stream.write(canonical(result)+"\n")
        stream.flush()
        return 0
    except MigrationError as exc:
        sys.stderr.write(canonical({"ok":False,"error":exc.as_dict()})+"\n")
        return 2
    except (OSError, ValueError) as exc:
        sys.stderr.write(canonical({"ok":False,"error":{"code":type(exc).__name__,"message":str(exc)}})+"\n")
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
