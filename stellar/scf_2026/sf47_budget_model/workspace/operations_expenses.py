"""Issued buyer expense attribution inside the original SF47 Operations owner."""
from __future__ import annotations

import base64
from collections import defaultdict
from copy import deepcopy
from decimal import Decimal, localcontext
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import threading
import uuid
import zipfile

from model import Problem, canonical, digest, now, text, csv_bytes
import operations_domain as domain
import forecast_currency as currency

SCHEMA = "scf.operations.expense-attribution.v1"
READER_SCHEMA = "scf.operations.expense-reader.v1"
MAX_SOURCE = 8 * 1024 * 1024
MAX_OUTPUT = 20 * 1024 * 1024
MAX_INTAKES = 200
MAX_ATTRIBUTIONS = 5000
HELPER = Path(__file__).resolve().with_name("expense_handoff.mjs")
_READER = threading.BoundedSemaphore(1)
ACTIONS = {"expense.receive", "expense.save", "expense.review", "expense.reopen", "expense.void"}


def fail(message, code="EXPENSE_INPUT_INVALID", status=422):
    raise Problem(message, status, code)


def fields(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        fail("Use the declared " + label + ".")
    return value


def native_amount(value, label, positive=False):
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,99})", value):
        fail(label + ": retain an exact native-unit integer string.")
    if positive and int(value) == 0:
        fail(label + ": enter a positive native-unit amount.")
    return value


def identity(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,159}", value):
        fail("Retain the original " + label + ".")
    return value


def source_bytes(value):
    if not isinstance(value, str) or len(value) > ((MAX_SOURCE + 2) // 3) * 4:
        fail("Select an original issued source or accountant packet up to 8 MiB.", "EXPENSE_SOURCE_SIZE", 413)
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as exc:
        raise Problem("The original expense source encoding is invalid.", 422, "EXPENSE_SOURCE_ENCODING") from exc
    if not raw or len(raw) > MAX_SOURCE or base64.b64encode(raw).decode("ascii") != value:
        fail("Select a complete original expense source up to 8 MiB.", "EXPENSE_SOURCE_SIZE", 413)
    return raw


def plain_filename(value):
    value = text(value, "Original expense filename", 240, True)
    if value in (".", "..") or "/" in value or "\\" in value or any(ord(c) < 32 for c in value):
        fail("Use a plain original expense filename.")
    return value


def read_json(raw, label):
    try:
        return json.loads(raw.decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (UnicodeError, ValueError) as exc:
        raise Problem("Retain complete UTF-8 " + label + ".", 422, "EXPENSE_SOURCE_JSON") from exc


def _originals(raw):
    """Authenticate the existing export's exact members; never extract or execute them."""
    if not raw.startswith(b"PK"):
        return {"format": "ISSUED_JSON", "source": raw, "returns": [], "history": None,
                "manifestSha256": None, "files": []}
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            names = [item.filename for item in infos]
            if not infos or len(infos) > 1200 or len(set(names)) != len(names) or sum(x.file_size for x in infos) > MAX_SOURCE:
                fail("The original expense packet has duplicate, excessive or oversized members.", "EXPENSE_PACKET_SIZE", 413)
            for item in infos:
                name = item.filename
                path = PurePosixPath(name)
                mode = stat.S_IFMT(item.external_attr >> 16)
                if (not name or path.is_absolute() or str(path) != name or any(x in ("", ".", "..") for x in name.split("/"))
                        or "\\" in name or any(ord(x) < 32 for x in name) or item.is_dir()
                        or mode not in (0, stat.S_IFREG) or item.flag_bits & 1):
                    fail("The expense packet must contain plain original file members.", "EXPENSE_PACKET_INVALID")
            if "manifest.json" not in names:
                fail("Choose the original accountant-delivery ZIP with its complete manifest.", "EXPENSE_PACKET_REQUIRED")
            manifest_raw = archive.read("manifest.json")
            manifest = read_json(manifest_raw, "expense manifest JSON")
            if not isinstance(manifest, dict) or manifest.get("schema") != "stellar-forge.buyer-expense-export.v1":
                fail("Choose the original buyer expense export.", "EXPENSE_PACKET_REQUIRED")
            selected = manifest.get("files")
            if (not isinstance(selected, list) or len(selected) != len(names) - 1
                    or any(not isinstance(x, dict) for x in selected)
                    or {x.get("path") for x in selected} != set(names) - {"manifest.json"}):
                fail("The expense manifest must name every original member exactly once.", "EXPENSE_PACKET_CHANGED")
            payload = {}
            for descriptor in selected:
                content = archive.read(descriptor["path"])
                if (type(descriptor.get("bytes")) is not int or len(content) != descriptor["bytes"]
                        or hashlib.sha256(content).hexdigest() != descriptor.get("sha256")):
                    fail("An original expense packet member differs from its manifest.", "EXPENSE_PACKET_CHANGED")
                payload[descriptor["path"]] = content
    except (zipfile.BadZipFile, KeyError, RuntimeError, OSError, ValueError) as exc:
        if isinstance(exc, Problem):
            raise
        raise Problem("The original expense ZIP is unreadable.", 422, "EXPENSE_PACKET_INVALID") from exc
    source = payload.get("bookkeeping/issued-buyer-source.json")
    history_raw = payload.get("bookkeeping/history.json")
    if source is None or history_raw is None:
        fail("Export Accountant delivery from the original buyer workspace, or select its issued source JSON.",
             "EXPENSE_BOOKKEEPING_SOURCE_REQUIRED")
    source_doc = read_json(source, "issued buyer source")
    period = read_json(payload.get("period.json", b""), "issued period")
    history = read_json(history_raw, "accepted bookkeeping history")
    if (not isinstance(source_doc, dict) or canonical(period) != canonical(source_doc.get("issued"))
            or manifest.get("close_id") != period.get("id")
            or manifest.get("data_context") != period.get("data_context", "operational")):
        fail("The packet's issued period differs from its original buyer source.", "EXPENSE_PACKET_CHANGED")
    if (not isinstance(history, dict) or set(history) != {"revision", "returns"}
            or type(history["revision"]) is not int or history["revision"] < 1
            or not isinstance(history["returns"], list) or len(history["returns"]) > 200):
        fail("Retain the complete original accepted bookkeeping history.", "EXPENSE_HISTORY_INVALID")
    originals = []
    seen = set()
    for item in history["returns"]:
        if not isinstance(item, dict):
            fail("Each accepted accountant return must retain its original record.", "EXPENSE_HISTORY_INVALID")
        ident = identity(item.get("id"), "accepted accountant return identity")
        if ident in seen:
            fail("The accountant history repeats an accepted return.", "EXPENSE_HISTORY_INVALID")
        seen.add(ident)
        name = "bookkeeping/original-returns/" + ident + ".json"
        if name not in payload:
            fail("An accepted accountant return is missing its original packet.", "EXPENSE_HISTORY_INCOMPLETE")
        originals.append({"id": ident, "packetBase64": base64.b64encode(payload[name]).decode("ascii")})
    expected = {"bookkeeping/original-returns/" + ident + ".json" for ident in seen}
    if {name for name in payload if name.startswith("bookkeeping/original-returns/")} != expected:
        fail("Every original returned packet must have its accepted bookkeeping record.", "EXPENSE_HISTORY_INCOMPLETE")
    return {"format": "ACCOUNTANT_ZIP", "source": source, "returns": originals, "history": history,
            "manifestSha256": hashlib.sha256(manifest_raw).hexdigest(), "files": deepcopy(selected)}


def _native(originals):
    selected = os.environ.get("SF47_BUYER_NODE") or shutil.which("node")
    if not selected or not Path(selected).is_absolute() or not Path(selected).is_file():
        fail("The installed grant workspace needs its original Node reader.", "EXPENSE_NODE_UNAVAILABLE", 503)
    if not _READER.acquire(blocking=False):
        fail("Another original expense source is being reviewed. Retain this selection and continue when it finishes.",
             "EXPENSE_READER_BUSY", 409)
    try:
        body = {"sourceBase64": base64.b64encode(originals["source"]).decode("ascii"), "returns": originals["returns"]}
        try:
            result = subprocess.run([selected, "--max-old-space-size=192", str(HELPER)],
                input=canonical(body).encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45, check=False)
        except subprocess.TimeoutExpired as exc:
            raise Problem("The original accountant reader timed out; retain this selected source.", 503, "EXPENSE_READER_TIMEOUT") from exc
        except OSError as exc:
            raise Problem("The installed original accountant reader could not start.", 503, "EXPENSE_READER_UNAVAILABLE") from exc
        if len(result.stdout) > MAX_OUTPUT:
            fail("The original expense review exceeds the supported response size.", "EXPENSE_READER_SIZE", 413)
        try:
            value = json.loads(result.stdout)
        except (UnicodeError, ValueError) as exc:
            raise Problem("The original accountant reader did not return a complete result.", 503, "EXPENSE_READER_INCOMPLETE") from exc
        if result.returncode or not isinstance(value, dict) or value.get("error"):
            code = value.get("error", {}).get("code") if isinstance(value, dict) else None
            code = code if isinstance(code, str) and re.fullmatch(r"[A-Z0-9_]{1,120}", code) else "EXPENSE_SOURCE_REJECTED"
            fail("The original accountant reader rejected the selected source: " + code + ".", code)
        if (value.get("schema") != READER_SCHEMA or value.get("source", {}).get("sha256") != hashlib.sha256(originals["source"]).hexdigest()
                or value.get("source", {}).get("bytes") != len(originals["source"])
                or not isinstance(value.get("rows"), list) or not isinstance(value.get("returns"), list)):
            fail("The returned expense review does not bind to the selected original bytes.", "EXPENSE_READER_CHANGED", 503)
        return value
    finally:
        _READER.release()


def _bookkeeping(originals, native):
    history = originals["history"]
    if history is None:
        return {"revision": None, "returns": [], "current": []}
    inspected = {item["id"]: {k: v for k, v in item.items() if k != "id"} for item in native["returns"]}
    records = {item["id"]: item for item in history["returns"]}
    if set(records) != set(inspected):
        fail("The original reader did not verify every accepted return.", "EXPENSE_HISTORY_INCOMPLETE")
    retired, current, summaries = set(), [], []
    dependencies = {}
    for ident, item in records.items():
        original = inspected[ident]
        if (type(item.get("current")) is not bool
                or item.get("close_id") != native["source"]["buyer"]["closeId"]
                or item.get("source_sha256") != native["source"]["sha256"]
                or item.get("packet_sha256") != original["packetSha256"]
                or item.get("handoff_id") != original["handoffId"]
                or item.get("selected_revision_id") != original["selectedRevisionId"]
                or canonical(item.get("native")) != canonical(original)
                or canonical(item.get("summary")) != canonical(original["summary"])):
            fail("An accepted bookkeeping record differs from its exact original returned packet.", "EXPENSE_HISTORY_CHANGED")
        domain.timestamp(item.get("created_at"), "Original bookkeeping acceptance")
        text(item.get("operator"), "Original bookkeeping operator", 160, True)
        text(item.get("name"), "Original bookkeeping name", 160, True)
        previous, supersedes = item.get("previous"), item.get("supersedes")
        if (previous is not None and previous not in records or not isinstance(supersedes, list)
                or len(set(supersedes)) != len(supersedes) or any(x not in records for x in supersedes)):
            fail("Retain every earlier accepted accountant return and superseded handoff.", "EXPENSE_HISTORY_INCOMPLETE")
        parents = ([previous] if previous else []) + supersedes
        if ident in parents:
            fail("An accepted return cannot replace itself.", "EXPENSE_HISTORY_CHANGED")
        dependencies[ident] = parents
        retired.update(parents)
        if previous:
            prior = inspected[previous]
            chain = {row["id"]: row for row in original["revisions"]}
            saved = chain.get(prior["selectedRevisionId"])
            if (prior["handoffId"] != original["handoffId"] or saved is None
                    or saved["sha256"] != prior["selectedRevisionSha256"]):
                fail("The accepted bookkeeping continuation lost its original revision chain.", "EXPENSE_HISTORY_CHANGED")
        row_ids = {row["sourceLineId"] for row in original["rows"]}
        for old in supersedes:
            if (inspected[old]["handoffId"] == original["handoffId"]
                    or not row_ids.intersection(row["sourceLineId"] for row in inspected[old]["rows"])):
                fail("Retain the original explicit overlap between superseded accountant handoffs.", "EXPENSE_HISTORY_CHANGED")
        summaries.append({**{key: deepcopy(value) for key, value in item.items() if key not in ("native",)},
            "selectedRevisionSha256": original["selectedRevisionSha256"], "packetBytes": original["packetBytes"],
            "revisions": deepcopy(original["revisions"])})
        if item["current"]:
            for row in original["rows"]:
                current.append({**{key: deepcopy(value) for key, value in row.items() if key != "original"},
                    "acceptedReturnId": ident, "handoffId": original["handoffId"],
                    "packetSha256": original["packetSha256"], "acceptedAt": item["created_at"]})
    visiting, visited = set(), set()
    def visit(ident):
        if ident in visiting:
            fail("The original accountant acceptance history contains a cycle.", "EXPENSE_HISTORY_CHANGED")
        if ident in visited:
            return
        visiting.add(ident)
        for prior in dependencies[ident]:
            visit(prior)
        visiting.remove(ident)
        visited.add(ident)
    for ident in records:
        visit(ident)
    if {ident for ident, row in records.items() if row["current"]} != set(records) - retired:
        fail("The current accountant references differ from the retained acceptance history.", "EXPENSE_HISTORY_CHANGED")
    if len({row["sourceLineId"] for row in current}) != len(current):
        fail("Current accountant handoffs overlap on the same original allocation.", "EXPENSE_HISTORY_CHANGED")
    return {"revision": history["revision"], "returns": sorted(summaries, key=lambda x: x["id"]),
            "current": sorted(current, key=lambda x: x["sourceLineId"])}


def inspect(raw):
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_SOURCE:
        fail("Select complete original source bytes up to 8 MiB.", "EXPENSE_SOURCE_SIZE", 413)
    originals = _originals(raw)
    native = _native(originals)
    result = {"schema": SCHEMA, "format": originals["format"],
        "fileSha256": hashlib.sha256(raw).hexdigest(), "fileBytes": len(raw),
        "manifestSha256": originals["manifestSha256"], "source": native["source"],
        "issued": native["issued"], "labels": native["labels"], "rows": native["rows"],
        "bookkeeping": _bookkeeping(originals, native), "files": originals["files"]}
    result["inspectionSha256"] = digest(result)
    return result


def install(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS ops_expense_intakes(
            program_id TEXT NOT NULL REFERENCES ops_programs(id),id TEXT NOT NULL,
            file_sha256 TEXT NOT NULL,body_json TEXT NOT NULL,
            PRIMARY KEY(program_id,id),UNIQUE(program_id,file_sha256));
        CREATE TABLE IF NOT EXISTS ops_expense_attributions(
            program_id TEXT NOT NULL REFERENCES ops_programs(id),id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,source_line_id TEXT NOT NULL,body_json TEXT NOT NULL,
            PRIMARY KEY(program_id,id),UNIQUE(program_id,workspace_id,source_line_id));
    """)


def empty():
    return {"schema": SCHEMA, "intakes": [], "attributions": []}


def load(operations, program_id):
    value = empty()
    for kind, table in (("intakes", "ops_expense_intakes"), ("attributions", "ops_expense_attributions")):
        value[kind] = [json.loads(row[0]) for row in operations.db.execute(
            "SELECT body_json FROM " + table + " WHERE program_id=? ORDER BY id", (program_id,))]
    return value


def retained(context):
    return context.get("expenseRecords") or empty()


def has_records(value):
    return bool(value.get("intakes") or value.get("attributions"))


def close_key(inspection):
    source = inspection["source"]["buyer"]
    return source["workspaceId"], source["closeId"]


def heads(value):
    result = {}
    for intake in value["intakes"]:
        key = close_key(intake["inspection"])
        rank = (intake["inspection"]["bookkeeping"]["revision"] or 0, intake["version"])
        if key not in result or rank > result[key][0]:
            result[key] = rank, intake
    return {key: row[1] for key, row in result.items()}


def _continuity(value, inspection):
    same = [row for row in value["intakes"] if close_key(row["inspection"]) == close_key(inspection)]
    for row in same:
        previous = row["inspection"]
        if previous["source"]["closeSha256"] != inspection["source"]["closeSha256"]:
            fail("This original buyer close identity is already retained with different issued contents.",
                 "EXPENSE_CLOSE_CHANGED", 409)
        old_revision, new_revision = previous["bookkeeping"]["revision"], inspection["bookkeeping"]["revision"]
        if old_revision is None or new_revision is None:
            continue
        if old_revision == new_revision and canonical(previous["bookkeeping"]) != canonical(inspection["bookkeeping"]):
            fail("The same original workspace revision has conflicting accepted bookkeeping references.",
                 "EXPENSE_BOOKKEEPING_DIVERGED", 409)
        older, newer = (previous, inspection) if old_revision <= new_revision else (inspection, previous)
        later = {item["id"]: item for item in newer["bookkeeping"]["returns"]}
        for old in older["bookkeeping"]["returns"]:
            new = later.get(old["id"])
            if new is None or any(new.get(key) != val for key, val in old.items() if key != "current"):
                fail("The later original bookkeeping export must retain every earlier accepted packet and record.",
                     "EXPENSE_BOOKKEEPING_DIVERGED", 409)
    return same


def preview(context, body):
    fields(body, ("expectedVersion", "filename", "contentBase64"), "expense preview")
    expected = domain.integer(body.get("expectedVersion"), "Reviewed operations version", 1, 10000000)
    if context["program"]["version"] != expected:
        fail("The Operations case changed. Refresh it before reviewing this original expense file.",
             "OPERATIONS_CONFLICT", 409)
    name = plain_filename(body.get("filename"))
    inspection = inspect(source_bytes(body.get("contentBase64")))
    value = retained(context)
    same = _continuity(value, inspection)
    exact = next((row for row in value["intakes"] if row["inspection"]["fileSha256"] == inspection["fileSha256"]), None)
    current = heads(value).get(close_key(inspection))
    historical = bool(current and (current["inspection"]["bookkeeping"]["revision"] or 0) >
                      (inspection["bookkeeping"]["revision"] or 0))
    existing = {(row["source"]["workspaceId"], row["source"]["sourceLineId"]): row for row in value["attributions"]}
    rows = []
    workspace = inspection["source"]["buyer"]["workspaceId"]
    for row in inspection["rows"]:
        original = existing.get((workspace, row["sourceLineId"]))
        rows.append({**row, "attributionId": original["id"] if original else None,
                     "attributionState": original["state"] if original else None})
    result = {"schema": SCHEMA, "caseId": context["program"]["id"], "version": expected,
        "filename": name, "inspection": inspection, "rows": rows,
        "receiving": "ALREADY_RETAINED" if exact else "HISTORICAL_EDITION" if historical else "CURRENT_ORIGINAL",
        "retainedIntakeId": exact["id"] if exact else None,
        "previousIntakeId": current["id"] if current else None,
        "previousSources": [row["id"] for row in same],
        "costs": [{"id": row["id"], "tranche": row["tranche"], "plannedUsd": domain.usd(row["amount_usd"])}
                  for row in context["plan"]["scenario"]["future_costs"]]}
    result["previewSha256"] = digest(result)
    return result


def _attach(operations, context, raw, name, observed):
    sha256 = hashlib.sha256(raw).hexdigest()
    for metadata in context["sources"].values():
        if metadata["sha256"] == sha256 and metadata["bytes"] == len(raw):
            _, actual = operations.source(context["program"]["id"], metadata["id"])
            if actual != raw:
                fail("A retained original source differs from its recorded identity.", "EXPENSE_SOURCE_CHANGED", 409)
            return metadata, False
    metadata = operations._source_add(context["program"]["id"], {
        "filename": name, "contentBase64": base64.b64encode(raw).decode("ascii"),
        "mediaType": "application/zip" if raw.startswith(b"PK") else "application/json",
        "kind": "other", "observedAt": observed, "sourceUrl": ""})
    context["sources"][metadata["id"]] = metadata
    return metadata, True


def receive(operations, context, data, actor, version):
    fields(data, ("filename", "contentBase64", "expectedPreviewSha256"), "expense receiving command")
    checked = preview(context, {"expectedVersion": context["program"]["version"],
                               "filename": data.get("filename"), "contentBase64": data.get("contentBase64")})
    if checked["previewSha256"] != domain.sha(data.get("expectedPreviewSha256"), "Reviewed expense preview", False):
        fail("The original expense source or Operations case changed after preview.", "EXPENSE_PREVIEW_CHANGED", 409)
    if checked["retainedIntakeId"]:
        return {"unchanged": True, "kind": "expenseIntake", "recordId": checked["retainedIntakeId"],
                "before": None, "after": None, "sourceSha256": checked["inspection"]["fileSha256"]}
    values = retained(context)
    if len(values["intakes"]) >= MAX_INTAKES:
        fail("This case has reached its original expense source bound.", "EXPENSE_INTAKE_LIMIT", 413)
    raw = source_bytes(data["contentBase64"])
    source, created = _attach(operations, context, raw, checked["filename"], checked["inspection"]["issued"]["createdAt"])
    stamp = now()
    row = {"id": "expense-intake-" + uuid.uuid4().hex, "schema": SCHEMA, "version": version,
        "createdAt": stamp, "actor": actor, "sourceId": source["id"], "filename": checked["filename"],
        "inspection": checked["inspection"]}
    operations.db.execute("INSERT INTO ops_expense_intakes VALUES(?,?,?,?)",
        (context["program"]["id"], row["id"], row["inspection"]["fileSha256"], canonical(row)))
    return {"unchanged": False, "kind": "expenseIntake", "recordId": row["id"], "before": None, "after": row,
            "sourceIds": [source["id"]], "sourceSha256": row["inspection"]["fileSha256"],
            "receiving": checked["receiving"],
            "sourceChange": {"before": None, "after": source} if created else None}


def _line(intake, source_line_id):
    row = next((row for row in intake["inspection"]["rows"] if row["sourceLineId"] == source_line_id), None)
    if row is None:
        fail("Select an original allocation in this received expense edition.", "EXPENSE_LINE_NOT_FOUND", 404)
    return row


def _binding(intake, row):
    inspection = intake["inspection"]
    buyer = inspection["source"]["buyer"]
    bookkeeping = [deepcopy(value) for value in inspection["bookkeeping"]["current"]
                   if value["sourceLineId"] == row["sourceLineId"]]
    basis = {"workspaceId": buyer["workspaceId"], "closeId": buyer["closeId"],
        "sourceSha256": inspection["source"]["sha256"], "closeSha256": inspection["source"]["closeSha256"],
        "sourceLineId": row["sourceLineId"], "sourceRowSha256": row["sourceRowSha256"],
        "bookkeeping": bookkeeping}
    return {**basis, "bindingSha256": digest(basis), "intakeId": intake["id"], "sourceId": intake["sourceId"],
            "kind": row["kind"], "original": deepcopy(row["original"]),
            "period": deepcopy(inspection["issued"]["period"]),
            "dataContext": buyer["dataContext"]}


def _selection(context, intake_id, line_id, current=True):
    value = retained(context)
    intake = next((row for row in value["intakes"] if row["id"] == intake_id), None)
    if intake is None:
        fail("Choose a retained original expense intake.", "EXPENSE_INTAKE_NOT_FOUND", 404)
    if current and heads(value)[close_key(intake["inspection"])]["id"] != intake_id:
        fail("Use the latest received accountant edition for this original close.", "EXPENSE_CURRENT_EDITION_REQUIRED", 409)
    row = _line(intake, line_id)
    return intake, row, _binding(intake, row)


def _content(row):
    return {key: deepcopy(row[key]) for key in ("source", "allocations", "valuation", "unattributedReason",
                                               "linkedInvoiceIds", "linkedPurchaseIds", "linkedWorkIds")}


def normalized(context, data, previous=None, restoring=False):
    fields(data, ("id", "intakeId", "sourceLineId", "expectedSourceRowSha256", "allocations", "valuation",
                  "unattributedReason", "linkedInvoiceIds", "linkedPurchaseIds", "linkedWorkIds"), "expense allocation")
    _, line, source = _selection(context, data.get("intakeId"), data.get("sourceLineId"), current=not restoring)
    if domain.sha(data.get("expectedSourceRowSha256"), "Original allocation SHA256", False) != line["sourceRowSha256"]:
        fail("The selected original allocation changed. Review its retained native fields.", "EXPENSE_LINE_CHANGED", 409)
    if previous and (previous["source"]["workspaceId"] != source["workspaceId"]
                     or previous["source"]["sourceLineId"] != source["sourceLineId"]):
        fail("An existing attribution retains its original buyer allocation identity.", "EXPENSE_ATTRIBUTION_CHANGED", 409)
    parts = data.get("allocations")
    if not isinstance(parts, list) or len(parts) > 200:
        fail("Use up to 200 explicit work-package allocations.")
    allocations, total, seen = [], 0, set()
    for index, part in enumerate(parts, 1):
        fields(part, ("costId", "fundingBasis", "nativeAmount", "usdValue", "memo"), "native cost allocation")
        cost = domain.cost_id(part.get("costId"), context["plan"])
        if cost is None:
            fail("Choose the original funded work package for each attributed amount.")
        funding = domain.enum(part.get("fundingBasis"), ("GRANT", "CUSTOMER", "INTERNAL", "PREAWARD"), "Funding basis")
        if (cost, funding) in seen:
            fail("Combine each work-package and funding-basis allocation into one explicit line.")
        seen.add((cost, funding))
        amount = native_amount(part.get("nativeAmount"), "Attributed native amount", True)
        total += int(amount)
        usd_value = part.get("usdValue")
        if usd_value in (None, ""):
            usd_value = None
        else:
            usd_value = domain.usd(usd_value, "Explicit USD valuation")
        allocations.append({"line": index, "costId": cost, "fundingBasis": funding, "nativeAmount": amount,
                            "usdValue": usd_value, "memo": text(part.get("memo", ""), "Attribution note", 2000)})
    maximum = int(line["original"]["amount"])
    if total > maximum:
        fail("The combined work-package allocations exceed this issued native expense or credit line.",
             "EXPENSE_OVERALLOCATED", 409)
    remaining = maximum - total
    reason = text(data.get("unattributedReason", ""), "Reason for the retained remainder", 4000, remaining > 0)
    valued = any(part["usdValue"] is not None for part in allocations)
    valuation = data.get("valuation")
    if valuation not in (None, {}):
        fields(valuation, ("mode", "date", "sourceIds", "note", "nativeUnit", "rate"), "original valuation reference")
        mode = domain.enum(valuation.get("mode", "ENTERED_USD"), ("ENTERED_USD", "RETAINED_RATE"), "Valuation method")
        ids = domain.reference_list(valuation.get("sourceIds", []), context["sources"], "Valuation sources")
        if not ids:
            fail("Attach the selected unit and valuation source before entering a monetary comparison.", "EXPENSE_VALUATION_SOURCE_REQUIRED")
        normalized_valuation = {"mode": mode, "date": domain.calendar(valuation.get("date"), "Valuation date"),
            "sourceIds": ids, "note": text(valuation.get("note"), "Valuation method and source", 4000, True)}
        if mode == "ENTERED_USD":
            if not valued or valuation.get("nativeUnit") is not None or valuation.get("rate") is not None:
                fail("Enter the original USD values, or choose an explicit native-unit rate valuation.")
        else:
            if valued:
                fail("The original currency model derives USD from the selected native units and retained rate.")
            unit = fields(valuation.get("nativeUnit"), ("currency", "decimals"), "native unit definition")
            code = currency.code(unit.get("currency"), "Selected original unit currency")
            decimals = domain.integer(unit.get("decimals"), "Original asset decimal places", 0, 18)
            raw_rate = valuation.get("rate")
            rates = currency.normalize_rates(context, [raw_rate] if raw_rate is not None else [], normalized_valuation["date"])
            rate_map = {row["id"]: row for row in rates}
            with localcontext() as arithmetic:
                arithmetic.prec = 120
                amounts = [Decimal(part["nativeAmount"]).scaleb(-decimals) for part in allocations]
                total_native = currency.quantity(currency.native(sum(amounts, Decimal(0))),
                    "Attributed original native units", places=18)
                # Invoice-entry precision is separate from token atomic precision.
                # Keep the original currency/rate relationship validation, then
                # pass the exact scaled native units through its unchanged allocator.
                money = currency.normalize_money({"amount": "0", "currency": code,
                    "fxRateId": rates[0]["id"] if rates else None}, rate_map, "Attributed original native units")
                money["amount"] = total_native
                converted = currency.allocate(amounts, money, rate_map)
                for part, amount_usd in zip(allocations, converted):
                    part["usdValue"] = amount_usd
                normalized_valuation.update({"nativeUnit": {"currency": code, "decimals": decimals},
                    "rate": rates[0] if rates else None, "originalMoney": money,
                    "calculation": currency.money_details(money, rate_map)})
        valuation = normalized_valuation
    elif valued:
        fail("Retain the original source and review basis for entered USD amounts.", "EXPENSE_VALUATION_SOURCE_REQUIRED")
    else:
        valuation = None
    links = {}
    for key, kind in (("linkedInvoiceIds", "invoices"), ("linkedPurchaseIds", "purchases"), ("linkedWorkIds", "work")):
        available = {row["id"]: row for row in context["records"][kind]}
        ids = domain.reference_list(data.get(key, []), available, key)
        if not restoring and any(available[ident]["state"] == "VOID" for ident in ids):
            fail("Select active original operating records for this attribution.")
        links[key] = ids
    return {"source": source, "allocations": allocations, "valuation": valuation,
            "unattributedReason": reason, **links}


def _save_attribution(operations, program_id, row):
    operations.db.execute("""INSERT INTO ops_expense_attributions VALUES(?,?,?,?,?)
        ON CONFLICT(program_id,id) DO UPDATE SET body_json=excluded.body_json""",
        (program_id, row["id"], row["source"]["workspaceId"], row["source"]["sourceLineId"], canonical(row)))


def attribution_command(operations, context, action, data, actor, version, note):
    values = retained(context)
    ident = data.get("id")
    previous = next((row for row in values["attributions"] if row["id"] == ident), None) if ident else None
    if ident and previous is None:
        fail("Choose a retained expense attribution.", "EXPENSE_ATTRIBUTION_NOT_FOUND", 404)
    stamp = now()
    if action == "expense.save":
        if previous and previous["state"] != "DRAFT":
            fail("Reopen this attribution before changing its source, amounts or valuation.", "EXPENSE_ATTRIBUTION_REVIEWED", 409)
        content = normalized(context, data, previous)
        original = next((row for row in values["attributions"]
            if row["source"]["workspaceId"] == content["source"]["workspaceId"]
            and row["source"]["sourceLineId"] == content["source"]["sourceLineId"]), None)
        if original and (previous is None or original["id"] != previous["id"]):
            fail("This issued allocation already has its original attribution. Reopen that record.",
                 "EXPENSE_ORIGINAL_ATTRIBUTION_REQUIRED", 409)
        if previous is None:
            other = operations.db.execute("SELECT COUNT(*) FROM ops_records WHERE program_id=?", (context["program"]["id"],)).fetchone()[0]
            if len(values["attributions"]) + other >= MAX_ATTRIBUTIONS:
                fail("This case has reached its retained operating-record bound.", "EXPENSE_ATTRIBUTION_LIMIT", 413)
        after = {**content, "schema": SCHEMA, "id": previous["id"] if previous else "expense-attribution-" + uuid.uuid4().hex,
            "state": "DRAFT", "version": version, "createdAt": previous["createdAt"] if previous else stamp,
            "updatedAt": stamp, "recordedBy": actor, "contentSha256": digest(content), "review": None}
    else:
        fields(data, ("id", "expectedContentSha256"), "expense review transition")
        if previous is None or not note:
            fail("Choose the retained attribution and record the reason for this transition.")
        if domain.sha(data.get("expectedContentSha256"), "Reviewed expense allocation", False) != previous["contentSha256"]:
            fail("The original attribution differs from the reviewed selection.", "EXPENSE_REVIEW_CHANGED", 409)
        allowed = {"expense.review": ({"DRAFT"}, "REVIEWED"), "expense.reopen": ({"REVIEWED", "VOID"}, "DRAFT"),
                   "expense.void": ({"DRAFT", "REVIEWED"}, "VOID")}
        rule = allowed.get(action)
        if rule is None or previous["state"] not in rule[0]:
            fail("That action is unavailable from the retained attribution state.", "EXPENSE_STATE_CHANGED", 409)
        after = {**deepcopy(previous), "state": rule[1], "version": version, "updatedAt": stamp,
                 "reviewedBy": actor, "reviewNote": note}
        if action == "expense.review":
            intake, row, _ = _selection(context, previous["source"]["intakeId"], previous["source"]["sourceLineId"], current=False)
            latest = heads(values)[close_key(intake["inspection"])]
            selected = _binding(latest, _line(latest, row["sourceLineId"]))
            if selected["bindingSha256"] != previous["source"]["bindingSha256"]:
                fail("The original accountant references changed. Save the current source edition before review.",
                     "EXPENSE_BOOKKEEPING_REFRESH_REQUIRED", 409)
            after["review"] = {"actor": actor, "at": stamp, "version": version,
                               "contentSha256": after["contentSha256"], "note": note}
        elif action == "expense.reopen":
            after["review"] = None
    _save_attribution(operations, context["program"]["id"], after)
    return {"unchanged": False, "kind": "expenseAttribution", "recordId": after["id"],
            "before": previous, "after": after}


def source_binding_current(value, row):
    intake = next((item for item in value["intakes"] if item["id"] == row["source"]["intakeId"]), None)
    if intake is None:
        return None
    latest = heads(value).get(close_key(intake["inspection"]))
    if latest is None:
        return None
    line = next((item for item in latest["inspection"]["rows"] if item["sourceLineId"] == row["source"]["sourceLineId"]), None)
    return _binding(latest, line) if line else None


def dashboard(context):
    value = retained(context)
    current = heads(value)
    sources = []
    for intake in value["intakes"]:
        i = intake["inspection"]
        sources.append({"id": intake["id"], "sourceId": intake["sourceId"], "filename": intake["filename"],
            "createdAt": intake["createdAt"], "actor": intake["actor"], "version": intake["version"],
            "format": i["format"], "fileSha256": i["fileSha256"], "fileBytes": i["fileBytes"],
            "source": deepcopy(i["source"]), "issued": deepcopy(i["issued"]),
            "bookkeeping": {key: deepcopy(i["bookkeeping"][key]) for key in ("revision", "returns")},
            "rows": len(i["rows"]), "current": current[close_key(i)]["id"] == intake["id"]})
    assigned = {(row["source"]["workspaceId"], row["source"]["sourceLineId"]): row for row in value["attributions"]}
    lines = []
    for intake in current.values():
        i = intake["inspection"]
        for row in i["rows"]:
            linked = assigned.get((i["source"]["buyer"]["workspaceId"], row["sourceLineId"]))
            lines.append({**deepcopy(row), "intakeId": intake["id"], "sourceId": intake["sourceId"],
                "workspaceId": i["source"]["buyer"]["workspaceId"], "closeId": i["source"]["buyer"]["closeId"],
                "dataContext": i["source"]["buyer"]["dataContext"],
                "bookkeeping": [deepcopy(x) for x in i["bookkeeping"]["current"] if x["sourceLineId"] == row["sourceLineId"]],
                "attributionId": linked["id"] if linked else None, "attributionState": linked["state"] if linked else None})
    attributions, issues = [], []
    for row in value["attributions"]:
        selected = source_binding_current(value, row)
        changed = selected is None or selected["bindingSha256"] != row["source"]["bindingSha256"]
        actions = {"DRAFT": ["expense.save", "expense.review", "expense.void"],
                   "REVIEWED": ["expense.reopen", "expense.void"], "VOID": ["expense.reopen"]}[row["state"]]
        if changed:
            actions = [x for x in actions if x != "expense.review"]
        if context["program"]["state"] != "OPEN":
            actions = []
        attributions.append({**deepcopy(row), "currentSource": selected, "bookkeepingChanged": changed,
                             "allowedActions": actions})
        if changed and row["state"] != "VOID":
            issues.append({"id": row["id"], "code": "ORIGINAL_REFERENCE_CHANGED",
                "message": "A later received source has changed accountant references; the reviewed original attribution remains retained."})
        if row["state"] == "DRAFT":
            issues.append({"id": row["id"], "code": "ATTRIBUTION_DRAFT", "message": "The native allocations await recorded review."})
        if row["state"] != "VOID" and any(x["usdValue"] is None for x in row["allocations"]):
            issues.append({"id": row["id"], "code": "NATIVE_AMOUNT_WITHOUT_USD", "message": "Native amounts are retained without an entered USD valuation."})
    return {"schema": SCHEMA, "caseId": context["program"]["id"], "version": context["program"]["version"],
        "sources": sorted(sources, key=lambda x: (x["createdAt"], x["id"]), reverse=True),
        "lines": lines, "attributions": attributions, "reviewItems": issues,
        "costs": [{"id": row["id"], "tranche": row["tranche"], "plannedUsd": domain.usd(row["amount_usd"])}
                  for row in context["plan"]["scenario"]["future_costs"]],
        "canReceive": context["program"]["state"] == "OPEN",
        "summary": expense_report(context)}


def expense_report(context):
    value = retained(context)
    native, packages = {}, {}
    expense_usd, credit_usd = Decimal(0), Decimal(0)
    excluded, unvalued, draft = [], [], []
    for row in value["attributions"]:
        if row["state"] == "VOID":
            continue
        if row["state"] != "REVIEWED":
            draft.append(row["id"])
            continue
        original = row["source"]["original"]
        is_credit = row["source"]["kind"] == "CREDIT"
        assumption = (row.get("valuation") or {}).get("rate", {}) or {}
        operational = (context["program"]["mode"] == "OPERATIONS" and row["source"]["dataContext"] == "operational"
                       and "testnet" not in original["network"].lower() and assumption.get("basis") != "PLANNING_ASSUMPTION")
        if not operational:
            excluded.append(row["id"])
        for part in row["allocations"]:
            key = canonical([original["network"], original["asset"], part["costId"], part["fundingBasis"], operational])
            bucket = native.setdefault(key, {"network": original["network"], "asset": original["asset"],
                "costId": part["costId"], "fundingBasis": part["fundingBasis"], "operational": operational,
                "expense": 0, "credit": 0, "attributionIds": []})
            bucket["credit" if is_credit else "expense"] += int(part["nativeAmount"])
            if row["id"] not in bucket["attributionIds"]:
                bucket["attributionIds"].append(row["id"])
            if part["usdValue"] is None:
                unvalued.append({"id": row["id"], "line": part["line"]})
                continue
            if not operational:
                continue
            amount = Decimal(part["usdValue"])
            key = canonical([part["costId"], part["fundingBasis"]])
            target = packages.setdefault(key, {"costId": part["costId"], "fundingBasis": part["fundingBasis"],
                                              "expenseUsd": Decimal(0), "creditUsd": Decimal(0)})
            target["creditUsd" if is_credit else "expenseUsd"] += amount
            if is_credit:
                credit_usd += amount
            else:
                expense_usd += amount
    native_rows = []
    for bucket in native.values():
        native_rows.append({**bucket, "expense": str(bucket["expense"]), "credit": str(bucket["credit"]),
                            "net": str(bucket["expense"] - bucket["credit"])})
    package_rows = [{**row, "expenseUsd": format(row["expenseUsd"], ".2f"), "creditUsd": format(row["creditUsd"], ".2f"),
                     "netUsd": format(row["expenseUsd"] - row["creditUsd"], ".2f")} for row in packages.values()]
    return {"schema": SCHEMA + ".report", "intakes": len(value["intakes"]), "attributions": len(value["attributions"]),
        "reviewed": sum(row["state"] == "REVIEWED" for row in value["attributions"]),
        "draftIds": draft, "nativeAmounts": native_rows, "packages": package_rows,
        "operationalExpenseUsd": format(expense_usd, ".2f"), "operationalCreditUsd": format(credit_usd, ".2f"),
        "operationalNetUsd": format(expense_usd - credit_usd, ".2f"),
        "unvaluedAllocations": unvalued, "excludedOperationalIds": excluded,
        "basis": "Reviewed expense attribution; original invoices and cash remain separate."}


def record_count(operations, program_id):
    return operations.db.execute(
        "SELECT (SELECT COUNT(*) FROM ops_records WHERE program_id=?) + "
        "(SELECT COUNT(*) FROM ops_expense_attributions WHERE program_id=?)",
        (program_id, program_id)).fetchone()[0]


def allocation_input(row):
    """Recover operator inputs from the retained normalized edition."""
    valuation = deepcopy(row.get("valuation"))
    if valuation is not None:
        valuation.pop("originalMoney", None)
        valuation.pop("calculation", None)
    parts = []
    for part in row["allocations"]:
        item = {key: deepcopy(value) for key, value in part.items() if key != "line"}
        if valuation and valuation["mode"] == "RETAINED_RATE":
            item.pop("usdValue", None)
        parts.append(item)
    return {"id": row["id"], "intakeId": row["source"]["intakeId"],
        "sourceLineId": row["source"]["sourceLineId"],
        "expectedSourceRowSha256": row["source"]["sourceRowSha256"],
        "allocations": parts, "valuation": valuation,
        **{key: deepcopy(row[key]) for key in ("unattributedReason",
            "linkedInvoiceIds", "linkedPurchaseIds", "linkedWorkIds")}}


def validate_import(context, value, events, reviews, files, *, plan_for_version=None):
    """Validate original bytes and replay this domain in the original event order."""
    expense_events = [event for event in events if event.get("action") in ACTIONS]
    if value is None:
        if expense_events:
            fail("The complete operating history requires its retained expense records.", "EXPENSE_IMPORT_INCOMPLETE")
        return empty()
    if not isinstance(value, dict) or set(value) != {"schema", "intakes", "attributions"} or value.get("schema") != SCHEMA:
        fail("Retain the complete supported expense-attribution document.", "EXPENSE_IMPORT_INVALID")
    if (not isinstance(value["intakes"], list) or len(value["intakes"]) > MAX_INTAKES
            or not isinstance(value["attributions"], list)
            or len(value["attributions"]) + sum(len(rows) for rows in context["records"].values()) > MAX_ATTRIBUTIONS):
        fail("The retained expense record set exceeds the original case bound.", "EXPENSE_IMPORT_SIZE", 413)
    intakes, attributions = {}, {}
    maximum = context["program"]["version"]
    for row in value["intakes"]:
        if not isinstance(row, dict) or set(row) != {
                "id", "schema", "version", "createdAt", "actor", "sourceId", "filename", "inspection"}:
            fail("The retained expense intake is incomplete.", "EXPENSE_IMPORT_INVALID")
        ident = identity(row.get("id"), "expense intake")
        if not re.fullmatch(r"expense-intake-[a-f0-9]{32}", ident) or ident in intakes or row["schema"] != SCHEMA:
            fail("The retained expense intake identity is invalid or repeated.", "EXPENSE_IMPORT_INVALID")
        domain.integer(row["version"], "Original expense intake version", 2, maximum)
        domain.timestamp(row["createdAt"], "Original expense receiving time")
        text(row["actor"], "Original expense receiving operator", 300, True)
        plain_filename(row["filename"])
        source = context["sources"].get(row.get("sourceId"))
        if source is None:
            fail("A retained expense intake lost its complete original attachment.", "EXPENSE_IMPORT_INCOMPLETE")
        raw = files.get("sources/" + source["id"])
        if raw is None or len(raw) != source["bytes"] or hashlib.sha256(raw).hexdigest() != source["sha256"]:
            fail("A retained original expense attachment changed.", "EXPENSE_SOURCE_CHANGED")
        observed = inspect(raw)
        if canonical(observed) != canonical(row["inspection"]):
            fail("The retained expense projection differs from its original issued source and returned packets.",
                 "EXPENSE_IMPORT_CHANGED")
        intakes[ident] = row
    if len({row["inspection"]["fileSha256"] for row in intakes.values()}) != len(intakes):
        fail("The expense import repeats one original received file.", "EXPENSE_IMPORT_INVALID")
    for row in value["attributions"]:
        if not isinstance(row, dict):
            fail("The retained attribution must be an object.", "EXPENSE_IMPORT_INVALID")
        ident = identity(row.get("id"), "expense attribution")
        if not re.fullmatch(r"expense-attribution-[a-f0-9]{32}", ident) or ident in attributions:
            fail("The retained expense attribution identity is invalid or repeated.", "EXPENSE_IMPORT_INVALID")
        attributions[ident] = row
    original_lines = [(row.get("source", {}).get("workspaceId"), row.get("source", {}).get("sourceLineId"))
                      for row in attributions.values()]
    if len(set(original_lines)) != len(original_lines):
        fail("The received case repeats an original buyer allocation.", "EXPENSE_IMPORT_DUPLICATE")
    replay = empty()
    received, current = {}, {}
    review_by_id = {review["id"]: review for review in reviews}
    for event in events:
        action = event.get("action")
        if action == "review":
            review = review_by_id.get(event.get("recordId"))
            if review and canonical(review["snapshot"].get("expenseRecords") or empty()) != canonical(replay):
                fail("A frozen operating review differs from its original expense history.", "EXPENSE_IMPORT_REVIEW_CHANGED")
        if action not in ACTIONS:
            continue
        version = event["version"]
        actor = text(event.get("actor"), "Original expense event operator", 300, True)
        note = text(event.get("note", ""), "Original expense event note", 12000)
        ident = event.get("recordId")
        after, before = event.get("after"), event.get("before")
        if action == "expense.receive":
            row = intakes.get(ident)
            if (row is None or ident in received or event.get("kind") != "expenseIntake"
                    or before is not None or canonical(after) != canonical(row)
                    or row["version"] != version or row["actor"] != actor):
                fail("The received expense edition does not match its original event.", "EXPENSE_IMPORT_HISTORY_CHANGED")
            _continuity(replay, row["inspection"])
            received[ident] = row
            replay["intakes"] = sorted(received.values(), key=lambda item: item["id"])
            continue
        if event.get("kind") != "expenseAttribution" or ident not in attributions or not isinstance(after, dict):
            fail("The expense attribution event has no complete retained record.", "EXPENSE_IMPORT_HISTORY_CHANGED")
        previous = current.get(ident)
        if canonical(before) != canonical(previous):
            fail("The expense attribution lost its original previous edition.", "EXPENSE_IMPORT_HISTORY_CHANGED")
        allowed_keys = {"schema", "id", "state", "version", "createdAt", "updatedAt", "recordedBy",
                        "contentSha256", "review", "reviewedBy", "reviewNote",
                        "source", "allocations", "valuation", "unattributedReason",
                        "linkedInvoiceIds", "linkedPurchaseIds", "linkedWorkIds"}
        required_keys = allowed_keys - {"reviewedBy", "reviewNote"}
        if (set(after) - allowed_keys or not required_keys.issubset(after)
                or after["schema"] != SCHEMA or after["id"] != ident or after["version"] != version):
            fail("The expense event's normalized record is incomplete.", "EXPENSE_IMPORT_INVALID")
        domain.timestamp(after["createdAt"], "Original attribution creation")
        domain.timestamp(after["updatedAt"], "Original attribution update")
        text(after["recordedBy"], "Original attribution operator", 300, True)
        original_context = {**context, "expenseRecords": replay}
        if action == "expense.save":
            # A saved allocation belongs to the plan selected before its native
            # command. Later baseline editions can retire that work package.
            if plan_for_version is not None:
                original_context["plan"] = plan_for_version(version - 1)
            content = normalized(original_context, allocation_input(after), previous, restoring=True)
        else:
            # Review, reopen and void preserve the last saved source allocation;
            # they do not perform a new cost selection or currency conversion.
            if previous is None:
                fail("The expense transition lost its original saved allocation.", "EXPENSE_IMPORT_HISTORY_CHANGED")
            content = _content(previous)
        if canonical(_content(after)) != canonical(content) or digest(content) != after["contentSha256"]:
            fail("The retained expense allocation differs from its native source, cost split or original valuation.",
                 "EXPENSE_IMPORT_CHANGED")
        if previous and after["createdAt"] != previous["createdAt"]:
            fail("An expense continuation changed its original creation time.", "EXPENSE_IMPORT_HISTORY_CHANGED")
        same_line = next((item for item in current.values()
                         if item["source"]["workspaceId"] == after["source"]["workspaceId"]
                         and item["source"]["sourceLineId"] == after["source"]["sourceLineId"]
                         and item["id"] != ident), None)
        if same_line:
            fail("The expense history repeats an original buyer allocation.", "EXPENSE_IMPORT_DUPLICATE")
        if action == "expense.save":
            expected = {**content, "schema": SCHEMA, "id": ident, "state": "DRAFT",
                "version": version, "createdAt": previous["createdAt"] if previous else after["createdAt"],
                "updatedAt": after["updatedAt"], "recordedBy": actor,
                "contentSha256": digest(content), "review": None}
            if previous and previous["state"] != "DRAFT":
                fail("An expense edit bypassed the original reopen transition.", "EXPENSE_IMPORT_HISTORY_CHANGED")
        else:
            rules = {"expense.review": ({"DRAFT"}, "REVIEWED"),
                     "expense.reopen": ({"REVIEWED", "VOID"}, "DRAFT"),
                     "expense.void": ({"DRAFT", "REVIEWED"}, "VOID")}
            allowed, state = rules[action]
            if previous is None or previous["state"] not in allowed or not note:
                fail("The expense review history has an invalid lifecycle transition.", "EXPENSE_IMPORT_HISTORY_CHANGED")
            expected = {**deepcopy(previous), "state": state, "version": version,
                "updatedAt": after["updatedAt"], "reviewedBy": actor, "reviewNote": note}
            if action == "expense.review":
                binding = source_binding_current(replay, previous)
                if binding is None or binding["bindingSha256"] != previous["source"]["bindingSha256"]:
                    fail("The original review did not select its current accountant references.", "EXPENSE_IMPORT_REVIEW_CHANGED")
                expected["review"] = {"actor": actor, "at": after["updatedAt"], "version": version,
                                     "contentSha256": after["contentSha256"], "note": note}
            elif action == "expense.reopen":
                expected["review"] = None
        if canonical(after) != canonical(expected):
            fail("The retained expense edition does not match its original recorded transition.", "EXPENSE_IMPORT_HISTORY_CHANGED")
        current[ident] = after
        replay["attributions"] = sorted(current.values(), key=lambda item: item["id"])
    if set(received) != set(intakes) or set(current) != set(attributions):
        fail("The complete expense history is missing an original receiving or allocation event.", "EXPENSE_IMPORT_INCOMPLETE")
    if canonical(replay["attributions"]) != canonical(sorted(attributions.values(), key=lambda item: item["id"])):
        fail("The current expense register differs from its final original events.", "EXPENSE_IMPORT_HISTORY_CHANGED")
    return deepcopy(replay)


def save_import(operations, program_id, value):
    for row in value["intakes"]:
        operations.db.execute("INSERT INTO ops_expense_intakes VALUES(?,?,?,?)",
            (program_id, row["id"], row["inspection"]["fileSha256"], canonical(row)))
    for row in value["attributions"]:
        _save_attribution(operations, program_id, row)


EXPORT_NAMES = {"expense-attributions.csv", "expense-sources.csv", "expense-attribution.html"}


def export_files(context):
    if not has_records(retained(context)):
        return {}
    rows = []
    for record in retained(context)["attributions"]:
        source = record["source"]
        original = source["original"]
        common = {"id": record["id"], "state": record["state"], "version": record["version"],
            "kind": source["kind"], "workspaceId": source["workspaceId"], "closeId": source["closeId"],
            "sourceLineId": source["sourceLineId"], "sourceSha256": source["sourceSha256"],
            "sourceRowSha256": source["sourceRowSha256"], "intakeId": source["intakeId"],
            "network": original["network"], "asset": original["asset"], "issuedNativeAmount": original["amount"],
            "reviewedBy": (record.get("review") or {}).get("actor", ""),
            "reviewedAt": (record.get("review") or {}).get("at", ""),
            "bookkeepingReferences": canonical(source["bookkeeping"]),
            "valuation": canonical(record["valuation"]), "unattributedReason": record["unattributedReason"],
            **{key: canonical(record[key]) for key in ("linkedInvoiceIds", "linkedPurchaseIds", "linkedWorkIds")}}
        allocated = sum(int(part["nativeAmount"]) for part in record["allocations"])
        common["unattributedNativeAmount"] = str(int(original["amount"]) - allocated)
        for part in record["allocations"] or [{}]:
            rows.append({**common, **part})
    intake_rows = []
    for item in retained(context)["intakes"]:
        source = item["inspection"]
        intake_rows.append({"id": item["id"], "sourceId": item["sourceId"], "filename": item["filename"],
            "createdAt": item["createdAt"], "actor": item["actor"], "fileSha256": source["fileSha256"],
            "fileBytes": source["fileBytes"], "format": source["format"], "sourceSha256": source["source"]["sha256"],
            "workspaceId": source["source"]["buyer"]["workspaceId"], "closeId": source["source"]["buyer"]["closeId"],
            "issuedAt": source["issued"]["createdAt"], "dataContext": source["source"]["buyer"]["dataContext"],
            "bookkeepingRevision": source["bookkeeping"]["revision"],
            "acceptedReturnIds": canonical([record["id"] for record in source["bookkeeping"]["returns"]]),
            "currentReturnIds": canonical([record["id"] for record in source["bookkeeping"]["returns"] if record["current"]])})
    allocation_headers = ["id", "state", "version", "kind", "workspaceId", "closeId", "intakeId", "sourceLineId",
        "sourceSha256", "sourceRowSha256", "network", "asset", "issuedNativeAmount", "line", "costId", "fundingBasis",
        "nativeAmount", "usdValue", "memo", "unattributedNativeAmount", "unattributedReason",
        "reviewedBy", "reviewedAt", "bookkeepingReferences", "valuation",
        "linkedInvoiceIds", "linkedPurchaseIds", "linkedWorkIds"]
    source_headers = ["id", "sourceId", "filename", "createdAt", "actor", "fileSha256", "fileBytes", "format",
        "sourceSha256", "workspaceId", "closeId", "issuedAt", "dataContext", "bookkeepingRevision",
        "acceptedReturnIds", "currentReturnIds"]
    return {"expense-attributions.csv": csv_bytes(allocation_headers, rows),
            "expense-sources.csv": csv_bytes(source_headers, intake_rows),
            "expense-attribution.html": render_html(context)}


def render_html(context):
    from html import escape
    view = dashboard(context)
    report = view["summary"]
    def shown(value):
        return escape("" if value is None else str(value))
    def table(headers, rows):
        return "<table><thead><tr>" + "".join("<th>" + shown(x) + "</th>" for x in headers) + "</tr></thead><tbody>" + (
            "".join("<tr>" + "".join("<td>" + shown(value) + "</td>" for value in row) + "</tr>" for row in rows)
            or '<tr><td colspan="' + str(len(headers)) + '">No retained entries.</td></tr>') + "</tbody></table>"
    parts = ['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">',
        "<title>Issued expense attribution</title><style>body{font:15px system-ui,sans-serif;color:#171717;background:#fff;margin:2rem auto;padding:0 1.5rem;max-width:1180px;line-height:1.5}h1,h2,h3{line-height:1.2}table{border-collapse:collapse;width:100%;margin:1rem 0 2rem}th,td{border:1px solid #bbb;text-align:left;vertical-align:top;padding:.55rem;overflow-wrap:anywhere}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{margin:2rem 0}small{color:#555}@media print{body{max-width:none;margin:0}tr{break-inside:avoid}}</style>",
        "<h1>Issued expense attribution</h1><p>" + shown(context["program"]["name"]) + " · version " + shown(view["version"]) + "</p>",
        "<p>Reviewed expense and credit allocations retain the original native amounts, issued source and accepted accountant references. USD comparisons use the recorded valuation and its attached source.</p>",
        "<p>Operational expense USD " + shown(report["operationalExpenseUsd"]) + " · credit USD " +
        shown(report["operationalCreditUsd"]) + " · net USD " + shown(report["operationalNetUsd"]) + "</p>",
        "<h2>Work-package attribution</h2>",
        table(["Work package", "Funding basis", "Expense USD", "Credit USD", "Net USD"],
              [[x["costId"], x["fundingBasis"], x["expenseUsd"], x["creditUsd"], x["netUsd"]] for x in report["packages"]]),
        "<h2>Retained native amounts</h2>",
        table(["Network", "Asset", "Work package", "Funding basis", "Operational", "Expense", "Credit", "Net"],
              [[x[key] for key in ("network", "asset", "costId", "fundingBasis", "operational", "expense", "credit", "net")]
               for x in report["nativeAmounts"]]),
        "<h2>Original sources</h2>",
        table(["Intake", "Original file", "Buyer / close", "Bookkeeping revision", "File SHA256", "Current"],
              [[x["id"], x["filename"], x["source"]["buyer"]["workspaceId"] + " / " + x["source"]["buyer"]["closeId"],
                x["bookkeeping"]["revision"], x["fileSha256"], x["current"]] for x in view["sources"]]),
        "<h2>Review register</h2>",
        table(["Attribution", "State", "Original allocation", "Source references changed", "Recorded review"],
              [[x["id"], x["state"], x["source"]["sourceLineId"], x["bookkeepingChanged"],
                canonical(x.get("review"))] for x in view["attributions"]])]
    for row in view["attributions"]:
        source = row["source"]
        parts += ["<section><h3>" + shown(row["id"]) + "</h3><p>" + shown(source["kind"]) + " · " +
            shown(source["original"]["amount"]) + " native units · " + shown(source["original"]["network"]) + " / " +
            shown(source["original"]["asset"]) + "</p>",
            table(["Line", "Work package", "Funding", "Native amount", "USD value", "Note"],
                  [[part[key] for key in ("line", "costId", "fundingBasis", "nativeAmount", "usdValue", "memo")]
                   for part in row["allocations"]]),
            "<p>Retained remainder: " + shown(row["unattributedReason"]) + "</p>",
            "<h4>Valuation</h4><pre>" + shown(json.dumps(row["valuation"], ensure_ascii=False, indent=2)) + "</pre>",
            "<h4>Original accountant references</h4><pre>" + shown(json.dumps(source["bookkeeping"], ensure_ascii=False, indent=2)) +
            "</pre><small>Issued source " + shown(source["sourceSha256"]) + " · original row " + shown(source["sourceRowSha256"]) + "</small></section>"]
    parts += ["<h2>Review items</h2>", table(["Record", "Item", "Detail"],
        [[x["id"], x["code"], x["message"]] for x in view["reviewItems"]]), "</html>"]
    return "".join(parts).encode("utf-8")
