"""Preview and return actual saved fieldwork through its original Monitoring campaign."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--campaign-id", required=True)
    parser.add_argument("--campaign-revision-id", required=True)
    parser.add_argument("--fieldwork-revision", type=int, required=True)
    parser.add_argument("--entry", action="append", dest="entries")
    parser.add_argument("--event-time", action="append", default=[],
                        help="Original cancelled visit ID=actual ISO timestamp including timezone")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--operation-id",
                        help="Original native return operation; required with --apply")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    from model.workspace import Workspace
    from model.monitoring_workspace import MonitoringWorkspace
    from model import monitoring_field_return
    times = {}
    for value in args.event_time:
        key, separator, timestamp = value.partition("=")
        if not separator or not key or not timestamp or key in times:
            parser.error("--event-time must specify one distinct original VISIT_ID=ISO_TIMESTAMP")
        times[key] = timestamp
    if args.apply and not args.operation_id:
        parser.error("--apply requires the original --operation-id")
    service = MonitoringWorkspace(Workspace(args.workspace))
    parameters = {
        "campaign_id": args.campaign_id, "expected_revision_id": args.campaign_revision_id,
        "plan_revision": args.fieldwork_revision, "selected_entry_ids": args.entries,
        "event_times": times,
    }
    result = monitoring_field_return.preview(service, **parameters)
    if args.apply:
        parameters["selected_entry_ids"] = result["selection"]["selected_entry_ids"]
        result = monitoring_field_return.receive(
            service, **parameters, expected_request_id=result["request_id"],
            operation_id=args.operation_id)
    body = json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8") as stream:
            stream.write(body)
    print(body, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
