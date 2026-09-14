from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .core import TraceForgeError, analyze, verify_receipt
from .model import DemoModel, OpenAICompatibleModel
from .server import serve


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="traceforge", description="Evidence-grounded AI incident copilot")
    sub = parser.add_subparsers(dest="command", required=True)

    analyze_p = sub.add_parser("analyze", help="Analyze an incident evidence file")
    analyze_p.add_argument("file", type=Path)
    analyze_p.add_argument("--mode", choices=("demo", "live"), default="demo")
    analyze_p.add_argument("--json-out", type=Path)

    verify_p = sub.add_parser("verify", help="Verify a TraceForge analysis receipt offline")
    verify_p.add_argument("file", type=Path)

    serve_p = sub.add_parser("serve", help="Run local browser app/API")
    serve_p.add_argument("--host", default="127.0.0.1")
    serve_p.add_argument("--port", type=int, default=8080)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "analyze":
            text = args.file.read_text(encoding="utf-8")
            model = DemoModel() if args.mode == "demo" else OpenAICompatibleModel.from_env()
            result = analyze(text, model)
            rendered = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
            if args.json_out:
                args.json_out.write_text(rendered, encoding="utf-8")
                print(f"wrote {args.json_out} ({result['receipt']['run_id']})")
            else:
                sys.stdout.write(rendered)
            return 0
        if args.command == "verify":
            result = json.loads(args.file.read_text(encoding="utf-8"))
            valid = verify_receipt(result)
            print(json.dumps({"valid": valid}))
            return 0 if valid else 2
        if args.command == "serve":
            serve(args.host, args.port)
            return 0
        raise TraceForgeError("unknown command")
    except (OSError, json.JSONDecodeError, TraceForgeError) as exc:
        print(f"traceforge: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
