"""Offline compiler/verifier CLI for Voice Incident Commander."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from incident_core import IncidentError, compile_packet, strict_json_loads, verify_packet
from review import render_review


def _read_json(path: Path):
    return strict_json_loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("compile")
    c.add_argument("turns", type=Path)
    c.add_argument("output", type=Path)
    v = sub.add_parser("verify")
    v.add_argument("packet", type=Path)
    r = sub.add_parser("report", help="render a verified packet as an offline transcript review")
    r.add_argument("packet", type=Path)
    r.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        if args.cmd == "compile":
            turns = _read_json(args.turns)
            if not isinstance(turns, list):
                raise IncidentError("turn fixture must be a JSON array")
            packet = compile_packet(turns)
            # Create-exclusive output: never overwrite evidence by accident.
            with args.output.open("x", encoding="utf-8", newline="\n") as fh:
                json.dump(packet, fh, indent=2, ensure_ascii=False, allow_nan=False)
                fh.write("\n")
            print(packet["receipt_sha256"])
            return 0
        packet = _read_json(args.packet)
        if args.cmd == "report":
            html = render_review(packet)
            with args.output.open("x", encoding="utf-8", newline="\n") as fh:
                fh.write(html)
            print(args.output)
            return 0
        ok = verify_packet(packet)
        print("VERIFIED" if ok else "INVALID")
        return 0 if ok else 2
    except (IncidentError, OSError, UnicodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
