"""Headless delivery operations through the original SF47 Workspace owner."""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import tempfile

from model import Problem, MAX_BUNDLE, canonical
from operations import Operations, MAX_SOURCE


def register(subparsers, common):
    root = subparsers.add_parser("operations", parents=[common],
        help="Retained delivery, work, invoices, cash, deployments and review")
    actions = root.add_subparsers(dest="operation", required=True)
    def command(name, description, case=False, output=False):
        target = actions.add_parser(name, help=description, description=description)
        if case:
            target.add_argument("--case", required=True, help="Original operations case ID")
        if output:
            target.add_argument("--output", help="New private JSON filename; omission prints JSON")
        return target
    def mutation(target, version=False):
        target.add_argument("--actor", required=True, help="Recording operator, retained in the original history")
        target.add_argument("--request-id", required=True, help="Stable ID; reuse exact inputs to resume")
        if version:
            target.add_argument("--expected-version", type=int, required=True)
        target.add_argument("--note", default="", help="Reason or review note")
    def selection(target):
        target.add_argument("--plan", required=True)
        target.add_argument("--selected-revision", type=int, required=True)
        target.add_argument("--expected-content-sha256", required=True)
        target.add_argument("--name", required=True)
        target.add_argument("--calendar-start", help="Explicit operational YYYY-MM-DD anchor; does not record an award")

    target = command("list", "List delivery operations cases", output=True)
    target.add_argument("--plan")
    target = command("create", "Pin a saved plan and open an operations or walkthrough case")
    selection(target); mutation(target)
    target.add_argument("--mode", choices=("OPERATIONS", "WALKTHROUGH"), required=True)
    for name in ("show", "report"):
        command(name, "Read the complete retained " + name, case=True, output=True)
    target = command("history", "Page the original operations event history", case=True, output=True)
    target.add_argument("--after", type=int, default=0)
    target.add_argument("--limit", type=int, default=100)
    target = command("command", "Apply an original action with an explicit reviewed version", case=True)
    mutation(target, version=True)
    target.add_argument("--action", required=True)
    target.add_argument("--data", required=True, help="JSON file containing the action data object")
    target = command("attach", "Attach exact original source bytes", case=True)
    mutation(target, version=True)
    target.add_argument("--file", required=True)
    target.add_argument("--kind", choices=("invoice", "work", "grant", "payment", "deployment", "purchase", "other"), default="other")
    target.add_argument("--media-type", default="application/octet-stream")
    target.add_argument("--source-url", default="")
    target.add_argument("--observed-at", required=True)
    target = command("source", "Export one exact retained source attachment", case=True)
    target.add_argument("--source", required=True)
    target.add_argument("--output", required=True)
    target = command("review", "Read one complete frozen review", case=True, output=True)
    target.add_argument("--review", required=True)
    target = command("export", "Export source, planner history, operations, reviews and CSV reports", case=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--output", required=True)
    target = command("import", "Receive and reopen a complete operations bundle")
    target.add_argument("--file", required=True)
    target.add_argument("--name", required=True)
    mutation(target)
    target = command("support-preview", "Review an original merchant support handoff for this delivery case", case=True, output=True)
    target.add_argument("--file", required=True, help="Original SF74 portable support handoff")
    target.add_argument("--expected-version", type=int, required=True)
    target = command("support-receive", "Attach reviewed support source and native report to a deployment", case=True, output=True)
    mutation(target, version=True)
    target.add_argument("--file", required=True, help="Same original support file used for preview")
    target.add_argument("--expected-preview-sha256", required=True)
    deployment = target.add_mutually_exclusive_group(required=True)
    deployment.add_argument("--deployment", help="Original deployment ID from this operations case")
    deployment.add_argument("--deployment-file", help="JSON fields for a new original deployment")
    target = command("completion-calendar", "Read payment-derived completion clocks and original award dates", case=True, output=True)
    target.add_argument("--as-of", help="Explicit YYYY-MM-DD calendar date; defaults to current UTC date")
    target = command("completion-seed", "Open the original tranche assignments without saving", case=True, output=True)
    target.add_argument("--tranche", type=int, choices=(1, 2, 3), required=True)
    target.add_argument("--expected-version", type=int, required=True)
    target = command("completion-preview", "Preview completed deliverables against their actual previous payment", case=True, output=True)
    target.add_argument("--data", required=True, help="JSON with receiptId, asOfDate and summary")
    target.add_argument("--expected-version", type=int, required=True)
    target = command("completion-save", "Save the complete original tranche assignment input", case=True, output=True)
    target.add_argument("--inputs", required=True, help="Original completion-seed inputs JSON, edited by the operator")
    mutation(target, version=True)
    for verb in ("prepare", "extension", "submit", "decision"):
        target = command("completion-" + verb, "Retain the original completion " + verb + " through its case journal", case=True, output=True)
        target.add_argument("--data", required=True, help="Native completion action data JSON")
        mutation(target, version=True)
    target = command("completion-export", "Download the frozen form preparation and its exact selected sources", case=True)
    target.add_argument("--review", required=True)
    target.add_argument("--output", required=True)
    target = command("forecast-preview", "Calculate a dated forecast from current original records", case=True, output=True)
    target.add_argument("--inputs", required=True, help="Forecast input JSON file")
    target.add_argument("--expected-version", type=int, required=True)
    target = command("forecast-save", "Save exactly the reviewed forecast and its original source snapshot", case=True, output=True)
    mutation(target, version=True)
    target.add_argument("--inputs", required=True, help="Same forecast input JSON used for preview")
    target.add_argument("--expected-preview-sha256", required=True)
    command("forecasts", "List immutable saved forecasts", case=True, output=True)
    target = command("forecast-show", "Reopen the complete original saved forecast", case=True, output=True)
    target.add_argument("--forecast", required=True)
    target = command("forecast-export", "Download the complete saved forecast and dated cash/work CSVs", case=True)
    target.add_argument("--forecast", required=True)
    target.add_argument("--output", required=True)
    target = command("portfolio-seed", "Prepare allocation inputs from one original saved forecast", case=True, output=True)
    target.add_argument("--forecast", required=True)
    target.add_argument("--expected-version", type=int, required=True)
    for verb in ("portfolio-preview", "portfolio-save"):
        target = command(verb, "Calculate or retain source-bound delivery alternatives", case=True, output=True)
        target.add_argument("--inputs", required=True)
        if verb == "portfolio-save":
            mutation(target, version=True)
            target.add_argument("--expected-preview-sha256", required=True)
        else:
            target.add_argument("--expected-version", type=int, required=True)
    command("portfolios", "List retained delivery allocations", case=True, output=True)
    for verb in ("portfolio-show", "portfolio-export", "portfolio-selection"):
        target = command(verb, "Reopen, export or select an original saved allocation", case=True, output=verb != "portfolio-export")
        target.add_argument("--portfolio", required=True)
        if verb == "portfolio-export":
            target.add_argument("--output", required=True)
        if verb == "portfolio-selection":
            target.add_argument("--alternative", required=True)
            target.add_argument("--expected-version", type=int, required=True)
    target = command("intake", "Import a supplied original pre-award source packet without inferring receipts")
    selection(target); mutation(target)
    target.add_argument("--file", required=True)


def read_bytes(filename, maximum=MAX_BUNDLE):
    path = Path(filename).expanduser().resolve()
    with path.open("rb") as stream:
        raw = stream.read(maximum + 1)
    if len(raw) > maximum:
        raise Problem("Input exceeds its retained-source bound.", 413, "INPUT_TOO_LARGE")
    return raw


def publish(filename, raw):
    """Private exact output; an existing destination is never replaced."""
    destination = Path(filename).expanduser().absolute()
    if not destination.parent.is_dir():
        raise Problem("Output directory does not exist.", 422, "OUTPUT_DIRECTORY_MISSING")
    fd, temporary = tempfile.mkstemp(prefix="." + destination.name + ".", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        try:
            os.link(temporary, destination)
        except FileExistsError as exc:
            raise Problem("Output already exists; select a new filename.", 409, "OUTPUT_EXISTS") from exc
        descriptor = os.open(destination.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return {"path": str(destination), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def operate(workspace, args):
    ops, action = Operations(workspace), args.operation
    if action == "list":
        result = {"cases": ops.list(args.plan)}
    elif action in ("show", "report"):
        result = ops.read(args.case) if action == "show" else ops.report(args.case)
    elif action == "history":
        result = ops.history(args.case, args.after, args.limit)
    elif action == "forecasts":
        result = {"forecasts": ops.list_forecasts(args.case)}
    elif action == "forecast-show":
        result = ops.forecast(args.case, args.forecast)
    elif action == "forecast-export":
        return {"forecastId": args.forecast, "output": publish(args.output, ops.export_forecast(args.case, args.forecast))}
    elif action in ("support-preview", "support-receive"):
        original = {"filename": Path(args.file).name,
                    "contentBase64": base64.b64encode(read_bytes(args.file, MAX_SOURCE)).decode("ascii")}
        if action == "support-preview":
            result = ops.preview_support(args.case, {"expectedVersion": args.expected_version, **original})
        else:
            data = {**original, "expectedPreviewSha256": args.expected_preview_sha256,
                    "deploymentId": args.deployment}
            if args.deployment_file:
                try:
                    data["deployment"] = json.loads(read_bytes(args.deployment_file, MAX_SOURCE))
                except (UnicodeError, ValueError) as exc:
                    raise Problem("New deployment fields must be a UTF-8 JSON object.", 422, "INVALID_JSON") from exc
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": "support.receive", "data": data})
    elif action == "completion-calendar":
        result = ops.completion_calendar(args.case, args.as_of)
    elif action == "completion-seed":
        result = ops.seed_completion(args.case, {"expectedVersion": args.expected_version, "tranche": args.tranche})
    elif action == "completion-export":
        return {"reviewId": args.review, "output": publish(args.output, ops.export_completion(args.case, args.review))}
    elif action.startswith("completion-"):
        filename = args.inputs if action == "completion-save" else args.data
        try:
            data = json.loads(read_bytes(filename, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Completion input must be a UTF-8 JSON object.", 422, "INVALID_JSON") from exc
        if action == "completion-preview":
            if not isinstance(data, dict) or "expectedVersion" in data:
                raise Problem("Use only the native completion preview fields in the data file.", 422, "INVALID_COMPLETION")
            result = ops.preview_completion(args.case, {"expectedVersion": args.expected_version, **data})
        else:
            if action == "completion-save":
                data = {"inputs": data}
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": action.replace("-", ".", 1), "data": data})
    elif action in ("forecast-preview", "forecast-save"):
        try:
            inputs = json.loads(read_bytes(args.inputs, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Forecast input must be a UTF-8 JSON object.", 422, "INVALID_JSON") from exc
        if action == "forecast-preview":
            result = ops.preview_forecast(args.case, {"expectedVersion": args.expected_version, "inputs": inputs})
        else:
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": "forecast.save",
                "data": {"inputs": inputs, "expectedPreviewSha256": args.expected_preview_sha256}})
    elif action == "portfolio-seed":
        result = ops.seed_portfolio(args.case, {"expectedVersion": args.expected_version, "forecastId": args.forecast})
    elif action == "portfolios":
        result = {"portfolios": ops.list_portfolios(args.case)}
    elif action == "portfolio-show":
        result = ops.portfolio(args.case, args.portfolio)
    elif action == "portfolio-export":
        return {"portfolioId": args.portfolio, "output": publish(args.output, ops.export_portfolio(args.case, args.portfolio))}
    elif action == "portfolio-selection":
        result = ops.select_portfolio(args.case, {"expectedVersion": args.expected_version,
            "portfolioId": args.portfolio, "alternativeId": args.alternative})
    elif action in ("portfolio-preview", "portfolio-save"):
        try:
            inputs = json.loads(read_bytes(args.inputs, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Portfolio input must be a UTF-8 JSON object.", 422, "INVALID_JSON") from exc
        if action == "portfolio-preview":
            result = ops.preview_portfolio(args.case, {"expectedVersion": args.expected_version, "inputs": inputs})
        else:
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": "portfolio.save",
                "data": {"inputs": inputs, "expectedPreviewSha256": args.expected_preview_sha256}})
    elif action == "review":
        result = ops.review(args.case, args.review)
    elif action in ("create", "intake"):
        body = {"planId": args.plan, "selectedRevision": args.selected_revision,
                "expectedContentSha256": args.expected_content_sha256, "name": args.name,
                "calendarStart": args.calendar_start, "actor": args.actor, "requestId": args.request_id}
        if action == "create":
            result = ops.create({**body, "mode": args.mode})
        else:
            from operations_intake import import_source_intake
            result = import_source_intake(ops, read_bytes(args.file, MAX_SOURCE), body)
    elif action in ("command", "attach"):
        if action == "attach":
            data = {"filename": Path(args.file).name, "contentBase64": base64.b64encode(read_bytes(args.file, MAX_SOURCE)).decode(),
                    "kind": args.kind, "mediaType": args.media_type, "sourceUrl": args.source_url, "observedAt": args.observed_at}
            verb = "source.add"
        else:
            try:
                data = json.loads(read_bytes(args.data))
            except (UnicodeError, ValueError) as exc:
                raise Problem("Action data must be a UTF-8 JSON object.", 422, "INVALID_JSON") from exc
            verb = args.action
        result = ops.command(args.case, {"expectedVersion": args.expected_version, "requestId": args.request_id,
                                       "actor": args.actor, "note": args.note, "action": verb, "data": data})
    elif action == "source":
        metadata, raw = ops.source(args.case, args.source)
        return {"source": metadata, "output": publish(args.output, raw)}
    elif action == "export":
        with workspace.mutex:
            current = ops.read(args.case)
            if current["program"]["version"] != args.expected_version:
                raise Problem("The operations case changed. Read it before exporting.", 409, "OPERATIONS_CONFLICT")
            raw = ops.export(args.case)
        return {"case": current["program"], "output": publish(args.output, raw)}
    elif action == "import":
        result = ops.import_bundle(read_bytes(args.file), args.name, args.request_id, args.actor)
    else:
        raise Problem("Unknown operations action.", 422, "UNKNOWN_COMMAND")
    if getattr(args, "output", None):
        return {"output": publish(args.output, (canonical(result) + "\n").encode())}
    return result
