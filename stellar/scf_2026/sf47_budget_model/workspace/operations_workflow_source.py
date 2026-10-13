"""Complete recurring Console source for native Installation receiving.

The original Console validates and freezes its own profile/reports. This reader
preserves that exact source and selects recorded cycle, run and customer-file
facts for Installation observations. It does not import or dispatch Console work.
"""
from __future__ import annotations

from copy import deepcopy
from html import escape
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile
from urllib.parse import quote

from model import Problem, canonical, digest

SCHEMA = "stellar-forge.workflow-installation-source.v1"
MANIFEST = "installation-workflow.json"
MAX_BYTES = 32 * 1024 * 1024
MAX_MEMBERS = 4096
MAX_PERIODS = 100
PROFILE_SCHEMA = "stellar-forge.merchant-operator-profile.v1"
HANDOVER_SCHEMA = "stellar-forge.merchant-workflow-handover.v1"
SELECTION_SCHEMA = "stellar-forge.merchant-workflow-handover-selection.v1"


def fail(message, code="INVALID_WORKFLOW_INSTALLATION_SOURCE", status=422):
    raise Problem(message, status, code)


def exact(value, fields, label):
    if not isinstance(value, dict) or set(value) != set(fields):
        fail("Retain the complete original " + label + " fields.")
    return value


def object_value(value, label):
    if not isinstance(value, dict):
        fail("Read the complete original " + label + ".")
    return value


def identity(value, label="identity"):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", value):
        fail("Select the original " + label + ".")
    return value


def sha(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        fail("Retain the complete original SHA-256.")
    return value


def member(value):
    if (not isinstance(value, str) or not value or len(value) > 4096
            or "\\" in value or re.match(r"^[A-Za-z]:", value) or any(ord(char) < 32 for char in value)
            or value.startswith("/") or any(part in ("", ".", "..") or len(part.encode("utf-8")) > 255
                                          for part in value.split("/"))):
        fail("Keep each original file within its complete handover directory.")
    return value


def descriptor(value):
    exact(value, ("path", "bytes", "sha256"), "file descriptor")
    member(value["path"]); sha(value["sha256"])
    if type(value["bytes"]) is not int or not 0 <= value["bytes"] <= MAX_BYTES:
        fail("Retain each original file length within the complete source capacity.")
    return value


def json_value(raw, label):
    try:
        def pairs(values):
            result = {}
            for key, value in values:
                if key in result:
                    fail("The original " + label + " repeats a JSON field.")
                result[key] = value
            return result
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                          parse_constant=lambda value: fail("Retain finite original JSON values."))
    except (UnicodeError, ValueError, RecursionError) as error:
        raise Problem("Read the complete UTF-8 " + label + ".", 422,
                      "INVALID_WORKFLOW_INSTALLATION_SOURCE") from error


def index(rows, label, versioned=False):
    if not isinstance(rows, list):
        fail("Include the original " + label + " history.")
    result = {}
    for value in rows:
        object_value(value, label)
        key = identity(value.get("id"), label)
        if versioned:
            number = value.get("revision")
            if type(number) is not int or number < 1:
                fail("Select the original saved " + label + " revision.")
            key = (key, number)
        if key in result:
            fail("The complete original " + label + " repeats an identity.")
        result[key] = value
    return result


def _inspect(manifest, files):
    exact(manifest, ("schema", "profileId", "sourceWorkspaceId", "profile", "selection",
                     "handover", "periods", "files"), "workflow Installation source")
    if manifest["schema"] != SCHEMA:
        fail("Use the complete recurring-work Installation handover.")
    profile_id = identity(manifest["profileId"], "profile")
    source_workspace = identity(manifest["sourceWorkspaceId"], "source workspace")
    declared = manifest["files"]
    if not isinstance(declared, list) or not 3 <= len(declared) < MAX_MEMBERS:
        fail("Include the complete original profile and customer files.")
    inventory = {}
    for row in declared:
        descriptor(row)
        if row["path"] in inventory or row["path"] == MANIFEST:
            fail("List every original source member once.")
        raw = files.get(row["path"])
        if (not isinstance(raw, bytes) or len(raw) != row["bytes"]
                or hashlib.sha256(raw).hexdigest() != row["sha256"]):
            fail("The complete original source file differs: " + row["path"])
        inventory[row["path"]] = row
    if set(files) != set(inventory):
        fail("Receive exactly the complete declared source files.")
    for field, name in (("profile", "profile.json"), ("selection", "selection.json"),
                        ("handover", "handover.json")):
        descriptor(manifest[field])
        if manifest[field]["path"] != name or manifest[field] != inventory.get(name):
            fail("The complete original " + field + " file selection differs.")
    profile = object_value(json_value(files["profile.json"], "profile JSON"), "profile JSON")
    selected = object_value(json_value(files["selection.json"], "selection JSON"), "selection JSON")
    handover = object_value(json_value(files["handover.json"], "handover JSON"), "handover JSON")
    original_profile = object_value(profile.get("profile"), "saved profile")
    if (profile.get("schema") != PROFILE_SCHEMA or original_profile.get("id") != profile_id
            or profile.get("sourceWorkspaceId") != source_workspace
            or selected.get("schema") != SELECTION_SCHEMA
            or handover.get("schema") != HANDOVER_SCHEMA
            or any(value.get("profileId") != profile_id or value.get("sourceWorkspaceId") != source_workspace
                   for value in (selected, handover))
            or handover.get("selectionSha256") != selected.get("contentSha256")
            or selected.get("profile") != handover.get("profile")
            or selected.get("customers") != handover.get("customers")
            or selected.get("otherDeliveries") != handover.get("otherDeliveries")):
        fail("Keep the handover with its exact original profile and customer selection.")
    original_profile_file = {**manifest["profile"], "contentSha256": sha(profile.get("contentSha256"))}
    if selected.get("profile") != original_profile_file:
        fail("Retain the exact original profile bytes and native content identity.")
    deliveries = index(profile.get("deliveries"), "customer delivery")
    customers = index(handover.get("customers"), "received customer")
    customer_files = []
    for key, customer in customers.items():
        row = deliveries.get(key)
        if (row is None or row.get("profileId") != profile_id or row.get("state") != "COMPLETE"
                or row.get("workspaceId") != source_workspace
                or customer.get("identity") != row.get("identity")
                or customer.get("identitySha256") != row.get("identitySha256")
                or not isinstance(row.get("files"), list)):
            fail("Keep each received customer selection with its completed original source record.")
        expected = []
        for original in row["files"]:
            object_value(original, "customer file")
            name = member(original.get("name"))
            file = {"name": name, "path": "customers/" + key + "/files/" + name,
                    "bytes": original.get("bytes"), "sha256": original.get("sha256")}
            descriptor({name: file[name] for name in ("path", "bytes", "sha256")})
            if inventory.get(file["path"]) != {name: file[name] for name in ("path", "bytes", "sha256")}:
                fail("Include every byte of each selected original customer delivery.")
            expected.append(file)
        if customer.get("files") != expected or len({value["path"] for value in expected}) != len(expected):
            fail("Keep every original customer filename and its exact descriptor.")
        customer_files.extend(expected)
    if handover.get("files") != [original_profile_file, *customer_files]:
        fail("The complete original handover file inventory differs.")
    workflow = object_value(profile.get("workflowData"), "workflow history")
    series = object_value(profile.get("workflowSeriesData"), "recurring-work history")
    definitions = index(series.get("definitions"), "series", True)
    cycles = index(series.get("cycles"), "cycle")
    runs = index(workflow.get("runs"), "native run")
    workflow_definitions = index(workflow.get("definitions"), "workflow", True)
    if not isinstance(series.get("cancellations"), list):
        fail("Retain the original planned-cycle cancellation history.")
    cancelled = {row["cycleId"]: row for row in series["cancellations"]}
    periods = manifest["periods"]
    if not isinstance(periods, list) or not 1 <= len(periods) <= MAX_PERIODS:
        fail("Select from one to 100 original customer periods.")
    seen, result, report_names = set(), [], set()
    for choice in periods:
        exact(choice, ("cycleId", "deliveryIds", "report"), "selected customer period")
        cycle_id = identity(choice["cycleId"], "cycle")
        if cycle_id in seen or cycle_id not in cycles:
            fail("Select each retained original cycle once.")
        seen.add(cycle_id); cycle = cycles[cycle_id]
        definition = definitions.get((cycle.get("seriesId"), cycle.get("seriesRevision")))
        if (definition is None or definition.get("profileId") != profile_id
                or cycle.get("profileId") != profile_id
                or cycle.get("seriesSha256") != definition.get("contentSha256")
                or cycle.get("workflowId") != definition.get("workflowId")
                or cycle.get("workflowRevision") != definition.get("workflowRevision")
                or cycle.get("workflowSha256") != definition.get("workflowSha256")):
            fail("Retain the complete selected series and original workflow edition.")
        native_definition = workflow_definitions.get((cycle["workflowId"], cycle["workflowRevision"]))
        if native_definition is None or native_definition.get("contentSha256") != cycle["workflowSha256"]:
            fail("Include the original workflow definition for this cycle.")
        request = object_value(cycle.get("request"), "cycle request")
        period = object_value(request.get("period"), "customer period")
        if (not all(isinstance(period.get(key), str) for key in ("start", "end"))
                or not all(isinstance(request.get(key), str) for key in ("key", "label", "dueDate", "sourceEdition", "reason"))):
            fail("Retain the customer's original calendar, source and repeat reason.")
        delivery_ids = choice["deliveryIds"]
        if (not isinstance(delivery_ids, list) or len(delivery_ids) > 1000
                or len(set(delivery_ids)) != len(delivery_ids)
                or any(key not in customers for key in delivery_ids)):
            fail("Explicitly select complete customer deliveries from this frozen handover.")
        native_run = runs.get(cycle.get("runId"))
        report_packet = None
        if native_run is not None:
            if (native_run.get("profileId") != profile_id
                    or any(native_run.get(key) != cycle.get(key) for key in
                           ("workflowId", "workflowRevision", "workflowSha256", "inputsJson"))
                    or not isinstance(native_run.get("steps"), list)):
                fail("Keep the selected period with its original native run and full input.")
            report_file = descriptor(choice["report"])
            if (report_file["path"] != "reports/" + identity(native_run["id"], "run") + ".json"
                    or report_file != inventory.get(report_file["path"])):
                fail("Include the original report for the selected native run.")
            report_names.add(report_file["path"])
            report_packet = object_value(json_value(files[report_file["path"]], "native workflow report"), "native report")
            report_archive = object_value(report_packet.get("archive"), "native report archive")
            if (report_packet.get("schema") != "stellar-forge.merchant-workflow-report.v1"
                    or report_packet.get("selection") != {"runId": native_run["id"], "baselineRunId": None}
                    or report_archive.get("profile") != original_profile
                    or report_archive.get("sourceWorkspaceId") != source_workspace
                    or report_archive.get("workflowData", {}).get("runs") != [native_run]):
                fail("The complete original report must select this exact retained run.")
            for name, original_rows, versioned in (("drafts", profile.get("drafts"), True),
                    ("calls", profile.get("calls"), False)):
                originals = index(original_rows, name, versioned)
                for key, row in index(report_archive.get(name), "report " + name, versioned).items():
                    if originals.get(key) != row:
                        fail("Keep each complete report request and native return in the original profile.")
        elif choice["report"] is not None:
            fail("A planned cycle retains no dispatched-run report.")
        chosen = [deepcopy(customers[key]) for key in delivery_ids]
        basis = {"series": definition, "cycle": cycle, "run": native_run,
                 "cancellation": cancelled.get(cycle_id), "customers": chosen}
        # This is an Installation observation identity, not the Console's native
        # JSON-number canonicalization or an additional provider result.
        result.append({**deepcopy(basis), "basisSha256": digest(basis),
                       "deliveryIds": list(delivery_ids), "report": deepcopy(choice["report"]),
                       "reportPacket": report_packet})
    allowed = {"profile.json", "selection.json", "handover.json", "index.html",
               *(value["path"] for value in customer_files), *report_names}
    if set(inventory) != allowed:
        fail("Keep the complete original profile, selected reports, customer files and opening page.")
    return {"manifest": manifest, "profile": profile, "selection": selected,
            "handover": handover, "periods": result, "files": files}


def read_bundle(raw):
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_BYTES:
        fail("Receive the complete source ZIP within 32 MiB.", status=413)
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_MEMBERS or sum(row.file_size for row in infos) > MAX_BYTES:
                fail("The expanded source exceeds the native 32 MiB / 4096-file capacity.", status=413)
            names = set()
            for row in infos:
                member(row.filename)
                mode = row.external_attr >> 16
                if (row.filename in names or row.is_dir() or stat.S_ISLNK(mode)
                        or stat.S_IFMT(mode) not in (0, stat.S_IFREG)
                        or row.flag_bits & 1 or row.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
                    fail("Receive unique complete regular source files.")
                names.add(row.filename)
            if MANIFEST not in names:
                fail("Select the complete recurring-work Installation source ZIP.")
            manifest = object_value(json_value(archive.read(MANIFEST), "Installation source manifest"), "manifest")
            files = {name: archive.read(name) for name in names if name != MANIFEST}
        return _inspect(manifest, files)
    except Problem:
        raise
    except (zipfile.BadZipFile, KeyError, TypeError, ValueError, AttributeError, RuntimeError, RecursionError) as error:
        raise Problem("Read the complete original recurring-work source ZIP: " + str(error),
                      422, "INVALID_WORKFLOW_INSTALLATION_SOURCE") from error


def period_summary(value):
    cycle, series, run = value["cycle"], value["series"], value["run"]
    files = [row for customer in value["customers"] for row in customer["files"]]
    return {"cycleId": cycle["id"], "seriesId": series["id"], "seriesRevision": series["revision"],
            "seriesName": series["name"], "customer": series["customer"], "task": series["task"],
            "runId": cycle["runId"], "key": cycle["request"]["key"], "label": cycle["request"]["label"],
            "period": deepcopy(cycle["request"]["period"]), "dueDate": cycle["request"]["dueDate"],
            "sourceEdition": cycle["request"]["sourceEdition"], "reason": cycle["request"]["reason"],
            "previousCycleId": cycle["request"].get("previousCycleId"),
            "state": run["state"] if run else "CANCELLED" if value["cancellation"] else "PLANNED",
            "runRevision": run.get("revision") if run else None,
            "completedAt": run.get("completedAt") if run else None,
            "executionHostFingerprint": run.get("executionHostFingerprint") if run else None,
            "ownerWorkspaceId": run.get("ownerWorkspaceId") if run else None,
            "completedSteps": sum(row["state"] in ("COMPLETE", "RECOVERED") for row in run["steps"]) if run else 0,
            "stepCount": len(run["steps"]) if run else 0,
            "recoveredSteps": sum(row["state"] == "RECOVERED" for row in run["steps"]) if run else 0,
            "deliveryIds": list(value["deliveryIds"]), "customerFiles": len(files),
            "customerBytes": sum(row["bytes"] for row in files), "files": deepcopy(files),
            "report": deepcopy(value["report"]), "basisSha256": value["basisSha256"]}


def html_source(original):
    e = lambda value: escape(str(value if value is not None else "Unentered"), quote=True)
    rows = []
    for value in original["periods"]:
        row = period_summary(value)
        files = "".join('<li><a download href="' + e(quote(item["path"], safe="/")) + '">' + e(item["name"]) +
                        '</a> · ' + str(item["bytes"]) + ' bytes</li>' for item in row["files"])
        report_link = ('<p><a download href="' + e(quote(row["report"]["path"], safe="/")) +
                       '">Complete original workflow report and native records</a></p>') if row["report"] else ""
        rows.append("<section><h2>" + e(row["seriesName"]) + " · " + e(row["label"]) + "</h2><p>" +
                    e(row["customer"]) + "</p><p>" + e(row["task"]) + "</p><dl><dt>Period</dt><dd>" +
                    e(row["period"]["start"]) + " to " + e(row["period"]["end"]) +
                    "</dd><dt>Original source edition</dt><dd>" + e(row["sourceEdition"]) +
                    "</dd><dt>Recorded native run</dt><dd>" + e(row["runId"]) + " · " + e(row["state"]) +
                    "</dd><dt>Original steps</dt><dd>" + str(row["completedSteps"]) + " / " +
                    str(row["stepCount"]) + "</dd></dl>" + report_link +
                    ("<h3>Selected customer files</h3><ul>" + files + "</ul>" if files else
                     "<p>The original native results are retained in the report. No customer delivery files are selected for this period.</p>") +
                    "</section>")
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">'
            '<title>Customer operating periods</title><style>body{max-width:1000px;margin:auto;padding:24px;color:#222;'
            'background:#fff;font:16px/1.55 system-ui}section{border-top:1px solid #bbb;margin-top:28px;padding-top:16px}'
            'dt{font-weight:600}dd{margin:0 0 10px;overflow-wrap:anywhere}a{color:inherit}li{overflow-wrap:anywhere}</style>'
            '<h1>Customer operating periods</h1><p>' + e(original["profile"]["profile"]["name"]) +
            '</p><p>Import this complete ZIP as an original Source in Grant Operations. In Customer installations, choose '
            'Receive customer periods, select this file and prepare the saved Installation. Record the receiving operator’s '
            'actual useful-result observation, review, then save its next edition.</p><p><a download href="profile.json">'
            'Complete original Console profile</a> · <a download href="selection.json">Original customer file selection</a>'
            ' · <a download href="handover.json">Complete original handover</a></p>' + "".join(rows) + "</html>\n").encode("utf-8")


def _signature(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _read_original(path, expected):
    selected = Path(path)
    if not selected.is_absolute():
        fail("Read the original absolute source file path.")
    descriptor(expected)
    fd = os.open(selected, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "rb") as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size != expected["bytes"]:
            fail("The selected source is not its original complete regular file.")
        raw = source.read(MAX_BYTES + 1)
        after, current = os.fstat(source.fileno()), os.stat(selected, follow_symlinks=False)
        if (_signature(before) != _signature(after) or _signature(after) != _signature(current)
                or len(raw) != expected["bytes"] or hashlib.sha256(raw).hexdigest() != expected["sha256"]):
            fail("The complete source changed while preparing its handover.")
        return raw


def package(input_value, output):
    exact(input_value, ("manifest", "originals", "generated"), "complete packaging input")
    manifest = deepcopy(input_value["manifest"])
    originals, generated = input_value["originals"], input_value["generated"]
    if (not isinstance(originals, list) or not isinstance(generated, list)
            or len(originals) + len(generated) + 2 > MAX_MEMBERS):
        fail("Retain the complete bounded original source inventory.", status=413)
    declared = []
    for rows, extra in ((originals, "absolutePath"), (generated, "base64")):
        for row in rows:
            exact(row, ("path", "bytes", "sha256", extra), "packaging file")
            declared.append(descriptor({key: row[key] for key in ("path", "bytes", "sha256")}))
    if (sum(row["bytes"] for row in declared) > MAX_BYTES
            or len({row["path"] for row in declared}) != len(declared)
            or any(row["path"] in (MANIFEST, "index.html") for row in declared)):
        fail("Keep the complete original file selection within the source capacity.", status=413)
    files = {}
    for row in input_value["originals"]:
        exact(row, ("path", "bytes", "sha256", "absolutePath"), "original source file")
        selected = {key: row[key] for key in ("path", "bytes", "sha256")}
        if row["path"] in files:
            fail("Package every original path once.")
        files[row["path"]] = _read_original(row["absolutePath"], selected)
    for row in input_value["generated"]:
        exact(row, ("path", "bytes", "sha256", "base64"), "generated native report")
        descriptor({key: row[key] for key in ("path", "bytes", "sha256")})
        if row["path"] in files:
            fail("Keep generated reports separate from original source files.")
        raw = base64.b64decode(row["base64"], validate=True)
        if len(raw) != row["bytes"] or hashlib.sha256(raw).hexdigest() != row["sha256"]:
            fail("Retain the complete original native report bytes.")
        files[row["path"]] = raw
    files["index.html"] = b""
    manifest["files"] = [{"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                         for name, raw in sorted(files.items())]
    prepared = _inspect(manifest, files)
    files["index.html"] = html_source(prepared)
    manifest["files"] = [{"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                         for name, raw in sorted(files.items())]
    files[MANIFEST] = (canonical(manifest) + "\n").encode("utf-8")
    if len(files) > MAX_MEMBERS or sum(len(raw) for raw in files.values()) > MAX_BYTES:
        fail("The complete expanded customer handover exceeds 32 MiB.", status=413)
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100600 << 16
            archive.writestr(info, raw)
    raw = result.getvalue()
    complete = read_bundle(raw)
    from cli import publish
    saved = publish(output, raw, allow_identical=True)
    return {"schema": SCHEMA, "output": saved, "profileId": manifest["profileId"],
            "periods": [period_summary(value) for value in complete["periods"]],
            "files": len(files), "expandedBytes": sum(len(value) for value in files.values())}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Package or reopen complete original customer operating periods")
    parser.add_argument("command", choices=("package", "inspect"))
    parser.add_argument("--input", required=True, help="Original JSON packaging request, or source ZIP for inspect")
    parser.add_argument("--output")
    args = parser.parse_args(argv)
    try:
        if args.command == "package":
            if args.input == "-":
                raw = sys.stdin.buffer.read(MAX_BYTES * 2 + 1)
            else:
                with Path(args.input).open("rb") as source:
                    raw = source.read(MAX_BYTES * 2 + 1)
            if len(raw) > MAX_BYTES * 2 or not args.output:
                fail("Supply the complete bounded package request and an output filename.", status=413)
            result = package(json_value(raw, "packaging request"), args.output)
        else:
            with Path(args.input).open("rb") as source:
                raw = source.read(MAX_BYTES + 1)
            result = read_bundle(raw)
            result = {"schema": SCHEMA, "profileId": result["manifest"]["profileId"],
                      "sourceWorkspaceId": result["manifest"]["sourceWorkspaceId"],
                      "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw),
                      "periods": [period_summary(value) for value in result["periods"]]}
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), flush=True)
        return 0
    except (Problem, OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({"error": {"code": getattr(error, "code", "WORKFLOW_SOURCE_FAILED"),
                                   "message": str(error), "status": getattr(error, "status", 422)}}),
              file=sys.stderr, flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
