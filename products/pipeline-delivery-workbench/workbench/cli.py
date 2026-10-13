"""Installed staff CLI, using the same original writer, requests and receiving."""
from __future__ import annotations
import argparse, base64, json, os, sys, time, uuid
from pathlib import Path
from common import Problem, durable_write, packed, project_path, read_json, utc
from workspace import Workspace, MUTATIONS

def emit(value):
    print(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), flush=True)

def source_entries(directory):
    root = Path(directory).resolve()
    if not (root / "dbt_project.yml").is_file():
        raise Problem("dbt_project_missing", "Select the original dbt project directory")
    out = []
    omitted = []
    for file in sorted(root.rglob("*")):
        relative = file.relative_to(root).as_posix()
        if file.is_symlink():
            raise Problem("linked_source", "Import original ordinary source files, not filesystem links", 409, {"path": relative})
        if not file.is_file(): continue
        try: project_path(relative)
        except Problem:
            omitted.append(relative)
            continue
        out.append({"path": relative, "content_base64": base64.b64encode(file.read_bytes()).decode("ascii")})
    return out, omitted

def import_project(workspace, *, project_id, directory, label, request_id, expected_revision, envelope_path, notes=""):
    """Retain exact source/request bytes before first invocation; reopen that same request on retry."""
    envelope_path = Path(envelope_path).resolve()
    if envelope_path.exists():
        original = read_json(envelope_path)
        if original.get("request_id") != request_id or original.get("action") != "edition.save" or original.get("payload", {}).get("project_id") != project_id:
            raise Problem("request_conflict", "The selected import envelope already names different work", 409)
        envelope = original
        omitted = None
    else:
        project = workspace.invoke("project.get", {"id": project_id})["result"]["project"]
        files, omitted = source_entries(directory)
        envelope = {"action": "edition.save", "payload": {
            "project_id": project_id, "base_edition_id": project.get("edition_id"), "label": label,
            "source_notes": notes, "files": files, "delete_paths": []},
            "workspace_id": workspace.meta()["workspace_id"], "expected_revision": expected_revision, "request_id": request_id}
        durable_write(envelope_path, packed(envelope))
    receipt = workspace.invoke(**envelope)
    return {"receipt": receipt, "envelope_path": str(envelope_path), "omitted_nonproject_paths": omitted}

def parser():
    p = argparse.ArgumentParser(description="Client pipeline delivery workspace")
    p.add_argument("--workspace", help="Original persistent workspace directory")
    p.add_argument("--source-root", default=str(Path(__file__).parent), help="Installed application source directory")
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("init", help="Open or create the selected persistent writer")
    read = sub.add_parser("read"); read.add_argument("action"); read.add_argument("--payload", default="{}")
    invoke = sub.add_parser("invoke"); invoke.add_argument("envelope", help="Complete retained JSON envelope file or - for stdin")
    source = sub.add_parser("import-project")
    source.add_argument("--project-id", required=True); source.add_argument("--directory", required=True)
    source.add_argument("--label", required=True); source.add_argument("--request-id", required=True)
    source.add_argument("--expected-revision", required=True, type=int); source.add_argument("--envelope-out", required=True)
    source.add_argument("--notes", default="")
    for name in ("backup", "release"):
        exp = sub.add_parser(name); exp.add_argument("--output", required=True); exp.add_argument("--request-id")
        if name == "release": exp.add_argument("--release-id", required=True)
    inspect = sub.add_parser("inspect-archive"); inspect.add_argument("archive"); inspect.add_argument("--full", action="store_true")
    receive = sub.add_parser("receive"); receive.add_argument("archive"); receive.add_argument("--destination", required=True)
    current = sub.add_parser("received"); current.add_argument("directory")
    catalog = sub.add_parser("received-catalog"); catalog.add_argument("directory")
    wait = sub.add_parser("wait"); wait.add_argument("run_id"); wait.add_argument("--timeout", type=int, default=1200)
    wait.add_argument("--interval", type=float, default=2.0)
    return p

def main(argv=None):
    args = parser().parse_args(argv)
    try:
        from receiving import create_backup, create_release_archive, inspect_archive, inspect_received, receive_workspace, received_catalog
        if args.command == "inspect-archive":
            result = inspect_archive(args.archive)
            if not args.full:
                result = {k: v for k, v in result.items() if k not in {"files", "manifest"}}
            emit(result); return 0
        if args.command == "receive":
            emit(receive_workspace(args.archive, args.destination, source_root=args.source_root)); return 0
        if args.command == "received":
            emit(inspect_received(args.directory)); return 0
        if args.command == "received-catalog":
            emit(received_catalog(args.directory)); return 0
        if not args.workspace:
            raise Problem("workspace_required", "--workspace is required for this operator action")
        workspace = Workspace(args.workspace, source_root=args.source_root)
        try:
            if args.command == "init": emit(workspace.snapshot())
            elif args.command == "read":
                if args.action in MUTATIONS: raise Problem("mutation_requires_envelope", "Use invoke with a retained complete mutation envelope")
                emit(workspace.invoke(args.action, json.loads(args.payload)))
            elif args.command == "invoke":
                envelope = json.load(sys.stdin) if args.envelope == "-" else read_json(args.envelope)
                if not isinstance(envelope, dict):
                    raise Problem("invalid_envelope", "The retained invocation must be a JSON object")
                emit(workspace.invoke(**envelope))
            elif args.command == "import-project":
                emit(import_project(workspace, project_id=args.project_id, directory=args.directory,
                    label=args.label, request_id=args.request_id, expected_revision=args.expected_revision,
                    envelope_path=args.envelope_out, notes=args.notes))
            elif args.command == "backup":
                emit(create_backup(workspace, args.output, request_id=args.request_id))
            elif args.command == "release":
                emit(create_release_archive(workspace, args.release_id, args.output, request_id=args.request_id))
            elif args.command == "wait":
                if args.timeout < 1 or args.timeout > 86400 or not 0.25 <= args.interval <= 60:
                    raise Problem("invalid_wait", "Choose a timeout of 1..86400 seconds and interval of 0.25..60 seconds")
                deadline = time.monotonic() + args.timeout
                while True:
                    run = workspace.runtime().reconcile(args.run_id)
                    if run["state"] in {"succeeded", "failed", "cancelled", "setup_failed", "interrupted"}:
                        emit(workspace.invoke("run.get", {"id": args.run_id})["result"])
                        return 0 if run["state"] == "succeeded" else 2
                    if time.monotonic() >= deadline:
                        emit({"status": "still_active", "run_id": args.run_id, "state": run["state"], "observed_at": utc()})
                        return 3
                    time.sleep(args.interval)
            return 0
        finally:
            workspace.close()
    except Problem as exc:
        emit({"error": exc.as_dict(), "status": exc.status})
        return 2
    except (ValueError, TypeError, KeyError, OSError) as exc:
        emit({"error": {"code": "operator_input_or_storage", "message": str(exc)}})
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
