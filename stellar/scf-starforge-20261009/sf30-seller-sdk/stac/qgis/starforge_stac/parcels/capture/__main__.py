# SPDX-License-Identifier: MIT
"""Original public parcel capture: python -m starforge_stac.parcels.capture."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys

from .providers import CaptureError, response_summary, json_bytes
from .workspace import CaptureWorkspace
from ..intake import ParcelIntake

def parser():
    result = argparse.ArgumentParser(description="Capture and resume original Pittsburgh parcel publishers.")
    commands = result.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="Freeze a named source refresh.")
    init.add_argument("--directory", required=True)
    init.add_argument("--label", required=True)
    init.add_argument("--actor", required=True)
    init.add_argument("--capture-id")
    for command in ("status", "advance", "retry", "finalize"):
        command_parser = commands.add_parser(command)
        command_parser.add_argument("--directory", required=True)
        if command == "advance":
            command_parser.add_argument("--max-requests", type=int, default=8)
            command_parser.add_argument("--timeout", type=int, default=45)
        elif command == "retry":
            command_parser.add_argument("--job", required=True)
            command_parser.add_argument("--reason", required=True)
        elif command == "finalize":
            command_parser.add_argument("--accept-publisher-change-reason")
    verify = commands.add_parser("verify", help="Validate retained receiving bytes without requesting publishers.")
    verify.add_argument("--directory", required=True)
    verify.add_argument("--expected-manifest-sha256")
    return result

def run(args):
    workspace = CaptureWorkspace(args.directory)
    if args.command == "init":
        return workspace.initialize(label=args.label, actor=args.actor, capture_id=args.capture_id)
    if args.command == "status": return workspace.status()
    if args.command == "advance":
        return workspace.advance(max_requests=args.max_requests, timeout=args.timeout)
    if args.command == "retry": return workspace.retry(args.job, args.reason)
    if args.command == "finalize":
        return workspace.finalize(accept_publisher_change_reason=args.accept_publisher_change_reason)
    intake = ParcelIntake(Path(args.directory), args.expected_manifest_sha256)
    checked = []
    for item in intake.files:
        if item["family"] in ("county-assessment-json", "pittsburgh-parcels-geojson"):
            summary = response_summary({**item, "id": item["path"]},
                                       (intake.root / item["path"]).read_bytes())
            if summary["status"] != "COMPLETE":
                raise CaptureError("CAPTURE_INCOMPLETE", "A selected retained response is incomplete.", path=item["path"])
            checked.append({"path": item["path"], "records": summary["records"],
                            "missingKeys": summary["missingKeys"]})
    prepared = intake.prepare()
    return {"schema": "starforge.parcel-capture-verification.v1", "status": "COMPLETE",
            "manifestSha256": intake.id, "summary": prepared["summary"],
            "verifiedLookupResponses": len(checked),
            "countyMissingKeys": sorted({key for row in checked if any(
                f["path"] == row["path"] and f["family"] == "county-assessment-json" for f in intake.files)
                for key in row["missingKeys"]}),
            "geometryMissingKeys": sorted({key for row in checked if any(
                f["path"] == row["path"] and f["family"] == "pittsburgh-parcels-geojson" for f in intake.files)
                for key in row["missingKeys"]})}

def main():
    args = parser().parse_args()
    try:
        result = run(args)
        print(json_bytes(result).decode("utf-8"), end="")
        return 0
    except Exception as error:
        result = error.value() if isinstance(error, CaptureError) else {
            "code": getattr(error, "code", "CAPTURE_FAILED"), "message": str(error)}
        print(json_bytes({"status": "ERROR", "error": result}).decode("utf-8"), end="", file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
