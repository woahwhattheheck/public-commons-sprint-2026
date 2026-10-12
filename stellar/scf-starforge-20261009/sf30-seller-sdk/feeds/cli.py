"""MIT. Operator CLI for retained RSS/Atom feeds."""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import signal
import sys
import threading

from feed_workspace import FeedWorkspace, DEFAULT_FIELDS, InputError, json_bytes, load_json, file_digest, checked_id
from operations import execute

def read_json(path):
    data = Path(path).read_bytes()
    if len(data) > 16 * 1024 * 1024:
        raise InputError("JSON input exceeds 16 MiB")
    return load_json(data)

def output(value):
    sys.stdout.buffer.write(json_bytes(value))
    sys.stdout.buffer.flush()

def options():
    p = argparse.ArgumentParser(description="Retain, review and publish RSS 2.0 / Atom 1.0 feeds through the original XML and SF30 dataset engine.")
    p.add_argument("--workspace", required=True, help="Private workspace directory; create with init")
    sub = p.add_subparsers(dest="command", required=True)
    from subscriptions_cli import add_arguments
    add_arguments(sub)
    sub.add_parser("init")
    sub.add_parser("binding", help="Inspect the original private workspace, selected Python and complete console source")
    s = sub.add_parser("serve"); s.add_argument("--port", type=int, default=0)
    s.add_argument("--expected-binding", help="Reviewed original managed binding SHA-256")
    s.add_argument("--startup-format", choices=("legacy","json"), default="legacy")
    s.add_argument("--landing", choices=("feeds","subscriptions"), default="feeds")
    sub.add_parser("state")
    s = sub.add_parser("register")
    s.add_argument("--feed", required=True); s.add_argument("--config", required=True)
    s.add_argument("--revision", required=True, type=int); s.add_argument("--operation", required=True)
    s = sub.add_parser("capture")
    s.add_argument("--feed", required=True); s.add_argument("--operation", required=True)
    s.add_argument("--pages", type=int, default=100); s.add_argument("--one-page", action="store_true")
    s.add_argument("--force", action="store_true"); s.add_argument("--from-capture")
    s = sub.add_parser("resume"); s.add_argument("--capture", required=True)
    s = sub.add_parser("import")
    s.add_argument("--feed", required=True); s.add_argument("--file", required=True)
    s.add_argument("--url"); s.add_argument("--operation", required=True)
    s = sub.add_parser("captures"); s.add_argument("--feed", required=True)
    s.add_argument("--offset", type=int, default=0); s.add_argument("--limit", type=int, default=50)
    s = sub.add_parser("review"); s.add_argument("--capture", required=True)
    s.add_argument("--offset", type=int, default=0); s.add_argument("--limit", type=int, default=50)
    s = sub.add_parser("requests"); s.add_argument("--capture", required=True)
    s = sub.add_parser("apply"); s.add_argument("--capture", required=True)
    s.add_argument("--revision", required=True, type=int); s.add_argument("--operation", required=True)
    s.add_argument("--decisions"); s.add_argument("--accept-identity", action="store_true")
    s = sub.add_parser("records"); s.add_argument("--feed", required=True); s.add_argument("--query", default="")
    s.add_argument("--state", choices=("active", "deleted", "all"), default="active")
    s.add_argument("--offset", type=int, default=0); s.add_argument("--limit", type=int, default=50)
    s = sub.add_parser("annotate"); s.add_argument("--feed", required=True); s.add_argument("--identity", required=True)
    s.add_argument("--revision", required=True, type=int); s.add_argument("--operation", required=True)
    s.add_argument("--review", required=True, help="JSON note, tags, starred")
    s = sub.add_parser("edition"); s.add_argument("--feeds", required=True); s.add_argument("--name", required=True)
    s.add_argument("--fields", default=",".join(DEFAULT_FIELDS)); s.add_argument("--revisions", required=True)
    s.add_argument("--operation", required=True)
    s = sub.add_parser("query"); s.add_argument("--edition", required=True); s.add_argument("--params")
    s = sub.add_parser("compare"); s.add_argument("--before", required=True); s.add_argument("--after", required=True)
    s = sub.add_parser("changes"); s.add_argument("--comparison", required=True)
    s.add_argument("--offset", type=int, default=0); s.add_argument("--limit", type=int, default=50)
    for name in ("export", "project"):
        s = sub.add_parser(name); s.add_argument("--edition", required=True); s.add_argument("--out", required=True)
    s = sub.add_parser("receive"); s.add_argument("--file", required=True); s.add_argument("--operation", required=True)
    s = sub.add_parser("source"); s.add_argument("--sha256", required=True); s.add_argument("--out", required=True)
    s = sub.add_parser("action"); s.add_argument("--file", required=True, help="Same JSON action accepted by the console API")
    return p.parse_args()

def main():
    a = options()
    if a.command == "binding":
        from managed import inspect_binding
        output(inspect_binding(a.workspace)); return
    if a.command == "serve" and a.expected_binding is not None:
        from managed import require_binding
        require_binding(a.workspace, a.expected_binding)
    with FeedWorkspace(a.workspace, create=a.command == "init") as ws:
        c = a.command
        if c == "serve":
            from server import OperatorServer
            if not 0 <= a.port <= 65535:
                raise InputError("Choose a port from 0 to 65535")
            binding = None
            if a.startup_format == "json" or a.expected_binding is not None:
                from managed import require_binding
                binding = require_binding(ws.root, a.expected_binding)
            server = OperatorServer(ws, a.port)
            previous = {}
            def stop(signum, frame):
                ws.cancel_capture()
                raise KeyboardInterrupt()
            try:
                for signum in (signal.SIGINT, signal.SIGTERM):
                    previous[signum] = signal.signal(signum, stop)
                if a.startup_format == "json":
                    from managed import startup
                    server.launch = startup(server, binding, a.landing)
                    output(server.launch)
                else:
                    url = server.url if a.landing == "feeds" else server.origin + "/subscriptions#" + server.token
                    output({"console": url, "workspace": str(ws.root)})
                server.serve_forever(poll_interval=0.25)
            except KeyboardInterrupt:
                pass
            finally:
                ws.cancel_capture()
                server.server_close()
                server.join_worker()
                for signum, handler in previous.items():
                    signal.signal(signum, handler)
            return
        if c == "subscriptions":
            from subscriptions_cli import run_command
            result = run_command(ws, a, read_json, execute)
        elif c in ("init", "state"):
            result = ws.feed_state()
        elif c == "register":
            result = ws.register(a.feed, read_json(a.config), a.revision, a.operation)
        elif c == "capture":
            result = ws.capture(a.feed, a.operation, page_limit=a.pages, follow_pages=not a.one_page, force=a.force, from_capture=a.from_capture)
        elif c == "resume":
            result = ws.resume_capture(a.capture)
        elif c == "import":
            result = ws.import_source(a.feed, Path(a.file).read_bytes(), a.operation, a.url)
        elif c == "captures":
            result = ws.captures(a.feed, a.offset, a.limit)
        elif c == "review":
            result = ws.review(a.capture, a.offset, a.limit)
        elif c == "requests":
            result = ws.requests(a.capture)
        elif c == "apply":
            result = ws.apply(a.capture, a.revision, a.operation, read_json(a.decisions) if a.decisions else {}, a.accept_identity)
        elif c == "records":
            result = ws.records(a.feed, query=a.query, state=a.state, offset=a.offset, limit=a.limit)
        elif c == "annotate":
            result = ws.annotate(a.feed, a.identity, a.revision, a.operation, **read_json(a.review))
        elif c == "edition":
            result = ws.edition_summary(ws.edition(a.feeds.split(","), a.name, a.fields.split(","), a.operation, read_json(a.revisions)))
        elif c == "query":
            result = ws.query(ws.edition_view(a.edition)["buildId"], read_json(a.params) if a.params else {})
        elif c == "compare":
            result = ws.compare(ws.edition_view(a.before)["buildId"], ws.edition_view(a.after)["buildId"])
        elif c == "changes":
            result = ws.comparison_page(a.comparison, a.offset, a.limit)
        elif c == "export":
            result = ws.export_edition(a.edition, a.out)
        elif c == "project":
            result = ws.export_project(a.edition, Path(a.out))
        elif c == "receive":
            result = ws.receive_project(Path(a.file), a.operation)
        elif c == "source":
            source = ws.root / "sources" / (checked_id(a.sha256) + ".xml")
            if file_digest(source) != a.sha256:
                raise InputError("Retained source bytes differ")
            with source.open("rb") as inp, Path(a.out).open("xb") as out:
                Path(a.out).chmod(0o600); shutil.copyfileobj(inp, out)
            result = {"file": str(Path(a.out).absolute()), "sha256": a.sha256}
        else:
            result = execute(ws, read_json(a.file))
        output(result)

if __name__ == "__main__":
    try:
        main()
    except (InputError, ValueError, KeyError, OSError) as error:
        sys.stderr.write("Feeds: " + str(error) + "\n")
        sys.exit(1)
