"""Multi-case delivery agenda commands in the original Operations CLI."""
from __future__ import annotations

import re

import operations_agenda as agenda
from model import canonical


def register(command):
    for name, help_text in (
        ("delivery-agenda", "Read the full delivery agenda across selected original cases"),
        ("delivery-agenda-export", "Export the complete selected-case agenda as ICS, CSV or JSON"),
    ):
        target = command(name, help_text)
        target.add_argument("--case", dest="agenda_cases", action="append", required=True,
                            help="Original case ID; repeat for each selected case")
        target.add_argument("--as-of", help="Original YYYY-MM-DD calendar date; defaults to current UTC date")
        target.add_argument("--case-version", action="append", default=[],
                            help="CASE_ID=VERSION; when used, supply every selected case")
        if name == "delivery-agenda-export":
            target.add_argument("--format", dest="agenda_format", choices=("ics", "csv", "json"), default="ics")
            target.add_argument("--output", required=True, help="New destination for the complete agenda")
        else:
            target.add_argument("--output", help="New private JSON filename; omission prints the complete JSON")


def operates(action):
    return action in ("delivery-agenda", "delivery-agenda-export")


def operate(operations, args, publish):
    versions = {} if args.case_version else None
    for value in args.case_version:
        match = re.fullmatch(r"(operation-[a-f0-9]{32})=([1-9][0-9]{0,7})", value)
        if not match or match[1] in versions:
            agenda.domain.fail("Supply each original CASE_ID=VERSION once.", "INVALID_AGENDA_VERSIONS")
        versions[match[1]] = int(match[2])
    report = operations.delivery_agenda(args.agenda_cases, args.as_of, versions)
    if args.operation == "delivery-agenda-export":
        return {"selection": report["selection"], "format": args.agenda_format,
                "output": publish(args.output, agenda.export_bytes(report, args.agenda_format))}
    if args.output:
        return {"selection": report["selection"],
                "output": publish(args.output, (canonical(report) + "\n").encode("utf-8"))}
    return report
