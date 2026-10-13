"""Create, receive and continue complete projects through the original operator."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import time
from urllib.parse import quote
import uuid

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import server as original_server
from project_transfer import ACTIONS, ProjectTransfers

TERMINAL = {"complete", "failed", "cancelled", "interrupted"}


class TransferOperator(original_server.Operator):
    """Keep this direct route available with the original scientific application."""
    def __init__(self, *args, **kwargs):
        original_server.ACTIONS.update(ACTIONS)
        super().__init__(*args, **kwargs)
        self.project_transfer_cli_service = ProjectTransfers(
            self, original_server.Fault, supported_actions=original_server.ACTIONS)

    def _invoke(self, task):
        if task["action"] in ACTIONS:
            return self.project_transfer_cli_service.invoke(task)
        return super()._invoke(task)


def _progress(task):
    print(json.dumps({"task_id": task["id"], "action": task["action"],
                      "state": task["state"], "error": task.get("error")},
                     ensure_ascii=False), file=sys.stderr, flush=True)


def execute(operator, action, payload, operation_id):
    accepted = operator.submit(operator.primary, action, payload, operation_id)
    observed = None
    while True:
        task = operator.task(accepted["id"])
        if task["state"] != observed:
            _progress(task)
            observed = task["state"]
        if task["state"] in TERMINAL:
            break
        time.sleep(0.2)
    if task["state"] != "complete":
        return {"task": task, "success": False}
    result = {"task": task, "success": True}
    if action == "workspace.recovery.resume":
        queued = task["result"]["queued"]
        previous, completed = {}, {}
        while len(completed) < len(queued):
            for task_id in queued:
                current = operator.task(task_id)
                if previous.get(task_id) != current["state"]:
                    _progress(current)
                    previous[task_id] = current["state"]
                if current["state"] in TERMINAL:
                    completed[task_id] = current
            if len(completed) < len(queued):
                time.sleep(0.2)
        result["resumed_operations"] = [completed[key] for key in queued]
        result["success"] = (all(row["state"] == "complete" for row in completed.values())
                             and not task["result"]["handler_unavailable"])
    return result


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace", required=True, help="Original or received scientific workspace directory")
    p.add_argument("--operator-state", required=True, help="Local operator state directory")
    p.add_argument("--source-manifest", action="append", default=[], help="Original registered source manifest")
    p.add_argument("--create", action="store_true", help="Create the initial scientific workspace if absent")
    commands = p.add_subparsers(dest="command", required=True)
    commands.add_parser("plan", help="Read project history and input requirements")
    commands.add_parser("list", help="List retained complete-project transfers")
    inspect = commands.add_parser("inspect", help="Read one complete transfer record")
    inspect.add_argument("transfer_id")
    snapshot = commands.add_parser("snapshot", help="Save a complete project with operating history")
    snapshot.add_argument("--title")
    snapshot.add_argument("--task-id", action="append", help="Original task to include; default all")
    snapshot.add_argument("--without-intermediates", action="store_true")
    snapshot.add_argument("--operation-id", help="Reuse the same request ID after a lost response")
    receive = commands.add_parser("receive", help="Restore a scientific archive and recover its operator history")
    receive.add_argument("archive")
    receive.add_argument("--transfer-id", help="Select an older transfer carried inside the archive")
    receive.add_argument("--operation-id", help="Reuse the same request ID after a lost response")
    resume = commands.add_parser("resume", help="Continue unfinished received operations and wait for their outcomes")
    resume.add_argument("transfer_id")
    resume.add_argument("--task-id", action="append", help="Received task to continue; default unfinished noncancelled")
    resume.add_argument("--operation-id", help="Reuse the same request ID after a lost response")
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    operator = None
    status = 0
    try:
        operator = TransferOperator(args.workspace, args.operator_state, create=args.create,
                                    source_manifests=args.source_manifest)
        service = operator.project_transfer_cli_service
        if args.command in {"plan", "list", "inspect"}:
            query = {"transfer_id": args.transfer_id} if args.command == "inspect" else {}
            result = service.read(operator.primary, args.command, query)
        else:
            if args.command == "snapshot":
                action = "workspace.snapshot"
                payload = {"include_intermediates": not args.without_intermediates}
                if args.title is not None:
                    payload["title"] = args.title
                if args.task_id is not None:
                    payload["task_ids"] = args.task_id
            elif args.command == "receive":
                action = "workspace.receive"
                path = Path(args.archive).resolve(strict=True)
                with path.open("rb") as stream:
                    upload = operator.receive_upload(stream, path.stat().st_size,
                                                      quote(path.name, safe=""), "application/zip")
                payload = {"upload_id": upload["id"]}
                if args.transfer_id:
                    payload["transfer_id"] = args.transfer_id
            else:
                action = "workspace.recovery.resume"
                payload = {"transfer_id": args.transfer_id}
                if args.task_id is not None:
                    payload["task_ids"] = args.task_id
            operation_id = args.operation_id or "transfer-" + uuid.uuid4().hex
            print(json.dumps({"operation_id": operation_id,
                              "workspace_key": operator.primary}), file=sys.stderr, flush=True)
            result = execute(operator, action, payload, operation_id)
            status = 0 if result["success"] else 1
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    except (OSError, ValueError, KeyError, TypeError, original_server.Fault) as error:
        detail, http_status = original_server.summary_error(error)
        print(json.dumps({"error": detail, "status": http_status}, ensure_ascii=False),
              file=sys.stderr, flush=True)
        status = 1
    finally:
        if operator is not None:
            operator.close()
    return status


if __name__ == "__main__":
    raise SystemExit(main())
