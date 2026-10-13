"""Command line for receiving, solving, retaining and reopening decisions."""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
from .schema import Study
from .engine import solve, frontier
from .native import from_experiment
from .operations import DecisionWorkspace


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def emit(value, output=None):
    text = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if output:
        # Atomic replacement of the explicitly supplied output path.
        import os, tempfile
        path = Path(output); path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name); handle.write(text); handle.flush(); os.fsync(handle.fileno())
        temporary.replace(path)
    else:
        sys.stdout.write(text)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    for name in ("validate", "solve", "frontier"):
        q = sub.add_parser(name); q.add_argument("study"); q.add_argument("--output")
        if name != "validate":
            q.add_argument("--objective", choices=["worst_case", "minimax_regret", "expected"], default="worst_case")
            q.add_argument("--time-limit", type=float, default=60)
        if name == "frontier":
            q.add_argument("--budgets", type=float, nargs="+", required=True)
    q = sub.add_parser("report"); q.add_argument("study"); q.add_argument("result"); q.add_argument("--format", choices=["html", "csv"], default="html"); q.add_argument("--output", required=True)
    q = sub.add_parser("from-native"); q.add_argument("summary"); q.add_argument("configuration"); q.add_argument("--output")
    for name in ("diagnostic-preview", "prepare-diagnostic"):
        q = sub.add_parser(name)
        q.add_argument("--workspace", required=True)
        q.add_argument("--diagnostic-id", required=True)
        q.add_argument("--output")
        if name == "prepare-diagnostic":
            q.add_argument("--report-sha256", required=True)
            q.add_argument("--configuration", required=True)
            q.add_argument("--operation-id")
    q = sub.add_parser("serve"); q.add_argument("--workspace", required=True); q.add_argument("--port", type=int, default=8772)
    for name in ("create", "receive", "list", "show", "export", "run"):
        q = sub.add_parser(name); q.add_argument("--workspace", required=True); q.add_argument("--output")
        if name in ("create", "receive"):
            q.add_argument("input")
        if name in ("show", "export", "run"):
            q.add_argument("study_id")
        if name in ("show", "run"):
            q.add_argument("--revision", type=int)
        if name == "run":
            q.add_argument("--objective", choices=["worst_case", "minimax_regret", "expected"], default="worst_case")
            q.add_argument("--time-limit", type=float, default=60)
    args = p.parse_args(argv)
    try:
        if args.command == "serve":
            import uvicorn
            from .service import create_app
            uvicorn.run(create_app(args.workspace), host="127.0.0.1", port=args.port)
            return 0
        if args.command == "report":
            from .reports import html_report, csv_report
            value = (html_report if args.format == "html" else csv_report)(read(args.study), read(args.result))
            Path(args.output).write_text(value, encoding="utf-8")
            return 0
        if args.command in ("diagnostic-preview", "prepare-diagnostic"):
            from model.workspace import Workspace
            from model.common import held
            from .diagnostics import preview
            original = Workspace(args.workspace)
            with held(original.root / ".workspace.lock"):
                if args.command == "diagnostic-preview":
                    value = preview(original, args.diagnostic_id)
                else:
                    value = DecisionWorkspace(original).import_diagnostic(
                        args.diagnostic_id, args.report_sha256, read(args.configuration),
                        operation_id=args.operation_id)
        elif args.command == "from-native":
            value = from_experiment(read(args.summary), read(args.configuration)).model_dump()
        elif args.command in ("validate", "solve", "frontier"):
            study = Study.model_validate(read(args.study))
            if args.command == "validate":
                value = {"valid": True, "candidates": len(study.candidates), "profiles": len(study.profiles), "metrics": len(study.metrics)}
            elif args.command == "solve":
                value = solve(study, args.objective, time_limit=args.time_limit)
            else:
                value = frontier(study, args.budgets, args.objective, time_limit=args.time_limit)
        else:
            ws = DecisionWorkspace(args.workspace)
            ws.recover()
            if args.command == "create": value = ws.store.create(read(args.input))
            elif args.command == "receive": value = ws.store.receive(read(args.input))
            elif args.command == "list": value = ws.store.list()
            elif args.command == "show": value = ws.store.read(args.study_id, args.revision)
            elif args.command == "export": value = ws.store.export(args.study_id)
            else:
                current = ws.store.read(args.study_id, args.revision)
                value = ws.solve(args.study_id, current["revision"], args.objective, time_limit=args.time_limit)
        emit(value, args.output)
        return 0
    except (ValueError, KeyError, OSError) as exc:
        print(json.dumps({"error": str(exc), "type": type(exc).__name__}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
