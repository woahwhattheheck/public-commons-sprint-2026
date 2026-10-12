#!/usr/bin/env python3
"""Study source refresh: original intake, frozen mappings, review and full delivery."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from application import call
from delivery import archive_package, receive_package, verify_package
from model import StudyError, default_mapping, parse, read
from workspace import Workspace, close_active_intakes


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", help="Private operator workspace")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init")
    sub.add_parser("status")
    command = sub.add_parser("catalog")
    command.add_argument("--sources", nargs="+", dest="source_ids")
    command.add_argument("--search", default="")
    command.add_argument("--offset", type=int, default=0)
    command.add_argument("--limit", type=int, default=100)
    command = sub.add_parser("import-source")
    command.add_argument("--provider", choices=("acs", "acs_api", "bls", "hud"), required=True)
    command.add_argument("--source", required=True)
    command.add_argument("--expected-sha256", dest="expected_input_sha256")
    command.add_argument("--node")
    command = sub.add_parser("receive-source-files")
    command.add_argument("--provider", choices=("acs", "bls"), required=True)
    command.add_argument("--checkout", required=True)
    command.add_argument("--session", required=True)
    command.add_argument("--node")
    command.add_argument("--capture-id", dest="expected_capture_id")
    command.add_argument("--timeout", type=int, default=360)
    command = sub.add_parser("receive-observations")
    command.add_argument("--source-id", required=True)
    command.add_argument("--projection", required=True)
    command.add_argument("--checkout", required=True)
    command.add_argument("--session", required=True)
    command.add_argument("--node")
    command.add_argument("--timeout", type=int, default=360)
    command = sub.add_parser("receive-scan")
    command.add_argument("--scan-file", required=True)
    command.add_argument("--expected-sha256", dest="expected_input_sha256")
    target = command.add_mutually_exclusive_group(required=True)
    target.add_argument("--provider", choices=("acs", "bls"))
    target.add_argument("--source-id")
    command.add_argument("--projection")
    command.add_argument("--node")
    command.add_argument("--capture-id", dest="expected_capture_id")
    command = sub.add_parser("mapping-template")
    command.add_argument("--name", default="Canonical retained export")
    for kind in ("portfolio", "mapping"):
        command = sub.add_parser(kind)
        command.add_argument("--file", required=True)
    command = sub.add_parser("freeze")
    command.add_argument("--sources", nargs="+", required=True, dest="source_ids")
    command.add_argument("--portfolio", required=True, dest="portfolio_id")
    command.add_argument("--mapping", required=True, dest="mapping_id")
    command.add_argument("--label", required=True)
    command = sub.add_parser("compare")
    command.add_argument("--candidate", required=True, dest="candidate_id")
    command.add_argument("--baseline", dest="baseline_id")
    command.add_argument("--mode", choices=("same_period", "successive_release"), default="same_period")
    command.add_argument("--note", default="")
    command.add_argument("--unchanged", choices=("accept", "review"), default="accept")
    command = sub.add_parser("review")
    command.add_argument("--comparison", required=True, dest="comparison_id")
    selection = command.add_mutually_exclusive_group(required=True)
    selection.add_argument("--keys-file")
    selection.add_argument("--kind", choices=("added", "removed", "changed", "unchanged", "incomparable", "ambiguous", "all"))
    command.add_argument("--action", choices=("accept", "exclude"), required=True)
    command.add_argument("--operator", required=True)
    command.add_argument("--note", default="")
    command.add_argument("--expected-version", type=int, required=True)
    command = sub.add_parser("export")
    command.add_argument("--comparison", required=True, dest="comparison_id")
    command.add_argument("--expected-version", type=int, required=True)
    command.add_argument("--operator", required=True)
    command.add_argument("--label", required=True)
    command.add_argument("--out", dest="destination")
    command = sub.add_parser("verify")
    command.add_argument("package")
    command = sub.add_parser("receive")
    command.add_argument("package")
    command.add_argument("--out", required=True)
    command = sub.add_parser("import-package")
    command.add_argument("package")
    command = sub.add_parser("archive")
    command.add_argument("package")
    command.add_argument("--out", required=True)
    command = sub.add_parser("call")
    command.add_argument("operation")
    command.add_argument("--arguments", required=True, help="JSON object file for the documented operation")
    command = sub.add_parser("serve")
    command.add_argument("--port", type=int, default=0)
    command.add_argument("--open", action="store_true", dest="open_browser")
    args = vars(parser.parse_args(argv))
    name = args.pop("command")
    directory = args.pop("workspace")
    if name == "verify":
        return verify_package(args["package"])
    if name == "receive":
        return receive_package(args["package"], args["out"])
    if name == "archive":
        return archive_package(args["package"], args["out"])
    if name == "mapping-template":
        return default_mapping(args["name"])
    if not directory:
        parser.error("--workspace is required for this command")
    if name == "serve":
        from server import serve
        return serve(directory, **args)
    workspace = Workspace(directory)
    try:
        if name in ("init", "status"):
            return workspace.overview()
        if name == "review":
            if args["keys_file"]:
                keys = parse(read(Path(args.pop("keys_file")), 16 * 1024 * 1024))
                args.pop("kind")
            else:
                args.pop("keys_file")
                kind = args.pop("kind")
                keys = workspace.review_keys(args["comparison_id"], "" if kind == "all" else kind)
            return workspace.review(keys=keys, **args)
        if name in ("portfolio", "mapping"):
            return workspace.save_revision(name, parse(read(Path(args["file"]), 4 * 1024 * 1024)))
        if name == "call":
            return call(workspace, args["operation"], parse(read(Path(args["arguments"]), 4 * 1024 * 1024)))
        operations = {
            "catalog": "catalog", "import-source": "source.import",
            "receive-source-files": "source.receive_files", "receive-observations": "source.receive_rows",
            "receive-scan": "source.receive_scan",
            "freeze": "edition.freeze", "compare": "comparison.create", "export": "export.create",
            "import-package": "package.import",
        }
        return call(workspace, operations[name], args)
    finally:
        workspace.close()


if __name__ == "__main__":
    try:
        result = main()
        if result is not None:
            print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
    except KeyboardInterrupt:
        close_active_intakes()
        raise SystemExit(130)
    except Exception as error:
        print(json.dumps({"ok": False, "code": getattr(error, "code", type(error).__name__),
                          "details": getattr(error, "details", {}), "message": str(error)},
                         ensure_ascii=False, default=str), file=sys.stderr)
        raise SystemExit(1)
