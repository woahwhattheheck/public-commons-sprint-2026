#!/usr/bin/env python3
"""MIT. Whole OECD project commands and original local server."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import signal
import sys
import threading

from bootstrap import HERE, InputError, json_bytes, load_json, private_write
from workspace import OecdWorkspace, bundle_from_manifest
from acquire import refresh_capture

COMMANDS = ("init", "status", "seed", "capture", "refresh", "preview", "save", "briefing", "compare",
            "activate", "export-dataset", "export-customer", "export-project", "import", "serve")


def parser():
    result = argparse.ArgumentParser(description="OECD leading-indicator analyst and native customer workspace")
    result.add_argument("command", choices=COMMANDS)
    result.add_argument("--project", required=True, help="Original private OECD project directory")
    result.add_argument("--create", action="store_true", help="Create the explicitly selected project")
    result.add_argument("--request", help="Complete JSON operation request file; '-' reads stdin")
    result.add_argument("--manifest", help="Original source-bundle manifest, including adjacent source bytes")
    result.add_argument("--packet", help="Complete original OECD project packet")
    result.add_argument("--id", help="Saved briefing identity")
    result.add_argument("--port", type=int, default=0)
    result.add_argument("--provider-username-env")
    result.add_argument("--provider-password-env")
    result.add_argument("--connection-file", help="Create-only private local operator connection file")
    return result


def read_request(path):
    if path is None:
        return {}
    data = sys.stdin.buffer.read(48 * 1024 * 1024 + 1) if path == "-" else Path(path).read_bytes()
    if len(data) > 48 * 1024 * 1024:
        raise InputError("Request exceeds 48 MiB")
    body = load_json(data)
    if not isinstance(body, dict):
        raise InputError("Request must be a JSON object")
    return body


def run(args):
    request = read_request(args.request)
    create = args.command == "init" or args.create
    with OecdWorkspace(args.project, create=create) as workspace:
        command = args.command
        if command in {"init", "status"}:
            return workspace.state()
        if command == "seed":
            bundle = bundle_from_manifest(HERE / "sources" / "bundle.json")
            if "operation_id" in request:
                bundle["operation_id"] = request["operation_id"]
            return workspace.capture(bundle)
        if command == "capture":
            return workspace.capture(bundle_from_manifest(args.manifest) if args.manifest else request)
        if command == "refresh":
            return refresh_capture(workspace, request)
        if command == "preview":
            return workspace.preview(request)
        if command == "save":
            return workspace.save_briefing(request)
        if command == "briefing":
            return workspace.briefing(args.id or request["briefing_id"])
        if command == "compare":
            return workspace.compare(request["before"], request["after"])
        if command == "activate":
            return workspace.activate(request["briefing_id"], request["expected_revision"], request.get("expected_current"))
        if command in {"export-dataset", "export-customer", "export-project"}:
            return getattr(workspace, command.replace("-", "_"))(args.id or request["briefing_id"])
        if command == "import":
            if not args.packet:
                raise InputError("Import requires --packet")
            return workspace.import_project(args.packet)
        if command == "serve":
            from server import OecdServer
            if not 0 <= args.port <= 65535:
                raise InputError("Port must be 0–65535")
            username = os.environ.get(args.provider_username_env) if args.provider_username_env else None
            password = os.environ.get(args.provider_password_env) if args.provider_password_env else None
            if bool(args.provider_username_env) != bool(args.provider_password_env) or (
                    args.provider_username_env and (username is None or password is None)):
                raise InputError("Set both existing provider credential environment references")
            server = OecdServer(workspace, args.port, username, password)
            connection = {"schema": "stellar-forge.oecd-connection.v1", "project_id": workspace.config["id"],
                          "project_directory": str(workspace.root), "base_url": server.origin,
                          "url": server.url, "token": server.token,
                          "provider": server.connection_info()}
            if args.connection_file:
                private_write(Path(args.connection_file).expanduser().absolute(), json_bytes(connection))
            def stop(signum, frame):
                threading.Thread(target=server.shutdown, daemon=True).start()
            signal.signal(signal.SIGTERM, stop)
            signal.signal(signal.SIGINT, stop)
            sys.stdout.buffer.write(json_bytes({"event": "oecd-ready", **connection}))
            sys.stdout.buffer.flush()
            try:
                server.serve_forever(poll_interval=0.25)
            finally:
                server.server_close()
            return None
        raise InputError("Unknown OECD command")


def main():
    os.umask(0o077)
    try:
        result = run(parser().parse_args())
        if result is not None:
            sys.stdout.buffer.write(json_bytes(result))
            sys.stdout.buffer.flush()
        return 0
    except (InputError, OSError, ValueError, KeyError) as error:
        sys.stderr.write(str(error) + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
