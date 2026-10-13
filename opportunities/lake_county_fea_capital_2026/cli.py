"""Complete native CLI: source preparation, exact requests, reports and receiving."""
from __future__ import annotations
import argparse
import base64
import json
from pathlib import Path
from domain import ProgrammeError, require, stable, digest
from workspace import Workspace, atomic, file_identity, receive_workspace
from server import serve

def prepared(workspace, path, *, operation_id, actor, action, payload):
    path = Path(path)
    if path.exists():
        old = json.loads(path.read_text(encoding="utf-8"))
        require(old.get("operation_id") == operation_id and old.get("actor") == actor
                and old.get("workspace_id") == workspace.context["workspace_id"]
                and old.get("action") == action and digest(old.get("payload")) == digest(payload),
                "prepared_conflict", "This original request file is already bound to different input.", status=409)
        return old
    request = {"operation_id": operation_id, "actor": actor, "workspace_id": workspace.context["workspace_id"],
               "expected_revision": workspace.revision(), "action": action, "payload": payload}
    atomic(path, (stable(request) + "\n").encode())
    return request

def main():
    parser = argparse.ArgumentParser(description="Source-bound FEA facility/capital programme. No provider or proprietary model calls.")
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="Create one actual internal engineering workspace.")
    init.add_argument("--root", required=True)
    init.add_argument("--case", required=True)
    init.add_argument("--packet-sha256", required=True)
    init.add_argument("--actor", required=True)
    for name in ("status", "operation", "prepare", "apply", "upload", "records", "object", "report", "export", "serve"):
        sub = commands.add_parser(name)
        sub.add_argument("--root", required=True)
        if name in {"operation", "object"}:
            sub.add_argument("--id", required=True)
        if name == "object":
            sub.add_argument("--kind", required=True)
            sub.add_argument("--revision", type=int)
        if name in {"prepare", "upload"}:
            sub.add_argument("--operation", required=True)
            sub.add_argument("--actor", required=True)
            sub.add_argument("--request", required=True)
        if name == "prepare":
            sub.add_argument("--action", required=True)
            sub.add_argument("--payload", required=True)
        if name == "apply":
            sub.add_argument("--request", required=True)
            sub.add_argument("--result")
        if name == "upload":
            sub.add_argument("--file", required=True)
            sub.add_argument("--metadata", required=True)
            sub.add_argument("--mime", default="application/octet-stream")
        if name == "records":
            sub.add_argument("--edition", required=True)
            sub.add_argument("--table")
            sub.add_argument("--offset", type=int, default=0)
            sub.add_argument("--limit", type=int, default=100)
            sub.add_argument("--issues", action="store_true")
        if name in {"report", "export"}:
            sub.add_argument("--publication", required=name == "report")
            sub.add_argument("--output", required=True)
        if name == "export":
            sub.add_argument("--application-root")
        if name == "serve":
            sub.add_argument("--port", type=int, default=0)
            sub.add_argument("--startup-file")
    receiver = commands.add_parser("receive", help="Receive the complete archive into one selected new destination.")
    receiver.add_argument("--archive", required=True)
    receiver.add_argument("--destination", required=True)
    receiver.add_argument("--sha256", required=True)
    receiver.add_argument("--bytes", type=int, required=True)
    args = parser.parse_args()
    if args.command == "receive":
        result = receive_workspace(args.archive, args.destination, expected_sha256=args.sha256, expected_bytes=args.bytes)
    elif args.command == "serve":
        return serve(args.root, args.port, args.startup_file)
    else:
        w = Workspace.create(args.root, case_id=args.case, packet_sha256=args.packet_sha256, actor=args.actor) if args.command == "init" else Workspace(args.root)
        try:
            if args.command in {"init", "status"}:
                result = w.status()
            elif args.command == "operation":
                result = w.operation(args.id)
            elif args.command == "object":
                result = w.object(args.kind, args.id, args.revision)
            elif args.command == "records":
                result = w.rows(args.edition, args.table, args.offset, args.limit, args.issues)
            elif args.command == "prepare":
                payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
                result = prepared(w, args.request, operation_id=args.operation, actor=args.actor, action=args.action, payload=payload)
            elif args.command == "upload":
                path = Path(args.file)
                raw = path.read_bytes()
                pin = file_identity(path)
                metadata = json.loads(Path(args.metadata).read_text(encoding="utf-8"))
                payload = {"name": path.name, "mime": args.mime, **pin, "base64": base64.b64encode(raw).decode("ascii"), "metadata": metadata}
                request = prepared(w, args.request, operation_id=args.operation, actor=args.actor, action="file.retain", payload=payload)
                result = w.apply(request)
            elif args.command == "apply":
                request = json.loads(Path(args.request).read_text(encoding="utf-8"))
                result = w.apply(request)
                if args.result:
                    atomic(args.result, (stable(result) + "\n").encode())
                    result = {"operation_id": result["operation_id"], "revision": result["revision"], "result_file": str(Path(args.result).resolve()),
                              **file_identity(args.result)}
            elif args.command == "report":
                raw = w.report(args.publication).encode()
                atomic(args.output, raw)
                result = {"path": str(Path(args.output).resolve()), **file_identity(args.output)}
            else:
                result = w.export_workspace(args.output, publication_id=args.publication, application_root=args.application_root)
        finally:
            w.close()
    print(stable(result), flush=True)

if __name__ == "__main__":
    try:
        main()
    except ProgrammeError as exc:
        print(stable({"error": exc.code, "message": str(exc), "details": exc.details}), flush=True)
        raise SystemExit(2)
