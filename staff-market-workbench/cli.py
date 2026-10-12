#!/usr/bin/env python3
"""Run, reopen and restore the staff market workbench."""
import argparse
import json
from pathlib import Path
import sqlite3
import sys
import uuid
from core import Workspace, Problem, initialize, restore, strict_json, file_digest


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace", required=True)
    sub = p.add_subparsers(dest="command", required=True)
    q = sub.add_parser("init"); q.add_argument("--title", default="Staff market workbench")
    sub.add_parser("state")
    q = sub.add_parser("call"); q.add_argument("action"); q.add_argument("--request", required=True)
    q = sub.add_parser("records"); q.add_argument("kind"); q.add_argument("--query", default=""); q.add_argument("--offset", type=int, default=0); q.add_argument("--limit", type=int, default=100); q.add_argument("--all-editions", action="store_true")
    q = sub.add_parser("show"); q.add_argument("kind"); q.add_argument("identity")
    q = sub.add_parser("report"); q.add_argument("analysis_id"); q.add_argument("--format", choices=["csv", "json"], default="json"); q.add_argument("--output", required=True)
    q = sub.add_parser("backup"); q.add_argument("--operation-id", required=True)
    q = sub.add_parser("restore"); q.add_argument("--package", required=True)
    q = sub.add_parser("serve"); q.add_argument("--host", default="127.0.0.1"); q.add_argument("--port", type=int, default=0)
    a = p.parse_args()
    if a.command == "init": result = initialize(a.workspace, a.title)
    elif a.command == "restore": result = restore(a.package, a.workspace)
    elif a.command == "serve":
        from server import serve
        return serve(a.workspace, a.host, a.port)
    else:
        w = Workspace(a.workspace)
        if a.command == "state": result = w.state()
        elif a.command == "call": result = w.mutate(a.action, strict_json(Path(a.request).read_text(encoding="utf-8")))
        elif a.command == "records": result = w.records(a.kind, a.query, a.offset, a.limit, not a.all_editions)
        elif a.command == "show": result = w.document(a.kind, a.identity)
        elif a.command == "report":
            out = Path(a.output).expanduser().resolve()
            with out.open("xb") as f: f.write(w.report(a.analysis_id, a.format))
            result = {"path": str(out), "bytes": out.stat().st_size, "sha256": file_digest(out)}
        else:
            prepared = w.mutate("prepare_backup", {"operation_id": a.operation_id, "expected_revision": w.state()["workspace"]["revision"]})
            out = w.backup(prepared["result"]["id"])
            result = {"path": str(out), "bytes": out.stat().st_size, "sha256": file_digest(out), **prepared}
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    try: raise SystemExit(main())
    except (Problem, OSError, sqlite3.Error, ValueError, KeyError) as exc:
        print(json.dumps({"error": str(exc), "code": getattr(exc, "code", "NATIVE_ERROR")}), file=sys.stderr)
        raise SystemExit(2)
