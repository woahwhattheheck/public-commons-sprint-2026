"""The same saved project operations for an operator, script or receiving agent."""
from __future__ import annotations
import argparse
import base64
import pathlib
import sys
import uuid
from schema import WorkspaceError, dumps, loads, identity
from workspace import Workspace

def main():
    parser = argparse.ArgumentParser(description="IANZ Ara Hono saved project operations")
    parser.add_argument("--workspace", required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    seed = sub.add_parser("seed-public")
    command = sub.add_parser("command")
    command.add_argument("request", help="Complete command JSON file, or - for stdin")
    records = sub.add_parser("records")
    records.add_argument("entity")
    records.add_argument("--limit", type=int, default=100)
    records.add_argument("--search", default="")
    record = sub.add_parser("record")
    record.add_argument("entity")
    record.add_argument("key")
    history = sub.add_parser("history")
    history.add_argument("entity")
    history.add_argument("key")
    request = sub.add_parser("request")
    request.add_argument("request_id")
    request.add_argument("--hydrate", action="store_true")
    retain = sub.add_parser("retain-file")
    retain.add_argument("path")
    retain.add_argument("--media-type", default="application/octet-stream")
    retain.add_argument("--origin", default="operator_received")
    retain.add_argument("--source-id")
    file = sub.add_parser("file")
    file.add_argument("file_id")
    file.add_argument("--output", required=True)
    native = sub.add_parser("receive-target-schema")
    native.add_argument("path")
    prepare = sub.add_parser("prepare")
    prepare.add_argument("run_id")
    prepare.add_argument("--mapping-key")
    prepare.add_argument("--allow-staging", action="store_true")
    prepare.add_argument("--output", required=True)
    receive_result = sub.add_parser("receive-result")
    receive_result.add_argument("run_id")
    receive_result.add_argument("path")
    compare = sub.add_parser("compare-return")
    compare.add_argument("run_id")
    compare.add_argument("path")
    compare.add_argument("--billing-policy")
    complete = sub.add_parser("complete")
    complete.add_argument("run_id")
    export = sub.add_parser("export-handover")
    export.add_argument("output")
    reopen = sub.add_parser("receive-handover")
    reopen.add_argument("path")
    for item in [seed, retain, native, prepare, receive_result, compare, complete, reopen]:
        item.add_argument("--actor", required=True)
        item.add_argument("--reason", required=True)
        item.add_argument("--request-id")
    args = parser.parse_args()
    workspace = Workspace(args.workspace)
    try:
        def execute(action, payload, suffix=None):
            request_id = args.request_id or "cli-" + str(uuid.uuid4())
            if suffix:
                request_id += ":" + suffix
            try:
                accepted = workspace.command(request_id)
            except WorkspaceError as error:
                if error.status != 404:
                    raise
                accepted = None
            if accepted is not None:
                original = {**accepted["request"], "payload": payload}
                if (original.get("action") != action or original.get("actor") != args.actor
                        or original.get("reason") != args.reason or identity(original) != accepted["fingerprint"]):
                    raise WorkspaceError("That original command ID belongs to different CLI input.", code="request_conflict", status=409)
                return workspace.execute(original)
            return workspace.execute({"request_id": request_id, "project_id": workspace.metadata()["project_id"],
                                      "expected_revision": workspace.metadata()["revision"],
                                      "action": action, "actor": args.actor, "reason": args.reason, "payload": payload})
        def retain_path(path, origin, media="application/octet-stream", suffix="file"):
            body = pathlib.Path(path).read_bytes()
            return execute("file.retain", {"content_base64": base64.b64encode(body).decode(),
                                           "filename": pathlib.Path(path).name, "media_type": media,
                                           "origin": origin}, suffix)["result"]
        if args.command == "status":
            result = workspace.summary()
        elif args.command == "command":
            body = sys.stdin.buffer.read() if args.request == "-" else pathlib.Path(args.request).read_bytes()
            result = workspace.execute(loads(body))
        elif args.command == "seed-public":
            result = execute("source.seed", {})
        elif args.command == "records":
            result = workspace.records(args.entity, limit=args.limit, search=args.search)
        elif args.command == "record":
            result = workspace.record(args.entity, args.key)
        elif args.command == "history":
            result = workspace.history(args.entity, args.key)
        elif args.command == "request":
            result = workspace.command(args.request_id, hydrate=args.hydrate)
        elif args.command == "retain-file":
            body = pathlib.Path(args.path).read_bytes()
            result = execute("file.retain", {"content_base64": base64.b64encode(body).decode(),
                                             "filename": pathlib.Path(args.path).name, "media_type": args.media_type,
                                             "origin": args.origin, "source_id": args.source_id})
        elif args.command == "file":
            result = workspace.file(args.file_id)
            output = pathlib.Path(args.output)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(result.pop("body"))
            result["output"] = str(output.resolve())
        elif args.command == "receive-target-schema":
            file = retain_path(args.path, "target_metadata", "application/json")
            result = execute("target.schema.receive", {"file_id": file["file_id"]}, "schema")
        elif args.command == "prepare":
            result = execute("receiving.prepare", {"run_id": args.run_id, "mapping_key": args.mapping_key,
                                                   "allow_staging": args.allow_staging})
            output = pathlib.Path(args.output)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(workspace.file(result["result"]["outgoing_file_id"])["body"])
            result["output"] = str(output.resolve())
        elif args.command == "receive-result":
            file = retain_path(args.path, "native_result", "application/json")
            result = execute("receiving.result", {"run_id": args.run_id, "file_id": file["file_id"]}, "result")
        elif args.command == "compare-return":
            file = retain_path(args.path, "native_return_bundle", "application/zip")
            payload = {"run_id": args.run_id, "file_id": file["file_id"]}
            if args.billing_policy:
                payload["billing_policy"] = loads(pathlib.Path(args.billing_policy).read_bytes())
            result = execute("receiving.compare", payload, "comparison")
        elif args.command == "complete":
            result = execute("receiving.complete", {"run_id": args.run_id})
        elif args.command == "export-handover":
            package, manifest = workspace.handover()
            output = pathlib.Path(args.output)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(package)
            result = {"output": str(output.resolve()), "manifest": manifest}
        elif args.command == "receive-handover":
            result = execute("handover.receive", {"content_base64": base64.b64encode(pathlib.Path(args.path).read_bytes()).decode()})
        else:
            raise WorkspaceError("Choose a documented command.")
        print(dumps(result))
    except WorkspaceError as error:
        print(dumps(error.as_dict()), file=sys.stderr)
        return 2
    finally:
        workspace.close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
