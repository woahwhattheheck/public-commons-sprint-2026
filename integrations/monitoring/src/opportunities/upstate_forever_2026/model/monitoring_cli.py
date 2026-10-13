"""Native Workspace CLI: JSON input/output uses the same operator action router."""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
from .monitoring_common import ContractError, canonical_bytes, load_json
from .workspace import Workspace
from .monitoring_actions import invoke as route_monitoring


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Source-bound monitoring network and campaign operations")
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("action", help="network.import, design, frontier, campaign.create, campaign.revise, campaign.event, export, ...")
    parser.add_argument("--params", type=Path, help="JSON parameter file; omit to read standard input, or use capabilities")
    parser.add_argument("--output", type=Path, help="write complete response JSON to a file")
    args = parser.parse_args(argv)
    try:
        params = load_json(args.params) if args.params else ({} if args.action in {"capabilities", "campaign.list", "source.catalog"} else json.load(sys.stdin))
        result = route_monitoring(Workspace(args.workspace), args.action, params)
        data = canonical_bytes({"ok": True, "result": result}) + b"\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_bytes(data)
        else: sys.stdout.buffer.write(data)
        return 0
    except (ContractError, json.JSONDecodeError, OSError) as exc:
        sys.stderr.write(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False) + "\n")
        return 2


if __name__ == "__main__": raise SystemExit(main())
