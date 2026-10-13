"""Use completed original geographic cases in the maintained Programmes desk."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model.common import atomic_json
from model.geographic_programme import adopt, preview, verify
from model.workspace import Workspace


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--geographic-id", required=True, help="Original geographic-headwaters prepared ID")
    parser.add_argument("--delivery-id", help="Optional completed mapped delivery using this baseline and selected original alternatives")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--expected-preview-id")
    parser.add_argument("--verify", type=Path, help="Verify an existing adoption JSON in this project or restored copy")
    args = parser.parse_args(argv)
    if args.verify and (args.preview or args.expected_preview_id or args.delivery_id):
        parser.error("--verify uses the original retained adoption's selections")
    ws = Workspace(args.workspace.resolve(strict=True))
    target = args.output.resolve()
    if target.is_relative_to(ws.root) or target.is_relative_to(APPLICATION):
        parser.error("Write the receiving result outside the original Workspace and application")
    if args.verify:
        if target == args.verify.resolve():
            parser.error("Preserve the original adoption and write verification separately")
        value = json.loads(args.verify.read_text(encoding="utf-8"))
        if value.get("geographic_id") != args.geographic_id:
            parser.error("The selected original geographic ID differs from the adoption")
        result = verify(ws, value)
    elif args.preview:
        result = preview(ws, args.geographic_id, delivery_id=args.delivery_id)
    else:
        # Preserve the owner's existing cutoff and receiving process. Reopening
        # an already-complete result after cutoff remains a read-only verify.
        from source_tools.demo_deadline import cutoff_guard
        previous = None
        if target.is_file():
            candidate = json.loads(target.read_text(encoding="utf-8"))
            if candidate.get("schema") == "upstate.geographic-programme-adoption/v1":
                previous = candidate
            elif candidate.get("schema") != "upstate.geographic-programme-preview/v1":
                raise ValueError("Preserve this existing output; select a new adoption result path")
        with cutoff_guard():
            result = adopt(ws, args.geographic_id, delivery_id=args.delivery_id,
                           expected_preview_id=args.expected_preview_id, previous=previous)
    atomic_json(target, result)
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))
    return 2 if result.get("ready") is False else 0


if __name__ == "__main__":
    raise SystemExit(main())
