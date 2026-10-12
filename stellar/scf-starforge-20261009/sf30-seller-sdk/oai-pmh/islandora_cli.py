"""MIT. Native Islandora migration commands over one original OAI workspace."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
from workspace import Workspace
from harvest import InputError, decode
from islandora import IslandoraDesk
from islandora_io import manifest_document, log_page, desk_state

def document(path):
    return decode(sys.stdin.buffer.read() if path == "-" else Path(path).read_bytes())

def file_bytes(path):
    return sys.stdin.buffer.read() if path == "-" else Path(path).read_bytes()

def native_run(desk, args):
    """Keep the original native worker attached until its saved result is ready."""
    previous = {run["id"] for run in desk.job(args.id).get("runs", [])}
    desk.start(args.id, args.batch, args.workbench, python=args.python, check=args.check)
    try:
        while desk.worker.is_alive():
            desk.worker.join(0.25)
    except KeyboardInterrupt:
        desk.stop()
        while desk.worker.is_alive():
            desk.worker.join(0.25)
        raise
    job = desk.job(args.id)
    fresh = [run for run in job.get("runs", []) if run["id"] not in previous]
    candidates = [run for run in fresh
                  if run["batch"] == args.batch and bool(run.get("check")) == bool(args.check)]
    run = candidates[-1] if candidates else None
    error = getattr(desk, "last_error", None)
    received = bool(not args.check and not error and run is None
                    and args.batch not in {batch["name"] for batch in job.get("batches", [])})
    checks = [item for item in fresh if item["batch"] == args.batch and item.get("check")]
    return {"job": job, "run": run, "checks": checks, "received": received,
            "workerError": error,
            "completed": bool(not error and (received or run and run.get("exitCode") == 0))}

def main(argv=None):
    parser = argparse.ArgumentParser(description="Islandora migration desk for an existing OAI workspace")
    parser.add_argument("--workspace", required=True, help="Original private XML/OAI workspace directory")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("state")
    for name in ("inventory", "default-plan"):
        item = commands.add_parser(name)
        item.add_argument("--build", required=True)
    item = commands.add_parser("create")
    item.add_argument("--build", required=True)
    item.add_argument("--label", required=True)
    item.add_argument("--host", required=True)
    item.add_argument("--config", help="Workbench settings JSON file, or - for stdin")
    item.add_argument("--plan", help="Complete field crosswalk JSON file")
    item.add_argument("--baseline", help="Completed migration at this target host")
    item = commands.add_parser("configure")
    item.add_argument("--id", required=True)
    item.add_argument("--host", help="Actual base URL before native writes or a baseline")
    item.add_argument("--config", help="JSON settings to add or update in the saved target")
    item = commands.add_parser("rebuild")
    item.add_argument("--id", required=True)
    item.add_argument("--plan", required=True)
    item = commands.add_parser("records")
    item.add_argument("--id", required=True)
    item.add_argument("--offset", type=int, default=0)
    item.add_argument("--limit", type=int, default=100)
    item.add_argument("--kind", default="", choices=("", "CREATE", "REVIEW", "READ_TARGET", "UPDATE", "UNCHANGED"))
    item.add_argument("--query", default="", help="Source identifier substring")
    item = commands.add_parser("record")
    item.add_argument("--id", required=True)
    item.add_argument("--identifier", required=True)
    item = commands.add_parser("edit")
    item.add_argument("--id", required=True)
    item.add_argument("--identifier", required=True)
    item.add_argument("--overrides", help="JSON object mapping target fields to replacement strings")
    item.add_argument("--choices", help="JSON object mapping conflict fields to source/target decisions")
    item = commands.add_parser("attach")
    item.add_argument("--id", required=True)
    item.add_argument("--manifest", required=True, help="Complete JSON or CSV original-file manifest")
    item.add_argument("--asset-root", required=True, help="Directory containing the original files")
    item = commands.add_parser("relationships")
    item.add_argument("--id", required=True)
    item.add_argument("--manifest", required=True, help="Complete JSON or CSV child,parent manifest")
    item = commands.add_parser("associations")
    item.add_argument("--id", required=True)
    item.add_argument("--identifier", required=True)
    item.add_argument("--assets", help="JSON array of retained asset paths to keep; [] removes current selections")
    item.add_argument("--parents", help="JSON array of complete parent source identifiers to retain")
    for name in ("receive",):
        item = commands.add_parser(name)
        item.add_argument("--id", required=True)
        item.add_argument("--file", required=True, help="Unchanged native target CSV, or - for stdin")
        item.add_argument("--host", help="Actual target host recorded with this return")
        if name == "receive":
            item.add_argument("--kind", default="target", choices=("target", "map"))
    for name in ("inspect-target", "import-native-map", "prepare", "job"):
        item = commands.add_parser(name)
        item.add_argument("--id", required=True)
    for name in ("review", "finish"):
        item = commands.add_parser(name)
        item.add_argument("--id", required=True)
        item.add_argument("--operator", required=True)
        item.add_argument("--note", required=True)
    item = commands.add_parser("run")
    item.add_argument("--id", required=True)
    item.add_argument("--batch", required=True)
    item.add_argument("--workbench", required=True, help="Installed original Islandora Workbench script")
    item.add_argument("--python", help="Python executable from the Workbench environment")
    item.add_argument("--check", action="store_true", help="Run Workbench's native configuration and input check")
    item = commands.add_parser("log")
    item.add_argument("--id", required=True)
    item.add_argument("--run", required=True)
    item.add_argument("--offset", type=int, default=0)
    item.add_argument("--limit", type=int, default=65536)
    item = commands.add_parser("export")
    item.add_argument("--id", required=True)
    item.add_argument("--out", required=True, help="New ZIP path for the complete migration package")
    args = parser.parse_args(argv)
    ws = Workspace(args.workspace)
    try:
        desk = IslandoraDesk(ws)
        command = args.command
        if command == "state":
            result = desk_state(desk)
        elif command == "inventory":
            result = desk.inventory(args.build)
        elif command == "default-plan":
            result = desk.default_plan(args.build)
        elif command == "create":
            if args.config == "-" and args.plan == "-":
                raise InputError("Read only one JSON document from stdin at a time")
            result = desk.create(args.build, args.label, args.host,
                                 document(args.config) if args.config else None,
                                 document(args.plan) if args.plan else None, args.baseline)
        elif command == "configure":
            if args.host is None and args.config is None:
                raise InputError("Supply the actual target host or a settings document")
            result = desk.configure(args.id, args.host, document(args.config) if args.config else None)
        elif command == "rebuild":
            result = desk.rebuild(args.id, document(args.plan))
        elif command == "records":
            result = desk.records(args.id, args.offset, args.limit, args.kind, args.query)
        elif command == "record":
            result = desk.record(args.id, args.identifier)
        elif command == "edit":
            if not args.overrides and not args.choices:
                raise InputError("Supply the complete overrides and/or conflict choices document")
            if args.overrides == "-" and args.choices == "-":
                raise InputError("Read only one JSON document from stdin at a time")
            result = desk.edit(args.id, args.identifier,
                               document(args.overrides) if args.overrides else None,
                               document(args.choices) if args.choices else None)
        elif command == "attach":
            result = desk.attach(args.id, manifest_document(file_bytes(args.manifest), "assets"), args.asset_root)
        elif command == "relationships":
            result = desk.relationships(args.id, manifest_document(file_bytes(args.manifest), "relationships"))
        elif command == "associations":
            if args.assets is None and args.parents is None:
                raise InputError("Select the complete asset and/or parent list to retain")
            if args.assets == "-" and args.parents == "-":
                raise InputError("Read only one association document from stdin at a time")
            result = desk.associations(args.id, args.identifier,
                                       assets=document(args.assets) if args.assets else None,
                                       parents=document(args.parents) if args.parents else None)
        elif command == "receive":
            result = desk.receive(args.id, file_bytes(args.file), args.kind, args.host)
        elif command == "inspect-target":
            result = desk.inspect_target(args.id)
        elif command == "import-native-map":
            result = desk.import_native_map(args.id)
        elif command == "review":
            result = desk.review(args.id, args.operator, args.note)
        elif command == "prepare":
            result = desk.prepare(args.id)
        elif command == "job":
            result = desk.job(args.id)
        elif command == "run":
            result = native_run(desk, args)
        elif command == "log":
            result = log_page(desk, args.id, args.run, args.offset, args.limit)
        elif command == "finish":
            result = desk.finish(args.id, args.operator, args.note)
        elif command == "export":
            result = desk.export(args.id, args.out)
        else:
            raise InputError("Choose an Islandora desk command")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1 if command == "run" and not result["completed"] else 0
    finally:
        ws.close()

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print(json.dumps({"error": "Native execution stopped at its retained state."}), file=sys.stderr)
        sys.exit(130)
    except (InputError, OSError, ValueError, KeyError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(2)
