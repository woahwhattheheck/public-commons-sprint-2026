"""Command-line access to the original native portfolio workspace."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
from . import NativeMPXJ, PortfolioError, PortfolioWorkspace


def read(value, default=None):
    return default if value is None else json.loads(Path(value).read_text("utf-8"))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", help="Original private portfolio workspace directory")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("runtime", help="Inspect installed MPXJ/Java and exact JAR hashes")
    listing = commands.add_parser("editions")
    listing.add_argument("--cursor", default="")
    listing.add_argument("--limit", type=int, default=25)
    for name in ("edition", "review-record", "operation"):
        command = commands.add_parser(name)
        command.add_argument("id")
    intake = commands.add_parser("intake")
    intake.add_argument("--request", required=True)
    intake.add_argument("--source", required=True)
    intake.add_argument("--label", required=True)
    intake.add_argument("--profile")
    intake.add_argument("--companions")
    review = commands.add_parser("review")
    review.add_argument("--edition", required=True)
    review.add_argument("--target", default="mspdi")
    review.add_argument("--target-profile")
    for name in ("mappings", "decisions", "corrections"):
        review.add_argument("--" + name)
    apply = commands.add_parser("apply")
    apply.add_argument("--request", required=True)
    apply.add_argument("--review", required=True)
    export = commands.add_parser("export-mspdi")
    export.add_argument("--request", required=True)
    export.add_argument("--edition", required=True)
    export.add_argument("--profile")
    compare = commands.add_parser("compare")
    compare.add_argument("left")
    compare.add_argument("right")
    compare.add_argument("--identity-map")
    compare.add_argument("--strict-identity", action="store_true")
    archive = commands.add_parser("archive")
    archive.add_argument("--output", required=True)
    receive = commands.add_parser("receive")
    receive.add_argument("--archive", required=True)
    receive.add_argument("--destination", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "runtime":
            result = NativeMPXJ().ensure()
        elif args.command == "receive":
            result = PortfolioWorkspace.receive_workspace(args.archive, args.destination)
        else:
            if not args.workspace:
                parser.error("--workspace is required for this command")
            ws = PortfolioWorkspace(args.workspace)
            if args.command == "editions":
                result = ws.list_editions(args.cursor, args.limit)
            elif args.command == "edition":
                result = ws.read_edition(args.id)
            elif args.command == "review-record":
                result = ws.read_review(args.id)
            elif args.command == "operation":
                result = ws.status(args.id)
            elif args.command == "intake":
                result = ws.intake(args.request, args.source, label=args.label,
                                   profile=read(args.profile), companions=read(args.companions, []))
            elif args.command == "review":
                result = ws.review(args.edition, target_profile=read(args.target_profile, args.target),
                                   mappings=read(args.mappings), decisions=read(args.decisions),
                                   corrections=read(args.corrections))
            elif args.command == "apply":
                result = ws.apply_review(args.request, args.review)
            elif args.command == "export-mspdi":
                result = ws.export_mspdi(args.request, args.edition, profile=read(args.profile))
            elif args.command == "compare":
                result = ws.compare(args.left, args.right, identity_map=read(args.identity_map),
                                    strict_identity=args.strict_identity)
            else:
                result = ws.export_workspace(args.output)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (PortfolioError, OSError, ValueError) as error:
        detail = error.as_dict() if isinstance(error, PortfolioError) else {"code": type(error).__name__, "message": str(error)}
        print(json.dumps({"error": detail}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
