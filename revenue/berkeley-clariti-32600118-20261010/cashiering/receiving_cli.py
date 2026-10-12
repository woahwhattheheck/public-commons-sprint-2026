#!/usr/bin/env python3
"""Operate the installed cashiering receiving workspace through its original database."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import uuid

PRODUCT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PRODUCT / "workspace"))
sys.path.insert(0, str(PRODUCT))

from app import Workspace, Conflict, restore
from cashiering.engine import Cashiering
from cashiering import model as m


def read_json(path):
    def pairs(values):
        obj = {}
        for key, value in values:
            if key in obj:
                raise ValueError("The input JSON repeats " + key)
            obj[key] = value
        return obj
    def bad(value):
        raise ValueError("Nonfinite JSON input: " + value)
    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=pairs, parse_constant=bad)


def output_bytes(value):
    if isinstance(value, bytes):
        return value
    if isinstance(value, str):
        return value.encode("utf-8")
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def mkdir_durable(path):
    path = Path(path)
    missing = []
    current = path
    while not current.exists():
        missing.append(current)
        current = current.parent
    if not current.is_dir():
        raise ValueError("The output parent is not a directory.")
    for child in reversed(missing):
        try:
            child.mkdir()
        except FileExistsError:
            if not child.is_dir():
                raise ValueError("The output parent changed.")
        parent = os.open(child.parent, os.O_RDONLY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)


def save_exact(path, raw):
    destination = Path(path).expanduser().resolve()
    mkdir_durable(destination.parent)
    if destination.exists():
        if not destination.is_file() or destination.read_bytes() != raw:
            raise ValueError("The destination already contains different bytes: " + str(destination))
        return {"path": str(destination), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "reused": True}
    handle, name = tempfile.mkstemp(prefix="." + destination.name + "-", dir=destination.parent)
    temporary = Path(name)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, destination)
        except FileExistsError:
            if destination.read_bytes() != raw:
                raise ValueError("Another writer published different destination bytes.")
        directory = os.open(destination.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)
    return {"path": str(destination), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def emit(value, output=None):
    if output:
        print(json.dumps(save_exact(output, output_bytes(value)), ensure_ascii=False))
    elif isinstance(value, bytes):
        raise ValueError("Choose --out for complete original binary bytes.")
    else:
        print(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="Original permitting/cashiering SQLite workspace.")
    commands = parser.add_subparsers(dest="command", required=True)
    state = commands.add_parser("state", help="List exact prepared exchanges, returned sources and saved receiving.")
    state.add_argument("--run-id")
    state.add_argument("--export-id")
    state.add_argument("--out")
    read = commands.add_parser("read", help="Read a retained receiving resource or original artifact.")
    read.add_argument("resource", help="Receiving-relative path, or a full /api/cashiering/... path.")
    read.add_argument("--query", default="{}", help="JSON query object: offset, limit, run_id, filters.")
    read.add_argument("--out")
    prepare = commands.add_parser("request", help="Retain an exact version-bound request before applying it.")
    prepare.add_argument("--action", required=True)
    prepare.add_argument("--payload", required=True, help="JSON object containing the operator's complete action fields.")
    prepare.add_argument("--request-id")
    prepare.add_argument("--out", required=True, help="New or byte-identical request JSON path.")
    prepare.add_argument("--original", help="Add exact original file bytes for receiving-capture.")
    prepare.add_argument("--apply", action="store_true", help="Apply this same retained request immediately.")
    prepare.add_argument("--result-out")
    apply = commands.add_parser("apply", help="Apply or replay the original retained request, using its original UUID.")
    apply.add_argument("request")
    apply.add_argument("--out")
    recover = commands.add_parser("recover", help="Read a committed request result without repeating its write.")
    recover.add_argument("request_id")
    recover.add_argument("--out")
    backup = commands.add_parser("backup", help="Save the original full SQLite backup, including all receiving tables.")
    backup.add_argument("--out", required=True)
    reopen = commands.add_parser("restore", help="Restore the original full backup to the new --db path.")
    reopen.add_argument("backup")
    args = parser.parse_args(argv)
    if args.command == "restore":
        restore(args.backup, args.db)
        emit({"db": str(Path(args.db).resolve()), "restored_from": str(Path(args.backup).resolve())})
        return 0
    workspace = Workspace(args.db)
    cash = Cashiering(workspace, Conflict)
    if args.command == "state":
        query = {k: v for k, v in (("run_id", args.run_id), ("export_id", args.export_id)) if v}
        result = cash.read("/api/cashiering/receiving/state", query)
        emit(result[0], args.out)
    elif args.command == "read":
        path = args.resource if args.resource.startswith("/api/cashiering/") else "/api/cashiering/receiving/" + args.resource.lstrip("/")
        query = json.loads(args.query)
        if not isinstance(query, dict):
            raise ValueError("--query must be a JSON object.")
        emit(cash.read(path, query)[0], args.out)
    elif args.command == "request":
        if not args.action.startswith("receiving-"):
            raise ValueError("Select one maintained receiving action.")
        payload = read_json(args.payload)
        if not isinstance(payload, dict):
            raise ValueError("Request payload must be a JSON object.")
        if "request_id" in payload or "revision" in payload or "receiving_workspace_id" in payload:
            raise ValueError("The request command captures current workspace guards; use apply for an existing full request.")
        current = cash.read("/api/cashiering/receiving/state", {})[0]
        payload.update(request_id=args.request_id or str(uuid.uuid4()), revision=current["revision"],
                       receiving_workspace_id=current["workspace_id"])
        if args.original:
            if args.action != "receiving-capture" or "document_id" in payload or "content_base64" in payload:
                raise ValueError("--original belongs to a single new receiving-capture file.")
            source = Path(args.original).expanduser().resolve()
            raw = source.read_bytes()
            if not 0 < len(raw) <= 25 * 1024 * 1024:
                raise ValueError("Original returned file must be nonempty and at most 25 MiB.")
            payload.update(filename=source.name, content_base64=base64.b64encode(raw).decode("ascii"))
        original = {"action": args.action, "payload": payload}
        receipt = save_exact(args.out, output_bytes(original))
        if args.apply:
            response = cash.write(original["action"], original["payload"])
            emit(response, args.result_out)
        else:
            emit({"request_id": payload["request_id"], **receipt})
    elif args.command == "apply":
        original = read_json(args.request)
        if not isinstance(original, dict) or not isinstance(original.get("action"), str) or not original["action"].startswith("receiving-"):
            raise ValueError("Use the complete retained receiving request {action,payload}, or its original browser envelope.")
        browser = original.get("schema") == "berkeley.cashiering.receiving-browser-request.v1"
        if not browser and set(original) != {"action", "payload"}:
            raise ValueError("This is not a complete maintained receiving request.")
        if not isinstance(original.get("payload"), dict) or not original["payload"].get("request_id"):
            raise ValueError("The retained request needs its original UUID.")
        if browser:
            expected = m.fingerprint({"action": original["action"], "payload": original["payload"]})
            if original.get("request_sha256") != expected or original.get("id") != original["payload"]["request_id"]:
                raise ValueError("The complete browser request differs from its original input hash or UUID.")
        emit(cash.write(original["action"], original["payload"]), args.out)
    elif args.command == "recover":
        emit(cash.read("/api/cashiering/receiving/requests/" + args.request_id, {})[0], args.out)
    elif args.command == "backup":
        emit(workspace.backup(), args.out)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError) as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)
