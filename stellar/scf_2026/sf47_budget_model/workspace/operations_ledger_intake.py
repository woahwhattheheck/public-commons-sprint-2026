"""Complete source-table intake through the original Grant Operations records."""
from __future__ import annotations

import base64
from copy import deepcopy
import csv
from decimal import Decimal
import hashlib
import io
import json
import re

from model import Problem, canonical, digest, text, now
import operations_domain as domain

SCHEMA = "stellar-forge.sf47-ledger-intake.v1"
PREVIEW_SCHEMA = "stellar-forge.sf47-ledger-preview.v1"
RECORDED_SCHEMA = "stellar-forge.sf47-ledger-recorded.v1"
MAX_FILES = 20
MAX_BYTES = 12 * 1024 * 1024
MAX_ROWS = 5000
MAX_RECORDS = 1000
KINDS = ("contributors", "work", "invoices", "cash")
ACTIONS = {"contributors": "contributor.save", "work": "work.save",
           "invoices": "invoice.save", "cash": "cash.record"}
COMMON = ("key", "id", "sourceIds", "sourceNote")
FIELDS = {
    "contributors": ("name", "kind", "contact", "note"),
    "work": ("contributorId", "costId", "description", "startDate", "endDate", "hours", "fundingBasis"),
    "invoices": ("contributorId", "number", "issuedDate", "dueDate", "lines",
                 "line.id", "line.costId", "line.description", "line.amountUsd", "line.workIds"),
    "cash": ("direction", "category", "date", "currency", "network", "asset", "amount",
             "usdValue", "valuationSourceIds", "valuationNote", "externalRef", "tranche",
             "allocations", "allocation.invoiceId", "allocation.amountUsd"),
}
ARRAY_FIELDS = {"sourceIds", "valuationSourceIds", "lines", "allocations", "line.workIds"}
TEMPLATE_FIELDS = {
    "contributors": ("key", "name", "kind", "contact", "note"),
    "work": ("key", "contributorId", "costId", "description", "startDate", "endDate", "hours", "fundingBasis"),
    "invoices": ("key", "contributorId", "number", "issuedDate", "dueDate", "line.id",
                 "line.costId", "line.description", "line.amountUsd", "line.workIds"),
    "cash": ("key", "direction", "category", "date", "currency", "amount", "usdValue",
             "externalRef", "allocation.invoiceId", "allocation.amountUsd", "sourceNote"),
}
RECIPE_PREFIX = "ledger-intake-"


def _key(value, label):
    value = text(value, label, 100, True)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}", value):
        domain.fail(label + ": use letters, digits, dot, underscore, colon or dash.", "INVALID_LEDGER_INTAKE")
    return value


def _object(value, label):
    if not isinstance(value, dict):
        domain.fail(label + " must be an object.", "INVALID_LEDGER_INTAKE")
    return value


def _only(value, keys, label):
    _object(value, label)
    extra = set(value) - set(keys)
    if extra:
        domain.fail(label + " has unsupported fields: " + ", ".join(sorted(extra)) + ".", "INVALID_LEDGER_INTAKE")


def _json(raw, decimal_strings=True):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                domain.fail("JSON repeats field " + key + ".", "INVALID_LEDGER_INTAKE")
            result[key] = value
        return result

    def invalid(value):
        domain.fail("JSON contains a non-finite number.", "INVALID_LEDGER_INTAKE")

    try:
        return json.loads(raw, object_pairs_hook=pairs,
                          parse_float=(lambda value: format(Decimal(value), "f")) if decimal_strings else float,
                          parse_constant=invalid)
    except (ValueError, UnicodeError) as exc:
        if isinstance(exc, Problem):
            raise
        raise Problem("Use complete readable UTF-8 JSON.", 422, "INVALID_LEDGER_INTAKE") from exc


def _field(value, name):
    if name in ARRAY_FIELDS:
        if value in ("", None):
            return []
        if isinstance(value, str):
            value = _json(value)
        if not isinstance(value, list):
            domain.fail(name + " needs a JSON array.", "INVALID_LEDGER_INTAKE")
    if name == "tranche" and value not in ("", None):
        if isinstance(value, str) and re.fullmatch(r"[0-3]", value):
            value = int(value)
    return value


def _file(spec):
    from operations import decoded
    _only(spec, ("id", "filename", "kind", "format", "contentBase64", "mapping", "defaults",
                 "sourceUrl", "observedAt", "mediaType"), "Source file")
    identity = _key(spec.get("id"), "File key")
    kind = domain.enum(spec.get("kind"), (*KINDS, "source"), "Intake table")
    format_name = domain.enum(spec.get("format"), ("csv", "tsv", "json", "binary"), "File format")
    if kind != "source" and format_name == "binary":
        domain.fail("Choose CSV, TSV or JSON for a record table.", "INVALID_LEDGER_INTAKE")
    raw = decoded(spec.get("contentBase64"))
    filename = text(spec.get("filename"), "Original filename", 240, True)
    if "/" in filename or "\\" in filename or filename in (".", "..") or any(ord(char) < 32 for char in filename):
        domain.fail("Use the original plain filename.", "INVALID_LEDGER_INTAKE")
    media = text(spec.get("mediaType") or {"csv": "text/csv", "tsv": "text/tab-separated-values",
        "json": "application/json", "binary": "application/octet-stream"}[format_name], "Source media type", 200, True)
    if not re.fullmatch(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+", media):
        domain.fail("Use a plain MIME media type.", "INVALID_LEDGER_INTAKE")
    mapping = _object(spec.get("mapping", {}), "Column mapping")
    defaults = _object(spec.get("defaults", {}), "Table defaults")
    allowed = (*COMMON, *FIELDS.get(kind, ()))
    _only(mapping, allowed if kind != "source" else (), "Column mapping")
    _only(defaults, allowed if kind != "source" else (), "Table defaults")
    if "key" in defaults or "id" in defaults:
        domain.fail("Set each row key and existing record ID in its original table.", "INVALID_LEDGER_INTAKE")
    for field, header in mapping.items():
        if header is not None:
            text(header, "Mapped column", 300, True)
    metadata = {"id": identity, "filename": filename, "kind": kind, "format": format_name,
        "mediaType": media, "sourceUrl": domain.url(spec.get("sourceUrl", ""), "Original source URL"),
        "observedAt": domain.timestamp(spec.get("observedAt"), "Source observation", True),
        "mapping": deepcopy(mapping), "defaults": deepcopy(defaults),
        "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    headers, rows = [], []
    if kind == "source":
        return {"metadata": metadata, "raw": raw, "headers": headers, "rows": rows}
    if format_name == "json":
        if mapping:
            domain.fail("JSON records use native field names; remove the CSV column mapping.", "INVALID_LEDGER_INTAKE")
        data = _json(raw)
        if isinstance(data, dict) and set(data) == {"records"}:
            data = data["records"]
        if not isinstance(data, list) or not data:
            domain.fail("Use a nonempty JSON array of native records.", "INVALID_LEDGER_INTAKE")
        if len(data) > MAX_ROWS:
            domain.fail("An intake supports at most 5,000 original table rows.", "LEDGER_INTAKE_LIMIT", 413)
        for index, row in enumerate(data, 1):
            _only(row, allowed, "JSON record " + str(index))
            rows.append((index, {**deepcopy(defaults), **deepcopy(row)}))
        headers = list(dict.fromkeys(key for _, row in rows for key in row))
    else:
        try:
            stream = io.StringIO(raw.decode("utf-8-sig"), newline="")
            reader = csv.reader(stream, delimiter="\t" if format_name == "tsv" else ",", strict=True)
            headers = next(reader)
            if (not headers or len(headers) > 200 or any(not h or len(h) > 300 or "\x00" in h for h in headers)
                    or len(headers) != len(set(headers))):
                domain.fail("Use one through 200 distinct nonempty CSV column headers.", "INVALID_LEDGER_INTAKE")
            selected = {field: mapping[field] if field in mapping else field
                        for field in allowed if (field in mapping and mapping[field] is not None)
                        or (field not in mapping and field in headers)}
            missing = set(selected.values()) - set(headers)
            if missing:
                domain.fail("Mapped columns are absent: " + ", ".join(sorted(missing)) + ".", "INVALID_LEDGER_INTAKE")
            for row_index, cells in enumerate(reader, 2):
                if not cells or all(cell == "" for cell in cells):
                    continue
                if len(cells) != len(headers):
                    domain.fail("Original row " + str(row_index) + " has a different number of columns.", "INVALID_LEDGER_INTAKE")
                values = dict(zip(headers, cells))
                row = deepcopy(defaults)
                for field, header in selected.items():
                    if values[header] != "":
                        row[field] = _field(values[header], field)
                rows.append((row_index, row))
                if len(rows) > MAX_ROWS:
                    domain.fail("An intake supports at most 5,000 original table rows.", "LEDGER_INTAKE_LIMIT", 413)
            if not rows:
                domain.fail("The source table has headers but no records.", "INVALID_LEDGER_INTAKE")
        except (UnicodeError, csv.Error, StopIteration) as exc:
            raise Problem("Use a complete UTF-8 table with a valid header and quoted fields.",
                          422, "INVALID_LEDGER_INTAKE") from exc
    return {"metadata": metadata, "raw": raw, "headers": headers, "rows": rows}


def inspect(spec):
    item = _file(spec)
    metadata = item["metadata"]
    used = set(metadata["mapping"].values()) | {field for field in (*COMMON, *FIELDS.get(metadata["kind"], ()))
                                                if field not in metadata["mapping"]}
    return {**metadata, "headers": item["headers"], "rowCount": len(item["rows"]),
            "unmappedColumns": [name for name in item["headers"] if name not in used],
            "sample": [{"row": index, "data": row} for index, row in item["rows"][:5]]}


def _entries(item):
    metadata, grouped, result = item["metadata"], {}, []
    for row_index, original in item["rows"]:
        row = {key: _field(deepcopy(value), key) for key, value in original.items()}
        key = _key(row.pop("key", None) or metadata["id"] + ":" + str(row_index), "Row key")
        mode = "line" if any(key.startswith("line.") for key in row) else (
            "allocation" if any(key.startswith("allocation.") for key in row) else None)
        nested = {}
        if mode:
            expected_kind, target = ("invoices", "lines") if mode == "line" else ("cash", "allocations")
            if metadata["kind"] != expected_kind or target in row:
                domain.fail("Use either native arrays or grouped " + mode + " columns.", "INVALID_LEDGER_INTAKE")
            nested = {name[len(mode) + 1:]: row.pop(name) for name in list(row) if name.startswith(mode + ".")}
            if mode == "line":
                nested.setdefault("id", "line-" + str(row_index))
            if key in grouped:
                existing = grouped[key]
                if existing["mode"] != mode or canonical(existing["header"]) != canonical(row):
                    domain.fail("Repeated key " + key + " changes its invoice or cash header.", "INVALID_LEDGER_INTAKE")
                existing["data"][target].append(nested)
                existing["rows"].append(row_index)
                continue
            data = {**row, target: [nested]}
        else:
            data = row
            if key in grouped:
                domain.fail("Repeated row key " + key + " needs explicit line/allocation columns.", "INVALID_LEDGER_INTAKE")
        entry = {"key": key, "kind": metadata["kind"], "fileId": metadata["id"],
                 "rows": [row_index], "data": data, "mode": mode, "header": row}
        grouped[key] = entry
        result.append(entry)
    return result


def _resolve(value, available, label):
    if not isinstance(value, str) or not value.startswith("@"):
        return value
    if value not in available:
        domain.fail(label + ": unknown or invalid earlier row/file reference " + value + ".", "LEDGER_REFERENCE")
    return available[value]


def _data(entry, record_refs, file_refs, title):
    data = deepcopy(entry["data"])
    if "contributorId" in data:
        data["contributorId"] = _resolve(data["contributorId"], record_refs, "Contributor")
    for line in data.get("lines", []):
        if isinstance(line, dict) and "workIds" in line and isinstance(line["workIds"], list):
            line["workIds"] = [_resolve(value, record_refs, "Invoice work") for value in line["workIds"]]
    for allocation in data.get("allocations", []):
        if isinstance(allocation, dict) and "invoiceId" in allocation:
            allocation["invoiceId"] = _resolve(allocation["invoiceId"], record_refs, "Invoice allocation")
    for field in ("sourceIds", "valuationSourceIds"):
        if field in data:
            if not isinstance(data[field], list):
                domain.fail(field + " needs a JSON array.", "INVALID_LEDGER_INTAKE")
            data[field] = [_resolve(value, file_refs, "Original source") for value in data[field]]
    source_id = file_refs["@file:" + entry["fileId"]]
    ids = data.setdefault("sourceIds", [])
    if source_id not in ids:
        ids.append(source_id)
    note = text(data.get("sourceNote", ""), "Original source reference", 12000)
    location = "Ledger intake " + title + "; file " + entry["fileId"] + "; original rows " + ", ".join(map(str, entry["rows"])) + "."
    data["sourceNote"] = note + ("\n" if note else "") + location
    return data


def _replace_refs(value, aliases):
    if isinstance(value, str):
        return aliases.get(value, value)
    if isinstance(value, list):
        return [_replace_refs(item, aliases) for item in value]
    if isinstance(value, dict):
        return {key: _replace_refs(item, aliases) for key, item in value.items()}
    return value


def _source_packet(ops, program_id, source_id):
    row = ops.db.execute("SELECT metadata_json,content FROM ops_sources WHERE program_id=? AND id=?",
                         (program_id, source_id)).fetchone()
    if not row:
        domain.fail("Select a retained ledger intake.", "LEDGER_INTAKE_NOT_FOUND", 404)
    metadata = json.loads(row[0])
    value = _json(bytes(row[1]), decimal_strings=False)
    if not isinstance(value, dict) or value.get("schema") != RECORDED_SCHEMA:
        domain.fail("Select the original recorded ledger-intake document.", "INVALID_LEDGER_INTAKE")
    required = {"title": str, "recordedAt": str, "actor": str, "documentSha256": str,
                "caseId": str, "fromVersion": int, "version": int, "summary": dict,
                "requestId": str, "files": list, "records": list, "document": dict}
    if any(not isinstance(value.get(key), expected) for key, expected in required.items()):
        domain.fail("The recorded ledger-intake document is incomplete.", "INVALID_LEDGER_INTAKE")
    return metadata, value


def history(ops, program_id):
    result = []
    for source_id, raw in ops.db.execute("SELECT id,metadata_json FROM ops_sources WHERE program_id=? ORDER BY rowid DESC", (program_id,)):
        metadata = json.loads(raw)
        if not metadata["filename"].startswith(RECIPE_PREFIX) or metadata["mediaType"] != "application/json":
            continue
        try:
            _, packet = _source_packet(ops, program_id, source_id)
        except Problem:
            continue
        result.append({"sourceId": source_id, "title": packet["title"], "recordedAt": packet["recordedAt"],
            "actor": packet["actor"], "documentSha256": packet["documentSha256"],
            "originalCaseId": packet["caseId"], "fromVersion": packet["fromVersion"], "version": packet["version"],
            "summary": packet["summary"], "requestId": packet["requestId"]})
    return result


def prepare(ops, program_id, body):
    from operations import MAX_RECORDS as CASE_RECORDS, MAX_SOURCES_TOTAL, identifier
    _object(body, "Intake request")
    document = _object(body.get("document"), "Intake document")
    _only(document, ("schema", "title", "files"), "Intake document")
    if document.get("schema") != SCHEMA:
        domain.fail("Open a complete ledger-intake document.", "INVALID_LEDGER_INTAKE")
    title = text(document.get("title"), "Intake title", 300, True)
    specs = document.get("files")
    if not isinstance(specs, list) or not 1 <= len(specs) <= MAX_FILES:
        domain.fail("An intake needs one through 20 source files.", "LEDGER_INTAKE_LIMIT", 413)
    context = deepcopy(ops._context(program_id))
    program = context["program"]
    expected = body.get("expectedVersion")
    if expected is not None and domain.integer(expected, "Reviewed case version", 1, 10000000) != program["version"]:
        domain.fail("The case changed. Refresh and review the complete intake again.", "OPERATIONS_CONFLICT", 409)
    problems, files, entries, used_files, used_keys = [], [], [], set(), set()
    for index, spec in enumerate(specs, 1):
        try:
            item = _file(spec)
            identity = item["metadata"]["id"]
            if identity in used_files:
                domain.fail("File keys must be distinct.", "INVALID_LEDGER_INTAKE")
            used_files.add(identity)
            files.append(item)
            for entry in _entries(item):
                if entry["key"] in used_keys:
                    domain.fail("Row key " + entry["key"] + " is used by more than one file.", "LEDGER_REFERENCE")
                used_keys.add(entry["key"])
                entries.append(entry)
        except Problem as exc:
            problems.append({"file": index, "fileId": spec.get("id") if isinstance(spec, dict) else None,
                             "code": exc.code, "message": str(exc)})
    total_bytes = sum(item["metadata"]["bytes"] for item in files)
    if total_bytes > MAX_BYTES or sum(len(item["rows"]) for item in files) > MAX_ROWS or len(entries) > MAX_RECORDS:
        problems.append({"code": "LEDGER_INTAKE_LIMIT", "message": "Use at most 12 MiB, 5,000 source rows and 1,000 native records in one intake."})
    if program["state"] != "OPEN":
        problems.append({"code": "OPERATIONS_CLOSED", "message": "Reopen the original case before applying a ledger intake."})
    file_refs, aliases = {}, {}
    for item in files:
        meta = item["metadata"]
        placeholder = "source-" + digest(["ledger-preview", meta["id"], meta["sha256"]])[:32]
        file_refs["@file:" + meta["id"]] = placeholder
        aliases[placeholder] = "@file:" + meta["id"]
        context["sources"][placeholder] = {**meta, "id": placeholder}
    ordered = sorted(entries, key=lambda row: KINDS.index(row["kind"]))
    record_refs, targets, rows = {}, set(), []
    counts = {kind: {"create": 0, "replace": 0} for kind in KINDS}
    for entry in ordered[:MAX_RECORDS]:
        try:
            data = _data(entry, record_refs, file_refs, title)
            kind = entry["kind"]
            target = data.get("id")
            before = None
            if target:
                target = identifier(target, domain.PREFIX[kind])
                before = next((row for row in context["records"][kind] if row["id"] == target), None)
                if before is None:
                    domain.fail("An explicit id must name an existing original record; omit it to create one.", "LEDGER_RECORD_NOT_FOUND")
                if target in targets:
                    domain.fail("One intake can replace each retained record once.", "LEDGER_RECORD_REPEATED")
                targets.add(target)
            values = domain.prepare(kind, data, context, before)
            identity = target or domain.PREFIX[kind] + "-" + digest(["ledger-preview", entry["key"]])[:32]
            if not target and any(row["id"] == identity for row in context["records"][kind]):
                domain.fail("The temporary row reference collides with an existing record.", "LEDGER_REFERENCE")
            record_refs["@" + entry["key"]] = identity
            if not target:
                aliases[identity] = "@" + entry["key"]
            retained = {**values, "id": identity}
            if before:
                context["records"][kind] = [retained if row["id"] == identity else row for row in context["records"][kind]]
            else:
                context["records"][kind].append(retained)
            mode = "replace" if before else "create"
            counts[kind][mode] += 1
            rows.append({"key": entry["key"], "kind": kind, "action": ACTIONS[kind], "mode": mode,
                "recordId": target, "fileId": entry["fileId"], "rows": entry["rows"],
                "before": before, "after": _replace_refs(values, aliases)})
        except Problem as exc:
            problems.append({"key": entry["key"], "fileId": entry["fileId"], "rows": entry["rows"],
                             "code": exc.code, "message": str(exc)})
    if not ordered:
        problems.append({"code": "EMPTY_LEDGER_INTAKE", "message": "Include at least one contributor, work, invoice or cash record table."})
    creates = sum(item["create"] for item in counts.values())
    source_bytes, source_count = ops.db.execute("SELECT COALESCE(SUM(length(content)),0),COUNT(*) FROM ops_sources WHERE program_id=?", (program_id,)).fetchone()
    if sum(len(values) for values in ops._context(program_id)["records"].values()) + creates > CASE_RECORDS:
        problems.append({"code": "LEDGER_INTAKE_LIMIT", "message": "The resulting case would exceed its original 5,000-record limit."})
    descriptor = {
        "files": [{**item["metadata"], "sourceId": "source-" + "0" * 32} for item in files],
        "records": [{"key": entry["key"], "kind": entry["kind"], "fileId": entry["fileId"],
                     "rows": entry["rows"], "recordId": domain.PREFIX[entry["kind"]] + "-" + "0" * 32,
                     "version": 10000000, "mode": "replace"} for entry in ordered],
        "document": {**deepcopy(document), "files": [
            {key: value for key, value in spec.items() if key != "contentBase64"}
            if isinstance(spec, dict) else spec for spec in specs]}}
    descriptor_bytes = len(canonical(descriptor).encode()) + 65536
    if source_count + len(files) + 1 > 200 or source_bytes + total_bytes + descriptor_bytes > MAX_SOURCES_TOTAL or descriptor_bytes > 8 * 1024 * 1024:
        problems.append({"code": "LEDGER_INTAKE_LIMIT", "message": "The complete sources and intake document must fit the case's original 200-file / 24 MiB source capacity."})
    if program["version"] + len(files) + len(ordered) + 1 > 10000000:
        problems.append({"code": "LEDGER_INTAKE_LIMIT", "message": "This intake exceeds the original case-version range."})
    file_views = []
    for item in files:
        meta = item["metadata"]
        used = set(meta["mapping"].values()) | {field for field in (*COMMON, *FIELDS.get(meta["kind"], ()))
                                             if field not in meta["mapping"]}
        file_views.append({**meta, "headers": item["headers"], "rowCount": len(item["rows"]),
            "unmappedColumns": [name for name in item["headers"] if name not in used]})
    fingerprint_document = deepcopy(document)
    canonical_files = {item["metadata"]["id"]: base64.b64encode(item["raw"]).decode() for item in files}
    for spec in fingerprint_document["files"]:
        if isinstance(spec, dict) and spec.get("id") in canonical_files:
            spec["contentBase64"] = canonical_files[spec["id"]]
    document_sha = digest(fingerprint_document)
    prior = next((item for item in history(ops, program_id) if item["documentSha256"] == document_sha), None)
    summary = {"records": len(rows), "created": creates, "replaced": sum(item["replace"] for item in counts.values()),
               "files": len(files), "sourceBytes": total_bytes, "byKind": counts}
    preview = {"schema": PREVIEW_SCHEMA, "title": title,
        "case": {"id": program_id, "version": program["version"], "name": program["name"], "state": program["state"], "mode": program["mode"]},
        "documentSha256": document_sha, "canApply": not problems and prior is None,
        "files": file_views, "records": rows, "errors": problems, "summary": summary, "alreadyRecorded": prior}
    preview["previewSha256"] = digest(preview)
    return preview, files, ordered


def preview(ops, program_id, body):
    with ops._snapshot():
        return prepare(ops, program_id, body)[0]


def apply(ops, program_id, body):
    from operations import identifier
    program_id = identifier(program_id, "operation")
    _object(body, "Ledger intake command")
    expected = domain.integer(body.get("expectedVersion"), "Reviewed case version", 1, 10000000)
    reviewed = domain.sha(body.get("expectedPreviewSha256"), "Reviewed complete intake", False)
    actor = text(body.get("actor"), "Recording operator", 300, True)
    note = text(body.get("note", ""), "Intake note", 12000)
    payload = {"domain": SCHEMA, "caseId": program_id, "body": body}

    def action():
        selected, files, entries = prepare(ops, program_id, body)
        if selected["alreadyRecorded"] is not None:
            domain.fail("This exact complete input is already retained. Open its original intake from the case.", "LEDGER_ALREADY_RECORDED", 409)
        if selected["errors"]:
            domain.fail("Correct the complete intake before applying it: " + "; ".join(row["message"] for row in selected["errors"][:5]),
                        "INVALID_LEDGER_INTAKE")
        if selected["previewSha256"] != reviewed:
            domain.fail("The files, mapping or case differ from the reviewed intake. Review the full input again.",
                        "LEDGER_PREVIEW_CONFLICT", 409)
        version, file_refs, record_refs, file_results, record_results = expected, {}, {}, [], []

        def command(name, data):
            nonlocal version
            result = ops.command(program_id, {"action": name, "data": data, "expectedVersion": version,
                "actor": actor, "note": note, "requestId": body["requestId"]}, _within_transaction=True)
            version = result["version"]
            return result

        for item in files:
            meta = item["metadata"]
            result = command("source.add", {"filename": meta["filename"], "mediaType": meta["mediaType"],
                "contentBase64": base64.b64encode(item["raw"]).decode(), "sourceUrl": meta["sourceUrl"],
                "observedAt": meta["observedAt"], "kind": {"work": "work", "invoices": "invoice", "cash": "payment"}.get(meta["kind"], "other")})
            file_refs["@file:" + meta["id"]] = result["recordId"]
            file_results.append({**meta, "sourceId": result["recordId"]})
        for entry in entries:
            data = _data(entry, record_refs, file_refs, selected["title"])
            result = command(ACTIONS[entry["kind"]], data)
            record_refs["@" + entry["key"]] = result["recordId"]
            record_results.append({"key": entry["key"], "kind": entry["kind"], "fileId": entry["fileId"],
                "rows": entry["rows"], "recordId": result["recordId"], "version": result["version"],
                "mode": "replace" if entry["data"].get("id") else "create"})
        packet = {"schema": RECORDED_SCHEMA, "title": selected["title"], "recordedAt": now(),
            "actor": actor, "note": note, "requestId": body["requestId"], "caseId": program_id,
            "fromVersion": expected, "version": version + 1, "documentSha256": selected["documentSha256"],
            "previewSha256": reviewed, "summary": selected["summary"], "files": file_results,
            "records": record_results,
            "document": {**deepcopy(body["document"]), "files": [
                {key: value for key, value in spec.items() if key != "contentBase64"} for spec in body["document"]["files"]]}}
        raw = (canonical(packet) + "\n").encode()
        source = command("source.add", {"filename": RECIPE_PREFIX + selected["documentSha256"][:24] + ".json",
            "mediaType": "application/json", "kind": "other", "contentBase64": base64.b64encode(raw).decode(),
            "observedAt": packet["recordedAt"]})
        return {"id": program_id, "version": version, "action": "ledger.intake", "requestId": body["requestId"],
            "documentSha256": selected["documentSha256"], "sourceId": source["recordId"],
            "summary": selected["summary"], "files": file_results, "records": record_results}
    return ops.workspace._transaction(body.get("requestId"), payload, action)


def original(ops, program_id, source_id):
    with ops._snapshot():
        ops._program(program_id)
        metadata, packet = _source_packet(ops, program_id, source_id)
        document = deepcopy(packet["document"])
        refs = {row["id"]: row for row in packet["files"]}
        for spec in document["files"]:
            source = refs[spec["id"]]
            found = ops.db.execute("SELECT content FROM ops_sources WHERE program_id=? AND id=?",
                                   (program_id, source["sourceId"])).fetchone()
            if not found or hashlib.sha256(bytes(found[0])).hexdigest() != source["sha256"] or len(found[0]) != source["bytes"]:
                domain.fail("The original intake source file is incomplete.", "LEDGER_SOURCE_CHANGED", 409)
            spec["contentBase64"] = base64.b64encode(bytes(found[0])).decode()
        if digest(document) != packet["documentSha256"]:
            domain.fail("The complete original intake differs from its recorded input.", "LEDGER_SOURCE_CHANGED", 409)
        return {"source": metadata, "recorded": packet, "document": document}


def template(kind, format_name="csv"):
    kind = domain.enum(kind, KINDS, "Intake table")
    format_name = domain.enum(format_name, ("csv", "tsv"), "Template format")
    stream = io.StringIO(newline="")
    csv.writer(stream, delimiter="\t" if format_name == "tsv" else ",", lineterminator="\n").writerow(TEMPLATE_FIELDS[kind])
    return stream.getvalue()


def describe(ops, program_id):
    with ops._snapshot():
        context = ops._context(program_id)
        templates = {kind: {format_name: template(kind, format_name) for format_name in ("csv", "tsv")} for kind in KINDS}
        return {"schema": SCHEMA, "case": {key: context["program"][key] for key in ("id", "name", "version", "state", "mode")},
            "limits": {"files": MAX_FILES, "sourceBytes": MAX_BYTES, "sourceRows": MAX_ROWS, "records": MAX_RECORDS},
            "fields": {kind: list((*COMMON, *fields)) for kind, fields in FIELDS.items()},
            "templates": templates, "intakes": history(ops, program_id)}
