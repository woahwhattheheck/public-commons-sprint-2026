"""CLI and JSON operation transport for the original Wherobots workspace."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

from .storage import Workspace, OperationError, canonical
from . import workflow


def read_json(path):
    return json.loads(Path(path).read_bytes())


def dispatch(workspace, operation, arguments):
    args = dict(arguments)
    if operation == "runtime":
        from .native import runtime_info
        return runtime_info()
    if operation == "logs":
        return workflow.captured_logs(workspace, args["operation_id"], args.get("capture"), args.get("offset", 0), args.get("limit", 100))
    if operation == "state" and ("offset" in args or "limit" in args):
        with workspace.read_snapshot():
            pages = {kind: workspace.records_page(kind, args.get("offset", 0), args.get("limit", 20))
                     for kind in ("workflow", "operation", "edition")}
        return {"workspace_id": workspace.workspace_id, "title": workspace.title,
                **{kind + "s": page["items"] for kind, page in pages.items()},
                "pages": {kind + "s": {key: value for key, value in page.items() if key != "items"}
                          for kind, page in pages.items()}}
    if operation == "state":
        return {"workspace_id": workspace.workspace_id, "title": workspace.title,
                "workflows": workspace.records("workflow"), "operations": workspace.records("operation"),
                "editions": workspace.records("edition")}
    if operation == "get":
        return workspace.get_record(args["kind"], args["id"])
    if operation == "list":
        if "offset" in args or "limit" in args:
            return workspace.records_page(args["kind"], args.get("offset", 0), args.get("limit", 20))
        return workspace.records(args["kind"])
    if operation == "events":
        return workspace.events(args["kind"], args["id"], args.get("after", 0), args.get("limit", 100))
    if operation == "import_source":
        path = Path(args["path"])
        result = (workflow.import_script(workspace, args.get("filename", path.name), path)
                  if args.get("script", False) else {"filename": args.get("filename", path.name), **workspace.put_object(path)})
        if args.get("expected_sha256") is not None and result["sha256"] != args["expected_sha256"] or (
                args.get("expected_bytes") is not None and result["bytes"] != args["expected_bytes"]):
            raise OperationError("SOURCE_FILE_CHANGED", "The received original input differs from its selected identity.", status=409)
        return result
    if operation == "save_workflow":
        return workflow.save_workflow(workspace, args["definition"], args.get("expected_revision"), args.get("actor", "operator"))
    if operation == "adopt":
        raw = Path(args["input"]).read_bytes()
        if args.get("input_sha256") is not None and hashlib.sha256(raw).hexdigest() != args["input_sha256"]:
            raise OperationError("INTAKE_FILE_CHANGED", "The original customer document differs from the selected input.", status=409)
        return workflow.adopt_customer_input(workspace, raw,
            {key: Path(value) if isinstance(value, str) else value for key, value in args["files"].items()},
            args["account"], args.get("expected_revision"), args.get("actor", "operator"))
    if operation == "review":
        return workflow.review(workspace, args["workflow_id"], args["operation_id"],
            args["expected_revision"], args.get("actor", "operator"), args.get("mode", "submit"))
    if operation in {"submit", "recover", "refresh", "cancel", "capture"}:
        from .native import NativeProvider
        provider = NativeProvider()
        if operation == "recover":
            return workflow.recover(workspace, args["operation_id"], provider, args.get("native_run_id"))
        if operation == "refresh":
            return workflow.refresh(workspace, args["operation_id"], provider, args.get("include_logs", False))
        if operation == "capture":
            return workflow.capture_outputs(workspace, args["operation_id"], provider)
        return getattr(workflow, operation)(workspace, args["operation_id"], provider)
    if operation == "compare":
        from .editions import compare_editions
        return compare_editions(workspace, args["left_id"], args["right_id"])
    if operation == "rows":
        from .editions import edition_rows
        return edition_rows(workspace, args["edition_id"], args["dataset_id"], args.get("offset", 0), args.get("limit", 100))
    if operation in {"export", "export_dataset"}:
        from .exports import export_selected
        return export_selected(workspace, operation, args)
    if operation == "inspect_export":
        from .exports import inspect_export
        return inspect_export(args["export_kind"], Path(args["source"]))
    if operation == "import":
        from .portable import import_handover
        source = Path(args["source"])
        if args.get("expected_sha256") is not None:
            from .storage import hash_file
            if hash_file(source)[0] != args["expected_sha256"]:
                raise OperationError("HANDOVER_CHANGED", "The original handover differs from the selected complete file.", status=409)
        return import_handover(workspace, source)
    raise OperationError("OPERATION", "Choose a documented workspace operation.")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="wherobots-operator",
        description="Review original Wherobots workflows, operate native runs, and receive complete output editions.")
    parser.add_argument("--workspace", required=True, type=Path, help="Original private workspace directory")
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init"); init.add_argument("--title", default="Wherobots operations")
    show = sub.add_parser("show"); show.add_argument("kind"); show.add_argument("id")
    listing = sub.add_parser("list"); listing.add_argument("kind")
    state = sub.add_parser("state")
    for page in (listing, state):
        page.add_argument("--offset", type=int, default=argparse.SUPPRESS)
        page.add_argument("--limit", type=int, default=argparse.SUPPRESS)
    sub.add_parser("runtime")
    logs = sub.add_parser("logs"); logs.add_argument("operation_id"); logs.add_argument("--capture", type=int); logs.add_argument("--offset", type=int, default=0); logs.add_argument("--limit", type=int, default=100)
    source = sub.add_parser("import-source"); source.add_argument("path"); source.add_argument("--script", action="store_true"); source.add_argument("--filename")
    source.add_argument("--expected-sha256"); source.add_argument("--expected-bytes", type=int)
    save = sub.add_parser("save-workflow"); save.add_argument("file"); save.add_argument("--expected-revision"); save.add_argument("--actor", default="operator")
    adopt = sub.add_parser("adopt"); adopt.add_argument("input"); adopt.add_argument("--files", required=True); adopt.add_argument("--account", required=True); adopt.add_argument("--expected-revision"); adopt.add_argument("--actor", default="operator")
    adopt.add_argument("--input-sha256")
    review = sub.add_parser("review"); review.add_argument("workflow_id"); review.add_argument("--operation-id", required=True); review.add_argument("--expected-revision", required=True); review.add_argument("--actor", default="operator"); review.add_argument("--mode", choices=["submit", "attach"], default="submit")
    for name in ("submit", "recover", "refresh", "cancel", "capture"):
        command = sub.add_parser(name); command.add_argument("operation_id")
        if name == "recover":
            command.add_argument("--native-run-id")
        if name == "refresh":
            command.add_argument("--include-logs", action="store_true")
    compare = sub.add_parser("compare"); compare.add_argument("left_id"); compare.add_argument("right_id")
    rows = sub.add_parser("rows"); rows.add_argument("edition_id"); rows.add_argument("dataset_id"); rows.add_argument("--offset", type=int, default=0); rows.add_argument("--limit", type=int, default=100)
    export = sub.add_parser("export"); export.add_argument("workflow_id"); export.add_argument("destination")
    dataset = sub.add_parser("export-dataset"); dataset.add_argument("edition_id"); dataset.add_argument("dataset_id"); dataset.add_argument("destination")
    for selected in (export, dataset):
        selected.add_argument("--expected-revision")
        selected.add_argument("--export-id", default=argparse.SUPPRESS)
        selected.add_argument("--reuse-existing", action="store_true")
    inspect = sub.add_parser("inspect-export"); inspect.add_argument("export_kind", choices=["workflow", "dataset"]); inspect.add_argument("source")
    receiving = sub.add_parser("import"); receiving.add_argument("source"); receiving.add_argument("--expected-sha256")
    events = sub.add_parser("events"); events.add_argument("kind"); events.add_argument("id"); events.add_argument("--after", type=int, default=0); events.add_argument("--limit", type=int, default=100)
    server = sub.add_parser("serve"); server.add_argument("--host", default="127.0.0.1"); server.add_argument("--port", type=int, default=0)
    sub.add_parser("rpc", help="One complete JSON operation on standard input")
    args = vars(parser.parse_args(argv))
    path, command = args.pop("workspace"), args.pop("command")
    try:
        with Workspace(path, create=command == "init", title=args.get("title", "Wherobots operations")) as workspace:
            if command == "init":
                result = {"workspace_id": workspace.workspace_id, "title": workspace.title}
            elif command == "serve":
                from .server import serve
                serve(workspace, **args); return 0
            elif command == "rpc":
                raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise OperationError("REQUEST_SIZE", "Use a JSON operation within 2 MiB.")
                request = json.loads(raw)
                if not isinstance(request, dict) or set(request) - {"operation", "arguments", "workspace_id"} or not {"operation", "arguments"} <= set(request) or not isinstance(request["arguments"], dict):
                    raise OperationError("REQUEST_OBJECT", "Supply operation and arguments in one JSON object.")
                if "workspace_id" in request and request["workspace_id"] != workspace.workspace_id:
                    raise OperationError("WORKSPACE_CHANGED", "The selected path belongs to a different original workspace.", status=409)
                result = dispatch(workspace, request["operation"], request["arguments"])
            else:
                if command == "show":
                    command = "get"
                elif command == "export-dataset":
                    command = "export_dataset"
                elif command == "inspect-export":
                    command = "inspect_export"
                elif command == "import-source":
                    command = "import_source"
                    if args.get("filename") is None:
                        args.pop("filename")
                elif command == "save-workflow":
                    command = "save_workflow"; args["definition"] = read_json(args.pop("file"))
                elif command == "adopt":
                    manifest = Path(args["files"]).resolve()
                    files = read_json(manifest)
                    args["files"] = {key: str((manifest.parent / value).resolve()) if isinstance(value, str) else value
                                     for key, value in files.items()}
                    args["account"] = read_json(args["account"])
                result = dispatch(workspace, command, args)
            sys.stdout.buffer.write(canonical(result) + b"\n"); sys.stdout.flush()
            return 0
    except (OperationError, ValueError, KeyError, OSError, TypeError) as error:
        from .native import NativeProvider
        sys.stdout.buffer.write(canonical(NativeProvider.error(error)) + b"\n"); sys.stdout.flush()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
