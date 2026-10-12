#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Prepare, publish, restore and receive complete native QGIS/QWC editions."""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import json
import os
from pathlib import Path
import re
import signal
import sys
import time
import uuid
from urllib.parse import urlsplit
from urllib.request import Request, ProxyHandler, build_opener

from contract import (QwcError, need, read_json, json_bytes, digest, directory,
                      writer, original_gis)
from host import NativeContext
from workspace import QwcWorkspace
from portable import (DEFAULT_MAX_BYTES, export_publication, receive_publication,
                      inspect_received, reopen_received)
from managed import (STARTUP_SCHEMA, require_binding, startup,
                     published_connection, private_file)


def parser():
    value = argparse.ArgumentParser(description=__doc__)
    source = value.add_mutually_exclusive_group()
    source.add_argument("--workspace", help="Original private publishing workspace")
    source.add_argument("--received", help="Complete independently received publication")
    value.add_argument("--qgis-python", help="Existing QGIS Python for a received publication")
    action = value.add_subparsers(dest="action", required=True)
    init = action.add_parser("init", help="Retain an existing native host profile")
    init.add_argument("--profile", required=True)
    inspect = action.add_parser("inspect", help="Open original editions and deployment history")
    inspect.add_argument("--request-id")
    inspect.add_argument("--verify", action="store_true")
    inspect.add_argument("--offset", type=int, default=0)
    inspect.add_argument("--limit", type=int, default=50)
    gis = action.add_parser("inspect-gis", help="List exact saved maps in an original QGIS workspace")
    gis.add_argument("--directory", required=True)
    prepare = action.add_parser("prepare", help="Receive and review a complete selected native map")
    prepare.add_argument("--request", required=True)
    review = action.add_parser("review", help="Open the retained complete publication review")
    review.add_argument("--request-id", required=True)
    publish = action.add_parser("publish", help="Generate and publish the exact reviewed edition")
    publish.add_argument("--request-id", required=True)
    publish.add_argument("--review-sha256", required=True)
    rollback = action.add_parser("rollback", help="Restore the selected original host before-images")
    rollback.add_argument("--request-id", required=True)
    rollback.add_argument("--publication-sha256", required=True)
    export = action.add_parser("export", help="Export the complete source/operator publication")
    export.add_argument("--request-id", required=True)
    export.add_argument("--export-id", required=True)
    export.add_argument("--out", required=True)
    receive = action.add_parser("receive", help="Receive the same complete original archive")
    receive.add_argument("--archive", required=True)
    receive.add_argument("--sha256", required=True)
    receive.add_argument("--out", required=True)
    receive.add_argument("--max-archive-bytes", type=int, default=DEFAULT_MAX_BYTES)
    inspect_received_action = action.add_parser("inspect-received", help="Verify every received original member")
    inspect_received_action.add_argument("--metadata-only", action="store_true")
    reopen = action.add_parser("reopen", help="Reopen the relocated original project with actual QGIS")
    reopen.add_argument("--invocation-id", help="Original native invocation to resume; omit for a fresh reopen")
    action.add_parser("binding", help="Read the complete managed application source and host binding")
    serve = action.add_parser("serve", help="Open the private publication or receiving operator")
    serve.add_argument("--port", type=int, default=0)
    serve.add_argument("--connection-file")
    serve.add_argument("--expected-binding")
    serve.add_argument("--startup-format", choices=("text", "json"), default="text")
    serve.add_argument("--max-archive-bytes", type=int, default=DEFAULT_MAX_BYTES)
    stop = action.add_parser("stop", help="Stop the original live console and drain its native operation")
    stop.add_argument("--connection-file", required=True)
    live = action.add_parser("status", help="Read the same original live console")
    live.add_argument("--connection-file", required=True)
    return value


def selected_root(args):
    need(args.workspace or args.received, "WORKSPACE_REQUIRED",
         "Select the original publishing workspace or complete receiving directory.")
    return args.received or args.workspace


def live_console(args, stop=False):
    path = Path(args.connection_file).expanduser().absolute()
    private_file(path)
    body = path.read_bytes()
    need(len(body) <= 4096, "CONNECTION_FILE_INVALID", "Use the original private console connection.")
    url = urlsplit(body.decode("utf-8").strip())
    need(url.scheme == "http" and url.hostname == "127.0.0.1" and url.port and
         url.path == "/" and not url.query and not url.username and not url.password and
         re.fullmatch(r"[A-Za-z0-9_-]{43}", url.fragment),
         "CONNECTION_FILE_INVALID", "Use this original loopback console capability.")
    origin = "http://127.0.0.1:" + str(url.port)
    auth = {"Authorization": "Bearer " + url.fragment}
    opener = build_opener(ProxyHandler({}))
    def call(route, payload=None):
        request = Request(origin + route, data=None if payload is None else json_bytes(payload),
                          headers=auth | ({"Content-Type": "application/json"} if payload is not None else {}),
                          method="GET" if payload is None else "POST")
        with opener.open(request, timeout=10) as response:
            value = response.read(1024 * 1024 + 1)
            need(len(value) <= 1024 * 1024, "CONSOLE_RESPONSE_LIMIT", "The original console returned an oversized response.")
            return json.loads(value)
    observed = call("/api/launch")
    root = str(directory(selected_root(args)))
    need(observed.get("schema") == STARTUP_SCHEMA and observed.get("status") == "QWC_OPERATOR_READY" and
         observed.get("workspace") == root and observed.get("mode") == ("received" if args.received else "publisher"),
         "LIVE_OPERATOR_CHANGED", "The connection belongs to a different original operator.")
    expected_id = inspect_received(root, verify=False)["receipt"]["publicationId"] if args.received else QwcWorkspace(root).marker["id"]
    need(observed.get("workspaceId") == expected_id, "LIVE_OPERATOR_CHANGED",
         "The live process owns a different original workspace identity.")
    return call("/api/stop", {}) if stop else call("/api/state")


def run(args, ctx, active):
    if args.action == "init":
        need(args.workspace and not args.received, "WORKSPACE_REQUIRED", "Choose the new original publishing workspace.")
        ws = QwcWorkspace.create(args.workspace, read_json(args.profile)[0])
        return ws.inspect()
    if args.action == "inspect-gis":
        ws = original_gis().QgisWorkspace(args.directory)
        state = ws.read()
        return {"directory": str(ws.root), "workspaceId": state["id"], "revision": state["revision"],
                "title": state["title"], "projects": state["projects"]}
    if args.action == "receive":
        return receive_publication(args.archive, args.out, args.sha256,
                                   max_bytes=args.max_archive_bytes, context=ctx)
    if args.action in ("stop", "status"):
        return live_console(args, args.action == "stop")
    root = selected_root(args)
    if args.action == "inspect-received":
        need(args.received, "RECEIVING_DIRECTORY_REQUIRED", "Select the complete original receiving directory.")
        return inspect_received(root, verify=not args.metadata_only, progress=ctx.checkpoint)
    if args.action == "reopen":
        need(args.received, "RECEIVING_DIRECTORY_REQUIRED", "Select the complete original receiving directory.")
        invocation = args.invocation_id or "reopen-" + uuid.uuid4().hex
        print(json_bytes({"nativeInvocation": {"action": "reopen", "invocationId": invocation,
                         "received": str(root)}}).decode("utf-8").rstrip(), file=sys.stderr, flush=True)
        return reopen_received(root, args.qgis_python, invocation_id=invocation, context=ctx)
    if args.action == "binding":
        return require_binding(root, received=bool(args.received), qgis_python=args.qgis_python)
    if args.action == "serve":
        from server import Console
        need(0 <= args.port <= 65535, "PORT_INVALID", "Choose an available local operator port.")
        binding = require_binding(root, args.expected_binding, received=bool(args.received), qgis_python=args.qgis_python)
        server = None
        with writer(root, ".qwc-console.lock") as fd:
            try:
                server = Console(root, received=bool(args.received), qgis_python=args.qgis_python,
                                 port=args.port, max_archive_bytes=args.max_archive_bytes,
                                 lease_fds=(fd,))
                active["server"] = server
                if ctx.first_signal is not None:
                    server.request_stop(ctx.first_signal)
                ctx.checkpoint()
                with published_connection(args.connection_file, server.url) as connection:
                    try:
                        server.launch = startup(server, binding, connection)
                        print(json_bytes(server.launch).decode("utf-8").rstrip() if args.startup_format == "json"
                              else "QWC operator: " + server.url, flush=True)
                        server.run()
                    finally:
                        # Keep the original connection through exceptional native and HTTP drain too.
                        server.close()
                        server = None
            finally:
                if server is not None:
                    server.close()
                active["server"] = None
        return None
    need(args.workspace and not args.received, "PUBLISHER_WORKSPACE_REQUIRED",
         "Select the original publishing workspace.")
    ws = QwcWorkspace(args.workspace)
    if args.action == "inspect":
        return ws.inspect(args.request_id, verify=args.verify, offset=args.offset, limit=args.limit)
    if args.action == "prepare":
        return ws.prepare(read_json(args.request)[0], context=ctx)
    if args.action == "review":
        return ws.review(args.request_id)
    if args.action == "publish":
        return ws.publish(args.request_id, args.review_sha256, context=ctx)
    if args.action == "rollback":
        return ws.rollback(args.request_id, args.publication_sha256, context=ctx)
    if args.action == "export":
        return export_publication(ws, args.request_id, args.out, args.export_id, context=ctx)
    raise QwcError("ACTION_REQUIRED", "Choose an original operator action.")


def main(argv=None):
    args = parser().parse_args(argv)
    need(sys.version_info >= (3, 11), "PYTHON_VERSION", "The original operator requires Python 3.11 or newer.")
    active = {"server": None, "progressAt": 0.0}
    def progress(info):
        current = time.monotonic()
        if current - active["progressAt"] >= 1:
            print(json_bytes({"progress": info}).decode("utf-8").rstrip(), file=sys.stderr, flush=True)
            active["progressAt"] = current
    ctx = NativeContext(progress)
    def stop(signum, _frame):
        ctx.stop(signum)
        if active["server"] is not None:
            active["server"].request_stop(signum)
    previous = {}
    try:
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous[signum] = signal.signal(signum, stop)
        result = run(args, ctx, active)
        if result is not None:
            print(json_bytes(result).decode("utf-8").rstrip(), flush=True)
        return 128 + ctx.first_signal if ctx.first_signal is not None else 0
    except (QwcError, ValueError, KeyError, OSError) as error:
        print(json_bytes({"error": {"code": getattr(error, "code", type(error).__name__),
                                    "message": str(error), "details": getattr(error, "details", {})}}).decode("utf-8").rstrip(),
              file=sys.stderr, flush=True)
        return 128 + ctx.first_signal if ctx.first_signal is not None else 2
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


if __name__ == "__main__":
    raise SystemExit(main())
