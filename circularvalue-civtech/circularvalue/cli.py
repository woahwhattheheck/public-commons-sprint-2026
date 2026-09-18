from __future__ import annotations

import argparse
import json
from pathlib import Path

from .core import CircularValueError, canonical_json, compile_case, loads_strict, verify_packet
from .demo import synthetic_case


def _read(path: str) -> dict:
    p = Path(path)
    data = p.read_text(encoding="utf-8")
    value = loads_strict(data)
    if type(value) is not dict:
        raise CircularValueError("top-level JSON must be object")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="circularvalue")
    sub = parser.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("compile")
    c.add_argument("case")
    c.add_argument("--out", required=True)
    v = sub.add_parser("verify")
    v.add_argument("case")
    v.add_argument("packet")
    d = sub.add_parser("demo")
    d.add_argument("--out-dir", required=True)
    ns = parser.parse_args(argv)
    try:
        if ns.cmd == "compile":
            case = _read(ns.case)
            packet = compile_case(case)
            Path(ns.out).write_text(canonical_json(packet) + "\n", encoding="utf-8")
            print(packet["decisionSupportState"], packet["packetSha256"])
            return 0
        if ns.cmd == "verify":
            case = _read(ns.case)
            packet = _read(ns.packet)
            ok = verify_packet(case, packet)
            print("VALID" if ok else "INVALID")
            return 0 if ok else 2
        out = Path(ns.out_dir)
        out.mkdir(parents=True, exist_ok=True)
        case = synthetic_case()
        packet = compile_case(case)
        case_path = out / "case.json"
        packet_path = out / "packet.json"
        case_path.write_text(canonical_json(case) + "\n", encoding="utf-8")
        packet_path.write_text(canonical_json(packet) + "\n", encoding="utf-8")
        print(case_path)
        print(packet_path)
        print(packet["decisionSupportState"], packet["packetSha256"])
        return 0
    except (OSError, CircularValueError) as exc:
        print(f"ERROR: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
