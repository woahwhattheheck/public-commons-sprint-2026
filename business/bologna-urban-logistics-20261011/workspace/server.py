#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from model import apply_action, backup_workspace, download_workspace, export_workspace, initialize, load_state, restore_workspace
from delivery import public_delivery

HERE = Path(__file__).resolve().parent
PUBLIC = HERE / "public"


class Handler(BaseHTTPRequestHandler):
    server_version = "BolognaWorkspace/1"

    def log_message(self, fmt, *args):
        print(f"{self.log_date_time_string()} {fmt % args}")

    def send_bytes(self, status: int, data: bytes, content_type: str, filename=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, status: int, value):
        self.send_bytes(status, json.dumps(value, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def do_GET(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/state":
                state = load_state(self.server.state_root)
                state["delivery"] = public_delivery(state)
                return self.send_json(200, state)
            if path == "/api/export":
                query = parse_qs(urlparse(self.path).query)
                data, content_type, filename = download_workspace(self.server.state_root, query.get("format", ["zip"])[0], query.get("publication", [None])[0])
                return self.send_bytes(200, data, content_type, filename)
            if path == "/api/health":
                state = load_state(self.server.state_root)
                return self.send_json(200, {"ok": True, "revision": state["revision"]})
            name = "index.html" if path == "/" else path.removeprefix("/")
            if name not in {"index.html", "app.js", "style.css", "delivery.js"}:
                return self.send_json(404, {"error": "NOT_FOUND"})
            data = (PUBLIC / name).read_bytes()
            return self.send_bytes(200, data, mimetypes.guess_type(name)[0] or "application/octet-stream")
        except ValueError as error:
            return self.send_json(400, {"error": "INVALID_REQUEST", "message": str(error)})
        except Exception as error:
            return self.send_json(500, {"error": type(error).__name__, "message": str(error)})

    def do_POST(self):
        if urlparse(self.path).path != "/api/action":
            return self.send_json(404, {"error": "NOT_FOUND"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 2 or length > 1_000_000:
                raise ValueError("JSON body must be 2–1000000 bytes")
            payload = json.loads(self.rfile.read(length))
            state, result = apply_action(self.server.state_root, payload)
            state["delivery"] = public_delivery(state)
            return self.send_json(200, {"state": state, "result": result})
        except RuntimeError as error:
            return self.send_json(409, {"error": "STALE_REVISION", "message": str(error)})
        except (ValueError, json.JSONDecodeError) as error:
            return self.send_json(400, {"error": "INVALID_REQUEST", "message": str(error)})
        except Exception as error:
            return self.send_json(500, {"error": type(error).__name__, "message": str(error)})


def parser():
    root = argparse.ArgumentParser(description="Bologna urban-logistics assessment workspace")
    commands = root.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init")
    init.add_argument("--source", required=True, type=Path)
    init.add_argument("--source-receipt", required=True, type=Path)
    init.add_argument("--state", required=True, type=Path)
    serve = commands.add_parser("serve")
    serve.add_argument("--state", required=True, type=Path)
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=0)
    export = commands.add_parser("export")
    export.add_argument("--state", required=True, type=Path)
    export.add_argument("--out", required=True, type=Path)
    export.add_argument("--publication", help="Export this exact retained publication ID")
    action = commands.add_parser("action", help="Apply a revision-guarded JSON action from a file")
    action.add_argument("--state", required=True, type=Path)
    action.add_argument("--input", required=True, type=Path)
    download = commands.add_parser("download", help="Write a complete delivery ZIP or printable report")
    download.add_argument("--state", required=True, type=Path)
    download.add_argument("--format", choices=("zip", "report", "framework", "learning", "factsheet", "cesf", "survey"), default="zip")
    download.add_argument("--publication")
    download.add_argument("--out", required=True, type=Path)
    backup = commands.add_parser("backup")
    backup.add_argument("--state", required=True, type=Path)
    backup.add_argument("--out", required=True, type=Path)
    restore = commands.add_parser("restore")
    restore.add_argument("--archive", required=True, type=Path)
    restore.add_argument("--state", required=True, type=Path)
    inspect = commands.add_parser("inspect")
    inspect.add_argument("--state", required=True, type=Path)
    return root


def main():
    args = parser().parse_args()
    if args.command == "init":
        result = initialize(args.source, args.source_receipt, args.state)
        print(json.dumps({"state": "INITIALIZED", "revision": result["revision"], "source": result["source"], "priorityPoints": len(result["baseline"]["observations"])}, ensure_ascii=False))
    elif args.command == "inspect":
        print(json.dumps(load_state(args.state), ensure_ascii=False, indent=2))
    elif args.command == "export":
        print(json.dumps(export_workspace(args.state, args.out, args.publication), ensure_ascii=False, indent=2))
    elif args.command == "action":
        state, result = apply_action(args.state, json.loads(args.input.read_text(encoding="utf-8")))
        print(json.dumps({"revision": state["revision"], "result": result}, ensure_ascii=False))
    elif args.command == "download":
        from model import sha256, write_atomic
        data, content_type, filename = download_workspace(args.state, args.format, args.publication)
        write_atomic(args.out, data)
        print(json.dumps({"path": str(args.out), "bytes": len(data), "sha256": sha256(data), "type": content_type}))
    elif args.command == "backup":
        print(json.dumps(backup_workspace(args.state, args.out), ensure_ascii=False, indent=2))
    elif args.command == "restore":
        print(json.dumps(restore_workspace(args.archive, args.state), ensure_ascii=False, indent=2))
    elif args.command == "serve":
        if not args.state.joinpath("workspace.json").exists():
            raise SystemExit("State workspace does not exist; run init first")
        server = ThreadingHTTPServer((args.host, args.port), Handler)
        server.state_root = args.state
        host, port = server.server_address
        print(f"Bologna workspace listening on http://{host}:{port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()


if __name__ == "__main__":
    main()

