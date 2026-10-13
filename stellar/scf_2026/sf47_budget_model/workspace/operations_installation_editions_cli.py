"""Edition comparison and continuation through the original Operations CLI."""
from __future__ import annotations
from copy import deepcopy
import csv
import html
import io
import json
import hashlib
import os
from pathlib import Path
import stat
from model import Problem, canonical
from operations_installation_sources import SourceDesk
from installation_source_desk_client import InstallationSourceDeskClient
from operations_installation_source_editions import COMPARISON, unseal

PREFIX = "source-edition-"
MAX_INPUT = 24 * 1024 * 1024


def register(command, mutation):
    for name, description in (
        ("compare", "Compare exact source drafts and optional complete native preparations"),
        ("preview", "Review each original file decision and the complete successor mapping"),
        ("prepare", "Save an immutable edition.apply operation without executing it"),
        ("execute", "Resume one exact saved edition operation through the original request journal"),
        ("show", "Read all complete edition transition receipts at one original draft revision"),
        ("export", "Export a complete saved comparison as JSON, CSV or readable HTML"),
        ("course-prepare", "Freeze the complete successor/native-preparation/optional-attachment course"),
        ("course-run", "Resume the original course and retain its complete native ZIP and receiving report"),
    ):
        target = command(PREFIX + name, description, case=name != "export", output=True)
        if name != "export":
            target.add_argument("--draft", required=True, help="Original target source-desk ID")
        if name in ("compare", "preview"):
            target.add_argument("--input", required=True, help="Complete declared comparison/preview JSON")
        elif name in ("prepare", "course-prepare"):
            target.add_argument("--plan", required=True, help="Complete saved edition plan including SHA")
            if name == "prepare":
                mutation(target)
            else:
                target.add_argument("--request-prefix", required=True)
                target.add_argument("--actor", required=True)
                target.add_argument("--note", default="")
                target.add_argument("--attach-version", type=int)
        elif name == "course-run":
            target.add_argument("--course", required=True)
            target.add_argument("--archive-output", required=True)
        elif name == "execute":
            target.add_argument("--operation-file", required=True, help="Unchanged prepared original request file")
        elif name == "show":
            target.add_argument("--revision", type=int)
        else:
            target.add_argument("--comparison", required=True)
            target.add_argument("--format", choices=("json", "csv", "html"), default="json")


def operates(action):
    return action.startswith(PREFIX)


def read_json(read_bytes, filename):
    try:
        value = json.loads(read_bytes(filename, MAX_INPUT))
    except (ValueError, UnicodeError) as error:
        raise Problem("Read the complete retained UTF-8 edition JSON.", 422,
                      "INSTALLATION_EDITION_INVALID") from error
    if not isinstance(value, dict):
        raise Problem("Select a complete original edition object.", 422, "INSTALLATION_EDITION_INVALID")
    return value


def comparison_rows(comparison):
    unseal(comparison, COMPARISON)
    rows = []
    for section, files in (("source-files", comparison["files"]),
                           ("prepared-outputs", comparison["preparations"]["files"])):
        for file in files:
            rows.append({"section": section, "identity": file["filename"], "status": file["status"],
                         "original": deepcopy(file)})
    for section, items in (("selection", comparison["selectionChanges"]),
                           ("native-report", comparison["preparations"]["reportChanges"])):
        for item in items:
            rows.append({"section": section, "identity": item["pointer"], "status": "changed",
                         "original": deepcopy(item)})
    return rows


def export_comparison(comparison, format):
    rows = comparison_rows(comparison)
    if format == "json":
        return (canonical(comparison) + "\n").encode("utf-8")
    # Text cells are spreadsheet-safe. Full JSON retains complete original values.
    safe = lambda value: "'" + value if value[:1] in ("=", "+", "-", "@", "\t", "\r", "\n") else value
    if format == "csv":
        out = io.StringIO(newline="")
        writer = csv.writer(out, lineterminator="\r\n")
        writer.writerow(("section", "identity", "status", "complete_original_json"))
        writer.writerow(("comparison", "", "original", canonical(comparison)))
        for row in rows:
            writer.writerow((safe(row["section"]), safe(row["identity"]), row["status"], canonical(row["original"])))
        return out.getvalue().encode("utf-8")
    if format != "html":
        raise Problem("Select JSON, CSV or HTML.", 422, "INSTALLATION_EDITION_INVALID")
    esc = lambda value: html.escape(str(value), quote=True)
    body = "<!doctype html><meta charset=utf-8><title>Source edition comparison</title>"
    body += "<style>body{font:16px system-ui;max-width:1100px;margin:2rem auto;padding:1rem;color:#242424}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:.6rem;text-align:left;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere}code{overflow-wrap:anywhere}</style>"
    body += "<h1>Source edition comparison</h1><p>Case <code>" + esc(comparison["caseId"]) + "</code></p>"
    for label in ("source", "target"):
        ref = comparison[label]["ref"]
        body += "<h2>" + label.title() + "</h2><p>" + esc(ref["draftId"]) + " · revision " + esc(ref["revision"]) + "<br><code>" + esc(ref["sha256"]) + "</code></p>"
    body += "<p>Complete source files, mapping changes and selected native preparation outputs follow. A saved successor remains editable until the original native preparation validates it.</p>"
    body += "<table><thead><tr><th>Section</th><th>Original field / file</th><th>Change</th><th>Complete original values</th></tr></thead><tbody>"
    for row in rows:
        body += "<tr><td>" + esc(row["section"]) + "</td><td>" + esc(row["identity"]) + "</td><td>" + esc(row["status"]) + "</td><td><pre>" + esc(json.dumps(row["original"], ensure_ascii=False, indent=2)) + "</pre></td></tr>"
    body += "</tbody></table><details><summary>Complete original comparison</summary><pre>" + esc(json.dumps(comparison, ensure_ascii=False, indent=2)) + "</pre></details>"
    return (body + "\n").encode("utf-8")


def operate(ops, args, read_bytes, publish):
    action = args.operation[len(PREFIX):]
    if action == "export":
        value = read_json(read_bytes, args.comparison)
        raw = export_comparison(value, args.format)
        if args.output:
            return {"output": publish(args.output, raw), "comparisonSha256": value["sha256"]}
        if args.format == "json":
            return value
        return {"format": args.format, "content": raw.decode("utf-8"), "comparisonSha256": value["sha256"]}
    desk = SourceDesk(ops)
    client = InstallationSourceDeskClient(desk, args.case, args.draft)
    if action == "compare":
        result = client.edition_compare(read_json(read_bytes, args.input))
    elif action == "preview":
        result = client.edition_preview(read_json(read_bytes, args.input))
    elif action == "prepare":
        result = client.prepare_edition(read_json(read_bytes, args.plan), actor=args.actor,
                                        request_id=args.request_id, note=args.note)
    elif action == "course-prepare":
        from installation_source_edition_receiving import prepare_course
        result = prepare_course(client, read_json(read_bytes, args.plan),
            request_prefix=args.request_prefix, actor=args.actor, note=args.note, attach_version=args.attach_version)
    elif action == "course-run":
        return run_course(client, args, publish)
    elif action == "execute":
        operation = read_json(read_bytes, args.operation_file)
        if operation.get("request", {}).get("action") != "edition.apply":
            raise Problem("Select the original prepared edition.apply operation.", 422, "INSTALLATION_EDITION_INVALID")
        result = client.execute(operation)
    elif action == "show":
        draft = client.read(args.revision)
        result = {"schema": "stellar-forge.installation-source-edition-history.v1",
                  "caseId": args.case, "draftId": args.draft, "revision": draft["revision"],
                  "transitions": deepcopy(draft.get("editionTransitions", [])), "draft": draft}
    else:
        raise Problem("Use a declared source edition command.", 422, "INSTALLATION_EDITION_INVALID")
    if args.output:
        return {"output": publish(args.output, (canonical(result) + "\n").encode("utf-8"))}
    return result


def stable_output(filename, maximum):
    path = Path(filename).expanduser().absolute()
    if path.parent.resolve(strict=True) != path.parent:
        raise Problem("Select the exact existing output directory.", 422, "INSTALLATION_EDITION_OUTPUT")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        first = os.fstat(descriptor)
        if not stat.S_ISREG(first.st_mode) or first.st_size > maximum:
            raise Problem("Select one complete bounded ordinary output file.", 422, "INSTALLATION_EDITION_OUTPUT")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            raw = stream.read(maximum + 1)
        last, named = os.fstat(descriptor), os.lstat(path)
        identity = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns)
        if identity(first) != identity(last) or identity(last) != identity(named) or len(raw) != first.st_size:
            raise Problem("The original complete receiving output changed.", 409, "INSTALLATION_EDITION_OUTPUT")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)
    return raw


def retain_output(filename, raw, maximum, publish):
    if len(raw) > maximum:
        raise Problem("The complete receiving output exceeds its declared bound.", 413, "INSTALLATION_EDITION_OUTPUT")
    try:
        prior = stable_output(filename, maximum)
    except FileNotFoundError:
        try:
            return publish(filename, raw)
        except Problem as error:
            if error.code != "OUTPUT_EXISTS":
                raise
            prior = stable_output(filename, maximum)
    if prior != raw:
        raise Problem("Keep both different complete outputs; the original filename is already retained.",
                      409, "INSTALLATION_EDITION_OUTPUT")
    return {"path": str(Path(filename).expanduser().absolute()), "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest()}


def run_course(client, args, publish):
    from installation_source_edition_receiving import validate_course, execute_course, verify_result
    if not args.output:
        raise Problem("Choose --output for the complete receiving report before executing.", 422,
                      "INSTALLATION_EDITION_OUTPUT")
    report_path = Path(args.output).expanduser().absolute()
    archive_path = Path(args.archive_output).expanduser().absolute()
    input_path = Path(args.course).expanduser().absolute()
    if len({str(report_path), str(archive_path), str(input_path)}) != 3:
        raise Problem("Keep the original course, full report and complete ZIP in distinct files.", 422,
                      "INSTALLATION_EDITION_OUTPUT")
    for path in (report_path, archive_path):
        if path.parent.resolve(strict=True) != path.parent:
            raise Problem("Select the existing exact output directory.", 422, "INSTALLATION_EDITION_OUTPUT")
    try:
        course = validate_course(json.loads(stable_output(input_path, MAX_INPUT)), client)
    except (UnicodeError, ValueError) as error:
        raise Problem("Open the complete saved original course JSON.", 422, "INSTALLATION_EDITION_INVALID") from error
    try:
        prior = stable_output(report_path, 96 * 1024 * 1024)
    except FileNotFoundError:
        prior = None
    if prior is not None:
        report = json.loads(prior)
        archive = stable_output(archive_path, 256 * 1024 * 1024)
        verify_result(client, course, report, archive)
        return {"state": "COMPLETE", "replayed": True, "receiving": report,
                "currentDraft": client.read(), "reportPath": str(report_path),
                "archivePath": str(archive_path)}
    report, archive = execute_course(client, course)
    retained_archive = retain_output(archive_path, archive, 256 * 1024 * 1024, publish)
    # First completion and later adoption share exactly the same full proof.
    verify_result(client, course, report, stable_output(archive_path, 256 * 1024 * 1024))
    retained_report = retain_output(report_path, (canonical(report) + "\n").encode("utf-8"),
                                    96 * 1024 * 1024, publish)
    return {"state": "COMPLETE", "replayed": False, "receiving": report,
            "report": retained_report, "archive": retained_archive}
