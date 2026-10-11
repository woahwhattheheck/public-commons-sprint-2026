#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from model import apply_action, backup_workspace, export_workspace, initialize, load_state, restore_workspace

HERE = Path(__file__).resolve().parent
PUBLIC = HERE / "public"


class Handler(BaseHTTPRequestHandler):
    server_version = "BolognaWorkspace/1"

    def log_message(self, fmt, *args):
        print(f"{self.log_date_time_string()} {fmt % args}")

    def send_bytes(self, status: int, data: bytes, content_type: str):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, status: int, value):
        self.send_bytes(status, json.dumps(value, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def do_GET(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/state":
                return self.send_json(200, load_state(self.server.state_root))
            if path == "/api/health":
                state = load_state(self.server.state_root)
                return self.send_json(200, {"ok": True, "revision": state["revision"]})
            name = "index.html" if path == "/" else path.removeprefix("/")
            if name not in {"index.html", "app.js", "style.css"}:
                return self.send_json(404, {"error": "NOT_FOUND"})
            data = (PUBLIC / name).read_bytes()
            return self.send_bytes(200, data, mimetypes.guess_type(name)[0] or "application/octet-stream")
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
        print(json.dumps(export_workspace(args.state, args.out), ensure_ascii=False, indent=2))
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
