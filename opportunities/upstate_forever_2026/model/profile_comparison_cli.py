"""Read, retain and export actual source-profile comparisons."""
from __future__ import annotations
import argparse
import json
from pathlib import Path

from .workspace import Workspace
from .profile_comparison import ProfileComparisons


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("catalog")
    commands.add_parser("list")
    for name in ("preview", "create"):
        command = commands.add_parser(name)
        command.add_argument("--selection", required=True, help="JSON with title, reference_profile_id, candidate_profile_ids and optional grid_id")
    for name in ("inspect", "export", "study-selection"):
        command = commands.add_parser(name)
        command.add_argument("comparison_id")
    args = parser.parse_args(argv)
    manager = ProfileComparisons(Workspace(args.workspace))
    if args.command in ("catalog", "list"):
        value = getattr(manager, args.command)()
    elif args.command in ("preview", "create"):
        selection = json.loads(Path(args.selection).read_text(encoding="utf-8-sig"))
        value = getattr(manager, args.command)(selection)
        if args.command == "create":
            value = {"comparison": value, "release": manager.export(value["id"])}
    elif args.command == "study-selection":
        value = manager.study_selection(args.comparison_id)
    else:
        value = getattr(manager, args.command)(args.comparison_id)
    print(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
