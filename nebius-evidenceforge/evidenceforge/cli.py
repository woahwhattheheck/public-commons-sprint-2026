from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .core import EvidenceError, MemorySandbox, compile_change, verify_receipt


def _read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="evidenceforge")
    sub = parser.add_subparsers(dest="command", required=True)

    demo = sub.add_parser("demo", help="compile the deterministic offline demo")
    demo.add_argument("--fixture", default="demo/scenario.json")
    demo.add_argument("--out", default="-")

    verify = sub.add_parser("verify", help="verify a receipt without executing tools")
    verify.add_argument("receipt")

    args = parser.parse_args(argv)
    try:
        if args.command == "demo":
            fixture = json.loads(_read(args.fixture))
            sandbox = MemorySandbox(
                files=fixture["sandbox"]["files"],
                tests={k: (v["exit_code"], v["output"]) for k, v in fixture["sandbox"]["tests"].items()},
            )
            receipt = compile_change(
                json.dumps(fixture["request"]),
                json.dumps(fixture["model_plan"]),
                sandbox,
                provider_evidence=fixture["provider_evidence"],
            )
            encoded = json.dumps(receipt, indent=2, sort_keys=True) + "\n"
            if args.out == "-":
                sys.stdout.write(encoded)
            else:
                Path(args.out).write_text(encoded, encoding="utf-8")
            return 0
        receipt = json.loads(_read(args.receipt))
        ok = verify_receipt(receipt)
        print("VALID" if ok else "INVALID")
        return 0 if ok else 2
    except (EvidenceError, OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
