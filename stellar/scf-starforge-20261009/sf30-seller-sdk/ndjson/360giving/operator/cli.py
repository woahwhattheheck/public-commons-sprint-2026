#!/usr/bin/env python3
"""MIT. Saved 360Giving publisher operations and complete native handoff."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import os
from pathlib import Path
import shutil
import signal
import stat
import sys
import tempfile

from publisher_workspace import PublisherWorkspace, InputError, file_info, sync_dir, publisher, load_json
from operator_server import OperatorServer


@contextmanager
def connection_file(filename, url):
    if not filename:
        yield
        return
    destination = Path(filename).expanduser().absolute()
    raw = (url + "\n").encode("utf-8")
    fd, name = tempfile.mkstemp(prefix=".360giving-connection-", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        try:
            os.link(name, destination)
        except FileExistsError as error:
            raise InputError("Use the existing console connection, or remove its file after that process closes") from error
    finally:
        Path(name).unlink(missing_ok=True)
    try:
        yield
    finally:
        try:
            info = destination.lstat()
            if stat.S_ISREG(info.st_mode) and destination.read_bytes() == raw:
                destination.unlink()
        except FileNotFoundError:
            pass


def copy_delivery(source, destination):
    destination = Path(destination).expanduser().absolute()
    expected = file_info(source)
    if destination.exists():
        if file_info(destination) != expected:
            raise InputError("The selected handoff output already contains a different original file")
        return str(destination)
    fd, name = tempfile.mkstemp(prefix=".360giving-handoff-", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as out, source.open("rb") as inp:
            shutil.copyfileobj(inp, out, 1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        if file_info(name) != expected:
            raise InputError("The full copied handoff differs from its saved delivery")
        try:
            os.link(name, destination)
        except FileExistsError:
            if file_info(destination) != expected:
                raise InputError("The selected handoff output was claimed by different bytes")
        sync_dir(destination.parent)
    finally:
        Path(name).unlink(missing_ok=True)
    return str(destination)


def parser():
    p = argparse.ArgumentParser(description="Save publisher reviews, build complete native grants datasets, and receive their full handoff")
    location = p.add_mutually_exclusive_group(required=True)
    location.add_argument("--workspace", help="Original private operator workspace")
    location.add_argument("--connection", help="Original console or saved Applications connection file")
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("init")
    sub.add_parser("state")
    sub.add_parser("binding")
    upload = sub.add_parser("upload")
    upload.add_argument("--file", required=True)
    review = sub.add_parser("review")
    review.add_argument("--edition", required=True)
    review.add_argument("--decision")
    for command in ("request", "resume"):
        child = sub.add_parser(command)
        child.add_argument("--id", required=True)
    intake = sub.add_parser("intake")
    intake.add_argument("--dataset", required=True, help="Stable dataset key; separate funds use separate keys")
    intake.add_argument("--label", required=True)
    intake.add_argument("--source-url", required=True)
    intake.add_argument("--source", required=True)
    intake.add_argument("--registry", required=True)
    intake.add_argument("--capture")
    intake.add_argument("--transport")
    decisions = sub.add_parser("decisions")
    decisions.add_argument("--edition", required=True)
    decisions.add_argument("--file", required=True)
    candidate = sub.add_parser("candidate")
    candidate.add_argument("--edition", required=True)
    candidate.add_argument("--decision", required=True)
    build = sub.add_parser("build")
    build.add_argument("--edition", required=True)
    build.add_argument("--candidate")
    compare = sub.add_parser("compare")
    compare.add_argument("--dataset", required=True)
    compare.add_argument("--before", required=True)
    compare.add_argument("--after", required=True)
    export = sub.add_parser("export")
    export.add_argument("--edition", required=True)
    export.add_argument("--decision")
    export.add_argument("--candidate")
    export.add_argument("--out", help="Copy the complete saved handoff to this new path")
    receive = sub.add_parser("receive")
    receive.add_argument("--file", required=True)
    for child in (intake, decisions, candidate, build, compare, export, receive):
        child.add_argument("--request", required=True, help="Stable request ID retained before work starts")
    query = sub.add_parser("query")
    query.add_argument("--dataset", required=True)
    query.add_argument("--build", required=True)
    query.add_argument("--params", default='{"limit":"25"}', help="Original native scalar-string query object")
    native = sub.add_parser("native-state")
    native.add_argument("--dataset", required=True)
    changes = sub.add_parser("changes")
    changes.add_argument("--dataset", required=True)
    changes.add_argument("--comparison", required=True)
    changes.add_argument("--offset", type=int, default=0)
    changes.add_argument("--limit", type=int, default=50)
    full_changes = sub.add_parser("changes-file")
    full_changes.add_argument("--dataset", required=True)
    full_changes.add_argument("--comparison", required=True)
    full_changes.add_argument("--out", required=True)
    serve = sub.add_parser("serve")
    serve.add_argument("--port", type=int, default=0)
    serve.add_argument("--expected-binding", help="Retain the exact reviewed Applications source and workspace")
    serve.add_argument("--connection-file", help="Create one private console connection file")
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    if args.connection:
        from client import remote_command
        print(publisher.exact(remote_command(args, copy_delivery)), flush=True)
        return 0
    if args.command in {"binding", "serve"}:
        from managed import require_binding, launch_record
        selected_binding = require_binding(args.workspace, getattr(args, "expected_binding", None))
        if args.command == "binding":
            print(publisher.exact(selected_binding), flush=True)
            return 0
    with PublisherWorkspace(args.workspace, create=args.command == "init") as ws:
        def upload(path):
            with Path(path).expanduser().open("rb") as source:
                return ws.upload(source)["id"]
        command = args.command
        if command in {"init", "state"}:
            result = ws.state()
        elif command == "upload":
            with Path(args.file).expanduser().open("rb") as source:
                result = ws.upload(source)
        elif command == "review":
            result = ws.review(args.edition, args.decision)
        elif command == "request":
            result = ws.request(args.id)
        elif command == "resume":
            result = ws.execute(args.id)
        elif command == "query":
            result = ws.query(args.dataset, args.build, load_json(args.params))
        elif command == "native-state":
            result = ws.native_state(args.dataset)
        elif command == "changes":
            result = ws.changes(args.dataset, args.comparison, args.offset, args.limit)
        elif command == "changes-file":
            with ws.mutex:
                native = ws._dataset(args.dataset)
                selected = next((item for item in native.state()["comparisons"] if item["id"] == args.comparison), None)
                if selected is None:
                    raise InputError("Select an original saved comparison")
                destination = copy_delivery(native.comparison_file(args.comparison), args.out)
                result = {"comparison": selected, "copiedTo": destination, **file_info(destination)}
        elif command == "serve":
            selected_binding = require_binding(args.workspace, selected_binding["sha256"])
            server = OperatorServer(ws, args.port)
            server.launch_record = launch_record(server, selected_binding)
            old = signal.getsignal(signal.SIGTERM)
            def stop(*_):
                raise KeyboardInterrupt
            signal.signal(signal.SIGTERM, stop)
            try:
                with connection_file(args.connection_file, server.url):
                    print(publisher.exact(server.launch_record), flush=True)
                    server.serve_forever(poll_interval=0.25)
            except KeyboardInterrupt:
                pass
            finally:
                server.server_close()
                signal.signal(signal.SIGTERM, old)
            return 0
        else:
            if command == "intake":
                body = {"dataset": args.dataset, "label": args.label, "sourceUrl": args.source_url,
                        **{key: upload(getattr(args, key)) if getattr(args, key) else None
                           for key in ("source", "registry", "capture", "transport")}}
            elif command == "decisions":
                body = {"edition": args.edition, "object": upload(args.file)}
            elif command == "candidate":
                body = {"edition": args.edition, "decision": args.decision}
            elif command == "build":
                body = {"edition": args.edition, "candidate": args.candidate}
            elif command == "compare":
                body = {"dataset": args.dataset, "before": args.before, "after": args.after}
            elif command == "export":
                body = {"edition": args.edition, "decision": args.decision, "candidate": args.candidate}
            elif command == "receive":
                body = {"object": upload(args.file)}
            else:
                raise InputError("Unknown original publisher operation")
            ws.admit(args.request, command, body)
            result = ws.execute(args.request)
            if command == "export" and args.out:
                result = {**result, "copiedTo": copy_delivery(ws.delivery(args.request), args.out)}
        print(publisher.exact(result), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (InputError, publisher.PublisherError, ValueError, KeyError, OSError) as error:
        print(publisher.exact({"error": str(error), "type": type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)
