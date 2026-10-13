"""Command interface for both retained source-refresh plan formats."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from . import source_refresh


def _parser():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--workspace", default=argparse.SUPPRESS,
                        help="Existing workspace directory; accepted before or after the command")
    common.add_argument("--output", default=argparse.SUPPRESS,
                        help="Also save the JSON result to this local path")
    parser = argparse.ArgumentParser(
        parents=[common],
        description="Compare and refresh retained source editions and saved native model selections.",
        epilog="Original diff/status/report/export commands and --from/--to/--mapping/--roots/"
               "--prepare-only/--progress forms are preserved. Use --legacy to select the "
               "original CLI explicitly, including its nested list output.")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("preview", "plan"):
        command = commands.add_parser(
            name, parents=[common],
            help="Inspect source differences" if name == "preview" else "Save an immutable refresh plan")
        command.add_argument("--selection", help="JSON object containing the source refresh selection")
        command.add_argument("--from-collection", dest="from_collection_id")
        command.add_argument("--to-collection", dest="to_collection_id")
        command.add_argument("--map", action="append", default=[], metavar="OLD_ID=NEW_ID",
                             help="Explicit source ID mapping; repeat for renamed sources")
        command.add_argument("--title")
    apply = commands.add_parser("apply", parents=[common],
                                 help="Apply or resume one retained refresh plan")
    apply.add_argument("plan_id")
    apply.add_argument("--run-models", action="store_true",
                       help="Complete refreshed native runs using verified original stages when inputs match")
    commands.add_parser("list", parents=[common],
                        help="List both saved formats with common engine and state fields")
    show = commands.add_parser("show", parents=[common],
                               help="Show one complete retained plan and its common execution view")
    show.add_argument("plan_id")
    return parser


def _command(argv):
    index = 0
    while index < len(argv):
        token = argv[index]
        if token in ("--workspace", "--output"):
            index += 2
        elif token.startswith("--workspace=") or token.startswith("--output="):
            index += 1
        elif token.startswith("-"):
            index += 1
        else:
            return token
    return None


def _legacy_route(argv):
    original = list(argv)
    explicit = "--legacy" in original
    if explicit:
        original.remove("--legacy")
    exclusive = {"--from", "--to", "--mapping", "--roots", "--prepare-only", "--progress"}
    selected = (explicit or _command(original) in ("diff", "status", "report", "export")
                or any(token.split("=", 1)[0] in exclusive for token in original))
    return selected, original


def _selection(args):
    value = {}
    if args.selection:
        value = json.loads(Path(args.selection).read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("Selection file must contain a JSON object")
    for field in ("from_collection_id", "to_collection_id", "title"):
        if getattr(args, field) is not None:
            value[field] = getattr(args, field)
    mapping = value.get("source_id_map") or {}
    if not isinstance(mapping, dict):
        raise ValueError("source_id_map in the selection file must be an object")
    mapping = dict(mapping)
    for item in args.map:
        if "=" not in item:
            raise ValueError("Each --map requires OLD_ID=NEW_ID")
        old, new = item.split("=", 1)
        if not old or not new:
            raise ValueError("Each --map requires two nonempty source IDs")
        if old in mapping and mapping[old] != new:
            raise ValueError("Conflicting source mappings supplied for " + old)
        mapping[old] = new
    value["source_id_map"] = mapping
    return value


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    route, original = _legacy_route(argv)
    if route:
        from .source_refresh_legacy_cli import main as legacy_main
        return legacy_main(original)
    parser = _parser()
    args = parser.parse_args(argv)
    if not getattr(args, "workspace", None):
        parser.error("--workspace is required")
    try:
        from .workspace import Workspace
        workspace = Workspace(Path(args.workspace))
        if args.command == "preview":
            result = source_refresh.preview(workspace, _selection(args))
        elif args.command == "plan":
            result = source_refresh.save_plan(workspace, _selection(args))
        elif args.command == "apply":
            plan = source_refresh.get_plan(workspace, args.plan_id)
            # Preserve the original root-selective CLI's execution default.
            # --prepare-only is routed through its unchanged parser above.
            execute = args.run_models or plan.get("engine") == "roots"
            result = source_refresh.apply_plan(workspace, args.plan_id, run_models=execute)
        elif args.command == "list":
            result = source_refresh.list_plans(workspace)
        else:
            result = source_refresh.get_plan(workspace, args.plan_id)
        output = json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
        if getattr(args, "output", None):
            from .common import atomic_bytes
            atomic_bytes(Path(args.output), output.encode("utf-8"))
        sys.stdout.write(output)
        if isinstance(result, dict) and result.get("state") == "failed":
            return 2
        if isinstance(result, dict) and result.get("schema") == source_refresh.PREVIEW_SCHEMA:
            return 2 if result.get("problems") else 0
        return 0
    except (ValueError, RuntimeError, OSError, KeyError) as exc:
        sys.stderr.write(json.dumps({"error_type": type(exc).__name__,
                                    "message": str(exc)}, ensure_ascii=False) + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
