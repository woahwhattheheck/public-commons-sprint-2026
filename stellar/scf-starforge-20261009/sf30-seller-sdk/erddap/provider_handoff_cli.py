#!/usr/bin/env python3
"""MIT. Provider intake preparation, immutable review, delivery and receiving."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
import provider_handoff as handoff
from erddap_source import InputError, jbytes, json_value, sha
from erddap_workspace import Workspace
from provider_handoff_workspace import HandoffStore

def output_file(path, raw, replace=False):
    target = Path(path).expanduser().resolve()
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if target.exists():
        if not target.is_file():
            raise InputError("Output destination is not a regular file")
        current = target.read_bytes()
        if current == raw:
            return {"path": str(target), "bytes": len(raw), "sha256": sha(raw), "reused": True}
        if not replace:
            raise InputError("Output already contains different bytes; choose a new path or explicitly use --replace")
    fd, temporary = tempfile.mkstemp(prefix="." + target.name + "-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw); f.flush(); os.fsync(f.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    return {"path": str(target), "bytes": len(raw), "sha256": sha(raw), "reused": False}

def load_profile(path):
    with Path(path).open("rb") as f:
        raw = f.read(handoff.MAX_PROFILE + 1)
    if len(raw) > handoff.MAX_PROFILE:
        raise InputError("Provider profile exceeds its supported budget")
    return json_value(raw)

def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace", help="Existing original ERDDAP workspace; init creates it")
    commands = p.add_subparsers(dest="command", required=True)
    def export_options(command, required=False):
        command.add_argument("--output", required=required)
        command.add_argument("--replace", action="store_true", help="Explicitly replace a different output file")
    for name in ["init", "state"]:
        export_options(commands.add_parser(name))
    c = commands.add_parser("source-draft")
    c.add_argument("capture"); export_options(c, True)
    c = commands.add_parser("source-review")
    c.add_argument("capture"); c.add_argument("profile")
    c.add_argument("--require-ready", action="store_true"); export_options(c)
    c = commands.add_parser("source-export")
    c.add_argument("capture"); c.add_argument("profile")
    c.add_argument("--parent"); c.add_argument("--mode", choices=["review", "ready"], default="review")
    export_options(c, True)
    c = commands.add_parser("draft"); c.add_argument("source"); export_options(c, True)
    for name in ["preview", "save"]:
        c = commands.add_parser(name); c.add_argument("source"); c.add_argument("profile")
        if name == "save": c.add_argument("--expected-head")
        export_options(c)
    c = commands.add_parser("show"); c.add_argument("revision"); export_options(c)
    c = commands.add_parser("history"); c.add_argument("source")
    c.add_argument("--offset", type=int, default=0); c.add_argument("--limit", type=int, default=100); export_options(c)
    c = commands.add_parser("export"); c.add_argument("revision")
    c.add_argument("--mode", choices=["review", "ready"], default="review"); export_options(c, True)
    c = commands.add_parser("receive"); c.add_argument("bundle"); export_options(c)
    c = commands.add_parser("received"); c.add_argument("receipt"); export_options(c)
    c = commands.add_parser("received-export"); c.add_argument("receipt"); export_options(c, True)
    return p

def main(argv=None):
    args = parser().parse_args(argv)
    workspace = None
    result = None
    try:
        direct = args.command.startswith("source-") or (args.command == "receive" and not args.workspace)
        if not direct:
            if not args.workspace: raise InputError("Choose --workspace for this retained-workspace command")
            workspace = Workspace(args.workspace, create=args.command == "init")
            store = HandoffStore(workspace)
        if args.command in {"init", "state"}:
            result = store.state()
        elif args.command.startswith("source-"):
            with Path(args.capture).open("rb") as f:
                original = handoff.Capture(f)
            if args.command == "source-draft":
                profile = handoff.draft_profile(original)
                reviewed = handoff.review(original, profile)
                result = {"sourceId": original.id, "profile": output_file(args.output, jbytes(profile), args.replace),
                    "review": reviewed["review"]}
                args.output = None
            elif args.command == "source-review":
                result = handoff.review(original, load_profile(args.profile))
            else:
                built = handoff.build_bundle(original, load_profile(args.profile), args.mode, args.parent)
                result = {"file": output_file(args.output, built["raw"], args.replace),
                    "manifest": built["manifest"], "review": built["review"]}
                args.output = None
        elif args.command == "draft":
            value = store.draft(args.source)
            result = {"sourceId": value["sourceId"], "head": value["head"],
                "profile": output_file(args.output, jbytes(value["profile"]), args.replace), "review": value["review"]}
            args.output = None
        elif args.command == "preview":
            result = store.preview(args.source, load_profile(args.profile))
        elif args.command == "save":
            result = store.save(args.source, load_profile(args.profile), args.expected_head)
        elif args.command == "show":
            result = store.get(args.revision)
        elif args.command == "history":
            result = store.history(args.source, args.offset, args.limit)
        elif args.command == "export":
            value = store.export(args.revision, args.mode)
            result = {k: v for k, v in value.items() if k != "path"}
            result["file"] = output_file(args.output, Path(value["path"]).read_bytes(), args.replace)
            args.output = None
        elif args.command == "receive":
            with Path(args.bundle).open("rb") as f:
                result = store.receive(f) if workspace else handoff.receive_bundle(f)
        elif args.command == "received":
            result = store.received(args.receipt)
        elif args.command == "received-export":
            path = store.received_path(args.receipt)
            result = output_file(args.output, path.read_bytes(), args.replace)
            args.output = None
        if args.output:
            receipt = output_file(args.output, jbytes(result), args.replace)
            print(json.dumps({"output": receipt, "status": "saved"}, ensure_ascii=False))
        else:
            print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False))
        if getattr(args, "require_ready", False) and not result["review"]["ready"]:
            return 3
        return 0
    except (InputError, OSError, ValueError) as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__, "status": getattr(e, "status", 400)}, ensure_ascii=False), file=sys.stderr)
        return 2
    finally:
        if workspace is not None:
            workspace.close()

if __name__ == "__main__":
    raise SystemExit(main())
