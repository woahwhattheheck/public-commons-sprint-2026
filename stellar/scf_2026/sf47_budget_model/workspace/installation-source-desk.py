#!/usr/bin/env python3
"""Operate the complete Source Preparation Desk in an existing SF47 workspace.

Stop that workspace's local server before opening this terminal interface. This
uses the original Workspace lease, connection, SourceDesk and request journal.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import uuid

from model import Workspace, Problem
from operations import Operations
from operations_installation_sources import SourceDesk, MAX_FILE, MAX_ZIP, json_bytes
from installation_source_desk_client import InstallationSourceDeskClient, prepare_upload, receiving_selection

MAX_REQUEST = 32 * 1024 * 1024


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read_file(path, limit=MAX_REQUEST):
    path = Path(path).expanduser().absolute()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise ValueError("Select one complete bounded regular file.")
        chunks, size = [], 0
        while True:
            chunk = os.read(fd, min(262144, limit - size + 1))
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                raise ValueError("The complete original input exceeded its bound.")
            chunks.append(chunk)
        after, named = os.fstat(fd), os.lstat(path)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) or (
                named.st_dev, named.st_ino) != (before.st_dev, before.st_ino) or size != before.st_size:
            raise ValueError("The complete original file changed during its read.")
        return b"".join(chunks)
    finally:
        os.close(fd)


def object_file(path):
    value = json.loads(read_file(path))
    if not isinstance(value, dict):
        raise ValueError("Keep the complete original JSON object.")
    return value


def sync_parent(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def publish(path, raw):
    path = Path(path).expanduser().absolute()
    if not isinstance(raw, bytes) or len(raw) > MAX_ZIP:
        raise ValueError("Keep one complete bounded native output.")
    parent = path.parent
    info = os.lstat(parent)
    if not stat.S_ISDIR(info.st_mode) or parent.resolve() != parent:
        raise ValueError("Select an existing canonical output directory.")
    try:
        original = read_file(path, MAX_ZIP)
    except FileNotFoundError:
        original = None
    if original is not None:
        if original != raw:
            raise ValueError("The existing complete output differs. Retain it and choose a distinct receiving path.")
        sync_parent(parent)
    else:
        temporary = parent / ("." + path.name + ".source-desk-" + uuid.uuid4().hex)
        fd = None
        try:
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            view = memoryview(raw)
            while view:
                count = os.write(fd, view)
                if count <= 0:
                    raise OSError("Complete output write did not advance.")
                view = view[count:]
            os.fsync(fd)
            os.close(fd)
            fd = None
            try:
                os.link(temporary, path, follow_symlinks=False)
            except FileExistsError:
                if read_file(path, MAX_ZIP) != raw:
                    raise ValueError("An existing original output differs.")
            sync_parent(parent)
        finally:
            if fd is not None:
                os.close(fd)
            try:
                os.unlink(temporary)
                sync_parent(parent)
            except FileNotFoundError:
                pass
    retained = read_file(path, MAX_ZIP)
    if retained != raw:
        raise ValueError("The complete published output did not reopen byte-exactly.")
    return {"path": str(path), "filename": path.name, "bytes": len(raw), "sha256": sha(raw)}


def execute(desk, args):
    case, draft = args.case, getattr(args, "draft", None)
    if args.command in ("prepare-command", "prepare-upload", "archive-inspect",
                         "archive-receive-prepare", "commissioning-inspect",
                         "commissioning-preview", "commissioning-attach-prepare",
                         "execute-prepared", "reconcile-prepared"):
        client = InstallationSourceDeskClient(desk, case, draft,
                    workspace_directory=str(args.workspace.expanduser().absolute()))
        if args.command == "prepare-command":
            return client.prepare_command(object_file(args.request)), None
        if args.command == "prepare-upload":
            raw = read_file(args.file, MAX_FILE)
            value = prepare_upload(case, draft, raw,
                filename=args.filename or args.file.name, source_url=args.source_url,
                observed_at=args.observed_at, expected_revision=args.revision,
                actor=args.actor, request_id=args.request_id, note=args.note,
                media_type=args.media_type, workspace_directory=client.workspace_directory)
            return value, None
        if args.command == "archive-inspect":
            return client.archive_inspect(args.archive_file_id, args.revision, args.replace_file_id), None
        if args.command in ("archive-receive-prepare", "commissioning-attach-prepare"):
            action = ("commissioning.archive.receive" if args.command == "archive-receive-prepare"
                      else "commissioning.attach")
            return client.prepare_review(object_file(args.preview), action,
                actor=args.actor, request_id=args.request_id, note=args.note), None
        if args.command == "commissioning-inspect":
            selection = (receiving_selection(object_file(args.receiving_receipt), case_id=case, draft_id=draft)
                         if args.receiving_receipt else object_file(args.selection))
            return client.commissioning_inspect(selection), None
        if args.command == "commissioning-preview":
            return client.commissioning_preview(object_file(args.selection)), None
        operation = object_file(args.operation)
        if args.command == "execute-prepared":
            return client.execute(operation), None
        return client.reconcile(operation), None
    if args.command == "profiles":
        return desk.profiles(), None
    if args.command == "list":
        return desk.list(case), None
    if args.command == "read":
        return desk.get(case, draft, args.revision), None
    if args.command == "inspect":
        amendment = object_file(args.amendment) if args.amendment else None
        return desk.inspect(case, draft, args.file_id, args.revision, amendment), None
    if args.command == "command":
        return desk.command(case, draft, object_file(args.request)), None
    if args.command == "status":
        return desk.request(case, draft, args.request_id), None
    if args.command == "preparation":
        return desk.preparation(case, draft, args.preparation), None
    if args.command == "file":
        metadata, raw = desk.file(case, draft, args.file_id, args.revision)
    elif args.command == "output":
        metadata, raw = desk.output(case, draft, args.preparation, args.filename)
    elif args.command in ("export", "archive-description"):
        raw = desk.export(case, draft, args.preparation)
        metadata = {"filename": args.preparation + ".zip", "bytes": len(raw), "sha256": sha(raw),
                    "mediaType": "application/zip", "preparationId": args.preparation,
                    "caseId": case, "draftId": draft}
        if args.command == "archive-description":
            return metadata, None
    else:
        raise ValueError("Select a supported complete Source Desk operation.")
    if metadata["sha256"] != args.expected_sha256 or len(raw) != metadata["bytes"] or sha(raw) != metadata["sha256"]:
        raise ValueError("Keep the download bound to its original complete expected SHA-256.")
    return metadata, raw


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--scenario", type=Path, default=Path(__file__).resolve().parent.parent / "sf10_current_candidate.json")
    parser.add_argument("--case", help="Original operation-… case; required except for profiles")
    parser.add_argument("--out", required=True, type=Path, help="Complete create-only JSON or binary output")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("profiles")
    sub.add_parser("list")
    for name in ("read", "inspect", "command", "status", "file", "preparation", "output", "export", "archive-description"):
        command = sub.add_parser(name)
        command.add_argument("--draft", required=True)
        if name in ("read", "inspect", "file"):
            command.add_argument("--revision", type=int)
        if name in ("inspect", "file"):
            command.add_argument("--file-id", required=True)
        if name == "inspect":
            command.add_argument("--amendment", type=Path)
        if name == "command":
            command.add_argument("--request", required=True, type=Path, help="Exact complete original command JSON")
        if name == "status":
            command.add_argument("--request-id", required=True)
        if name in ("preparation", "output", "export", "archive-description"):
            command.add_argument("--preparation", required=True)
        if name == "output":
            command.add_argument("--filename", required=True)
        if name in ("file", "output", "export"):
            command.add_argument("--expected-sha256", required=True)
    for name in ("prepare-command", "prepare-upload", "archive-inspect",
                 "archive-receive-prepare", "commissioning-inspect",
                 "commissioning-preview", "commissioning-attach-prepare",
                 "execute-prepared", "reconcile-prepared"):
        command = sub.add_parser(name)
        command.add_argument("--draft", required=True)
        if name == "prepare-command":
            command.add_argument("--request", required=True, type=Path,
                                 help="Complete original command body, including its request ID")
        if name == "prepare-upload":
            command.add_argument("--file", required=True, type=Path,
                                 help="One complete original file of at most 8 MiB")
            command.add_argument("--filename", help="Exact native receiving filename; defaults to original basename")
            command.add_argument("--source-url", required=True, help="Original source provenance URL")
            command.add_argument("--observed-at", required=True, help="Actual original observation timestamp")
            command.add_argument("--media-type", default="application/x-tar")
        if name in ("prepare-upload", "archive-inspect"):
            command.add_argument("--revision", required=True, type=int)
        if name == "archive-inspect":
            command.add_argument("--archive-file-id", required=True)
            command.add_argument("--replace-file-id", action="append", default=[],
                                 help="Exact conflicting selected file to replace; repeat for each reviewed ID")
        if name in ("prepare-upload", "archive-receive-prepare", "commissioning-attach-prepare"):
            command.add_argument("--actor", required=True)
            command.add_argument("--request-id", help="Stable request identity; generated once when omitted")
            command.add_argument("--note", default="")
        if name in ("archive-receive-prepare", "commissioning-attach-prepare"):
            command.add_argument("--preview", required=True, type=Path,
                                 help="Complete original sealed preview, unchanged")
        if name == "commissioning-inspect":
            source = command.add_mutually_exclusive_group(required=True)
            source.add_argument("--receiving-receipt", type=Path,
                                help="Complete original archive receiving receipt")
            source.add_argument("--selection", type=Path,
                                help="Original expectedRevision/captureFileId/fileIds object")
        if name == "commissioning-preview":
            command.add_argument("--selection", required=True, type=Path,
                                 help="Complete project/Installation/phase mapping and original revisions")
        if name in ("execute-prepared", "reconcile-prepared"):
            command.add_argument("--operation", required=True, type=Path,
                                 help="Previously saved complete operation, unchanged")
    args = parser.parse_args(argv)
    if args.command != "profiles" and not args.case:
        parser.error("--case must select the original existing Operations case")
    root = args.workspace.expanduser().absolute()
    info = os.lstat(root)
    if not stat.S_ISDIR(info.st_mode) or root.resolve() != root or not (root / "planning.sqlite3").is_file():
        raise ValueError("Open the existing canonical SF47 workspace; this interface does not create a replacement case.")
    workspace = None
    try:
        workspace = Workspace(root, args.scenario)
        value, raw = execute(SourceDesk(Operations(workspace)), args)
        receipt = publish(args.out, json_bytes(value) if raw is None else raw)
    finally:
        if workspace is not None:
            workspace.close()
    print(json.dumps({"schema": "stellar-forge.installation-source-desk-cli.v1",
                     "state": "COMPLETE", "command": args.command, "output": receipt},
                    ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"schema": "stellar-forge.installation-source-desk-cli.v1", "state": "INTERRUPTED",
                          "error": {"code": getattr(error, "code", type(error).__name__),
                                    "status": getattr(error, "status", None), "message": str(error)}},
                         ensure_ascii=False), file=sys.stderr, flush=True)
        raise SystemExit(1)
