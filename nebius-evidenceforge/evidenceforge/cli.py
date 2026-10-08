from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .core import EvidenceError, MemorySandbox, compile_change, verify_receipt, strict_json_loads


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

    plan = sub.add_parser("plan", help="request a validated plan from Nebius Token Factory")
    plan.add_argument("--request", required=True)
    plan.add_argument("--model", help="current NVIDIA/Nemotron model; defaults to NEBIUS_MODEL")
    plan.add_argument("--out", default="-")

    replay = sub.add_parser("replay", help="replay a saved plan in MemorySandbox with synthetic test outputs")
    replay.add_argument("--plan", required=True, help="saved plan command output")
    replay.add_argument("--fixture", required=True, help="human-selected sandbox scenario")
    replay.add_argument("--out", default="-")

    args = parser.parse_args(argv)
    try:
        if args.command == "plan":
            from .provider import generate_plan

            if args.out != "-" and Path(args.request).resolve() == Path(args.out).resolve():
                raise EvidenceError("plan output must differ from the input request")
            request_raw = _read(args.request)
            result = generate_plan(request_raw, model=args.model)
            encoded = json.dumps({
                "request": strict_json_loads(request_raw),
                "plan": strict_json_loads(result.content),
                "provider_evidence": result.evidence(),
            }, indent=2, sort_keys=True) + "\n"
            if args.out == "-":
                sys.stdout.write(encoded)
            else:
                Path(args.out).write_text(encoded, encoding="utf-8")
            return 0
        if args.command in {"demo", "replay"}:
            if args.command == "replay" and args.out != "-":
                output = Path(args.out).resolve()
                if output in {Path(args.plan).resolve(), Path(args.fixture).resolve()}:
                    raise EvidenceError("replay output must differ from both inputs")
            fixture = strict_json_loads(_read(args.fixture))
            if args.command == "replay":
                bundle = strict_json_loads(_read(args.plan))
                if not isinstance(bundle, dict) or set(bundle) != {"request", "plan", "provider_evidence"}:
                    raise EvidenceError("saved plan must contain request, plan, and provider_evidence")
                if not isinstance(bundle["provider_evidence"], dict):
                    raise EvidenceError("saved provider_evidence must be an object")
                if bundle["request"] != fixture["request"]:
                    raise EvidenceError("saved request must match the human-selected fixture request")
                plan = bundle["plan"]
                evidence = bundle["provider_evidence"]
            else:
                plan = fixture["model_plan"]
                evidence = fixture["provider_evidence"]
            sandbox = MemorySandbox(
                files=fixture["sandbox"]["files"],
                tests={k: (v["exit_code"], v["output"]) for k, v in fixture["sandbox"]["tests"].items()},
            )
            receipt = compile_change(
                json.dumps(fixture["request"]),
                json.dumps(plan),
                sandbox,
                provider_evidence=evidence,
            )
            if args.command == "replay":
                print("MemorySandbox replay: synthetic test outputs; no inference or real tests executed.", file=sys.stderr)
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
