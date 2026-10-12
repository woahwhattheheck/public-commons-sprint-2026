"""Pure reporting and exact-source packet export for Berkeley cashiering.

The financial engine supplies all amounts, differences, states and decisions.
This module formats those projections and packages supplied bytes; it performs
no reconciliation, financial arithmetic, filesystem access or provider action.
"""
from __future__ import annotations

import csv
import hashlib
import html
import io
import json
import re
import unicodedata
import zipfile
from collections.abc import Mapping
from pathlib import PurePosixPath

SCHEMA = "berkeley.cashiering.run.v1"
PACKET_SCHEMA = "berkeley.cashiering.packet.v1"
NARRATIVE_LIMIT = 120
LANES = ("permits", "receivables", "processor", "cashier")


def _json(value, *, indent=2):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=indent,
                      allow_nan=False)


def _array(value):
    return value if isinstance(value, list) else []


def _object(value):
    return value if isinstance(value, dict) else {}


def _text(value):
    if value is None:
        return "Not supplied"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (dict, list)):
        return _json(value, indent=None)
    return str(value)


def _esc(value):
    return html.escape(_text(value), quote=True)


def _name(value):
    return str(value).replace("_", " ").strip().capitalize()


def _scales(detail):
    return _object(_object(_object(detail.get("run")).get("settings")).get("scales"))


def _minor(value, currency, scales):
    """Format an integer string without converting it to a binary number."""
    if value is None:
        return "Not supplied"
    original = str(value)
    if isinstance(value, bool) or not re.fullmatch(r"-?[0-9]+", original):
        return original + " [unformatted minor-unit value]"
    scale = scales.get(str(currency))
    if isinstance(scale, bool) or not isinstance(scale, int) or not 0 <= scale <= 30:
        return original + " minor units [scale not supplied]"
    negative = original.startswith("-")
    digits = original[1:] if negative else original
    digits = digits.lstrip("0") or "0"
    if scale:
        digits = digits.rjust(scale + 1, "0")
        major, fraction = digits[:-scale], digits[-scale:]
    else:
        major, fraction = digits, ""
    grouped = re.sub(r"\B(?=(\d{3})+(?!\d))", ",", major)
    return ("-" if negative else "") + grouped + ("." + fraction if scale else "")


def _validate_detail(detail):
    if not isinstance(detail, dict) or detail.get("schema") != SCHEMA:
        raise ValueError("Reporting requires the native " + SCHEMA + " detail.")
    if not isinstance(detail.get("run"), dict):
        raise ValueError("The native run object is required.")
    # This checks representability, not any financial or operational condition.
    _json(detail)
    return detail


def _row_source(row):
    original = _object(row.get("original"))
    capture = original.get("capture_id")
    line = original.get("line")
    if capture is None and line is None:
        return "Not supplied"
    return str(capture or "Unspecified capture") + (
        " · record " + str(line) if line is not None else "")


def _table(headers, rows, *, empty="No recorded entries.", limit=NARRATIVE_LIMIT,
           full_file=None):
    items = list(rows)
    if not items:
        return '<p class="empty">' + _esc(empty) + "</p>"
    selected = items if limit is None else items[:limit]
    head = "".join("<th scope=\"col\">" + _esc(h) + "</th>" for h in headers)
    body = "".join("<tr>" + "".join("<td>" + _esc(c).replace("\n", "<br>") + "</td>"
                                    for c in row) + "</tr>" for row in selected)
    notice = ""
    if len(selected) != len(items):
        notice = ('<p class="note">Showing the first ' + str(len(selected)) +
                  " of " + str(len(items)) + " entries. Complete entries are in " +
                  _esc(full_file or "run.json") + ".</p>")
    return ('<div class="table-wrap"><table><thead><tr>' + head +
            "</tr></thead><tbody>" + body + "</tbody></table></div>" + notice)


def _record(record, title="Full recorded details"):
    if record is None:
        return '<p class="empty">Not recorded.</p>'
    return "<details><summary>" + _esc(title) + "</summary><pre>" + html.escape(
        _json(record)) + "</pre></details>"


def _brief_records(records, title, selected):
    sections = []
    for row in _array(records)[:NARRATIVE_LIMIT]:
        if not isinstance(row, dict):
            sections.append(_record(row, title))
            continue
        key = row.get("title") or row.get("label") or row.get("id") or title
        facts = [[_name(k), row[k]] for k in selected if k in row]
        if facts:
            sections.append('<article class="record"><h3>' + _esc(key) + "</h3>" +
                            _table(["Field", "Recorded value"], facts, limit=None) +
                            _record(row) + "</article>")
        else:
            sections.append(_record(row, str(key)))
    total = len(_array(records))
    if total > NARRATIVE_LIMIT:
        sections.append('<p class="note">Additional complete records are included in run.json.</p>')
    return "".join(sections) or '<p class="empty">No recorded entries.</p>'


def _scope_section(detail):
    manifest = _array(detail.get("manifest"))
    rows = []
    for entry in manifest:
        if not isinstance(entry, dict):
            rows.append(["Unspecified", "", "", entry])
            continue
        rows.append([
            entry.get("kind", entry.get("lane", entry.get("side"))),
            entry.get("id", entry.get("capture_id")),
            entry.get("filename", entry.get("name")),
            entry.get("coverage", entry.get("scope", entry.get("reporting_period")))
        ])
    return (_table(["Source lane", "Capture", "Original file", "Declared coverage"],
                   rows, empty="No source-manifest entries were supplied.",
                   full_file="source-manifest.json") +
            _record(detail.get("manifest"), "Exact source manifest and selected mappings"))


def render_report(detail: dict) -> str:
    """Return a standalone grayscale report of a complete native run detail."""
    _validate_detail(detail)
    run = detail["run"]
    scales = _scales(detail)
    currency = lambda row: row.get("currency")
    amount = lambda row, key: _minor(row.get(key), currency(row), scales)
    title = run.get("label") or run.get("id") or "Daily financial reconciliation"
    parts = [
        '<header><p class="eyebrow">Berkeley / Clariti · Financial operations</p>',
        "<h1>" + _esc(title) + "</h1>",
        '<p class="subtitle">Daily cashiering and receivables reconciliation</p>',
        '<p class="state">State captured in this report: <strong>' +
        _esc(run.get("status")) + "</strong></p></header>",
        _table(["Run", "Accounting period", "Created", "Source revision", "Edit revision"], [[
            run.get("id"), _text(run.get("start_date")) + " to " + _text(run.get("end_date")),
            run.get("created_at"), run.get("source_revision"), run.get("edit_revision")
        ]], limit=None),
        '<p class="note">Prepared output, transmission and actual receiving or posting observations '
        'are recorded separately. “Not supplied” denotes an absent observation, not a zero amount.</p>',
        '<section><h2>1. Financial position by currency</h2>',
        _table(["Currency", "Permit system", "Receivables", "Processor", "Cashier",
                "Allocated", "Permit remainder", "Receivables remainder"], [
            [r.get("currency")] + [amount(r, key) for key in (
                "permit_minor", "receivables_minor", "processor_minor", "cashier_minor",
                "allocated_minor", "permit_remaining_minor", "receivables_remaining_minor")]
            for r in _array(detail.get("totals")) if isinstance(r, dict)
        ], empty="No native totals were supplied.", limit=None),
        _record(detail.get("counts"), "Recorded population and coverage counts"),
        "</section>",
        '<section><h2>2. Original sources and selected population</h2>',
        _scope_section(detail),
        _record(run.get("settings"), "Selected scope, mappings and currency scales"),
        "</section>",
        '<section><h2>3. Daily balancing</h2>',
        _table(["Business date", "Session", "Tender", "Currency", "Expected",
                "Cashier observed", "Cashier difference", "Processor observed",
                "Processor difference"], [
            [r.get("business_date"), r.get("session_id"), r.get("payment_type"),
             r.get("currency")] + [amount(r, key) for key in (
                 "expected_minor", "cashier_minor", "cashier_difference_minor",
                 "processor_minor", "processor_difference_minor")]
            for r in _array(detail.get("balances")) if isinstance(r, dict)
        ], full_file="balances.csv"),
        '<p class="note">Expected values and observed cashier or processor amounts are separate '
        'columns. Differences use the selected native calculation and source coverage.</p>',
        "</section>",
        '<section><h2>4. Findings and current review</h2>',
        _table(["Finding", "Severity", "Issue", "Waivable", "Review", "Owner", "Reason"], [
            [r.get("id"), r.get("severity"), _text(r.get("code")) + ": " + _text(r.get("message")),
             r.get("waivable"), _object(r.get("review")).get("status"),
             _object(r.get("review")).get("owner"), _object(r.get("review")).get("note")]
            for r in _array(detail.get("findings")) if isinstance(r, dict)
        ], empty="No findings are recorded in the supplied detail. Source coverage is reported separately.",
           full_file="findings.csv"),
        '<p class="note">An explained difference is a recorded review decision. It does not create '
        'a missing payment, refund or external system result.</p>',
        "</section>",
        '<section><h2>5. Transaction groups and allocation</h2>',
        _table(["Group", "Lane / kind", "Transaction", "Currency", "Net", "Allocated",
                "Remaining", "Permit / invoice / fee references"], [
            [r.get("id"), r.get("kind"), r.get("transaction_id"), r.get("currency"),
             amount(r, "net_minor"), amount(r, "allocated_minor"), amount(r, "remaining_minor"),
             {"permits": r.get("permit_ids"), "invoices": r.get("invoice_ids"),
              "fees": r.get("fee_codes")}]
            for r in _array(detail.get("groups")) if isinstance(r, dict)
        ], full_file="groups.csv"),
        _table(["Allocation", "Source group", "Receiving group", "Currency", "Amount",
                "Active", "Owner", "Reason", "Recorded"], [
            [r.get("id"), r.get("source_group_id"), r.get("target_group_id"), r.get("currency"),
             amount(r, "amount_minor"), r.get("active"), r.get("owner"), r.get("note"),
             r.get("created_at")]
            for r in _array(detail.get("allocations")) if isinstance(r, dict)
        ], full_file="allocations.csv"),
        "</section>",
        '<section><h2>6. Payment and correction observations</h2>'
    ]
    native_rows = _object(detail.get("rows"))
    for lane in LANES:
        rows = [r for r in _array(native_rows.get(lane)) if isinstance(r, dict)]
        parts += ["<h3>" + _esc(_name(lane)) + "</h3>",
                  _table(["Transaction", "Business date", "Event / status", "Currency",
                          "Amount", "Requested", "Paid", "Net", "Related transaction",
                          "Denial reason", "Original record"], [
                      [r.get("transaction_id"), r.get("business_date"),
                       _text(r.get("event")) + " / " + _text(r.get("status")), r.get("currency"),
                       amount(r, "amount_minor"), amount(r, "requested_minor"),
                       amount(r, "paid_minor"), amount(r, "net_minor"),
                       r.get("related_transaction_id"), r.get("denial_reason"), _row_source(r)]
                      for r in rows
                  ], empty="No selected " + lane + " rows.", full_file="transactions.csv")]
    parts += [
        "<h3>Recorded corrections</h3>",
        _brief_records(detail.get("corrections"), "Correction", [
            "id", "kind", "status", "record_key", "transaction_id",
            "owner", "note", "created_at", "source_revision", "edit_revision"]),
        '<p class="note">Full original row values, interpreted fields and correction events are '
        'included in the data files. A proposed correction remains distinct from a newly observed '
        'source transaction.</p>',
        "</section>",
        '<section><h2>7. Deposit review and selected daily close</h2>',
        _table(["Reviewer ID", "Name", "Role", "Statement", "Notes", "Recorded",
                "Reviewed edit revision", "Reviewed snapshot"], [
            [r.get("reviewer_id"), r.get("name"), r.get("role"), r.get("statement"),
             r.get("note"), r.get("signed_at"), r.get("edit_revision"), r.get("snapshot_hash")]
            for r in _array(detail.get("signoffs")) if isinstance(r, dict)
        ], empty="No deposit signoffs are recorded.", full_file="signoffs.csv"),
        '<p class="note">These are the retained reviewer observations and their exact reviewed '
        'editions. The daily-close record identifies which observations it uses.</p>',
        _record(detail.get("closing"), "Selected daily-close record"),
        "<h3>Retained close history</h3>",
        _brief_records(detail.get("closings"), "Daily close", [
            "id", "status", "owner", "prepared_at", "reviewed_at", "closed_at",
            "created_at", "source_revision", "edit_revision", "snapshot_hash", "note"]),
        "</section>",
        '<section><h2>8. ERP exchange and actual receiving</h2>',
        _brief_records(detail.get("interface_exports"), "Interface export", [
            "id", "title", "filename", "kind", "status", "prepared_at", "created_at",
            "sha256", "layout_id", "layout_version", "source_revision", "edit_revision",
            "transmitted_at", "received_at", "posting_reference", "owner", "note"]),
        '<p class="note">Preparing or downloading a file does not transmit it. A transmission '
        'receipt does not establish that all records were accepted or posted. The original '
        'receiving observations and source rows determine those outcomes.</p>',
        "</section>",
        '<section><h2>9. Handoff and continuation</h2>',
        '<p>The exported packet contains the complete native run, human-readable CSV ledgers, '
        'original input and supporting-document bytes, selected mappings, review history and '
        'the member manifest. The HTML tables show up to ' + str(NARRATIVE_LIMIT) +
        ' entries per section; every supplied row remains in run.json and its complete CSV.</p>',
        '<p>CSV files are for human spreadsheet review. Cells that could become formulas or lose '
        'long numeric identifiers are marked as text. The original files and JSON retain the exact '
        'supplied values.</p>',
        _record(detail.get("history"), "Complete recorded history"),
        "</section>",
        '<footer>Financial workshare handoff · Original permitting cutover and external system '
        'acceptance retain their own records.</footer>'
    ]
    styles = """
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#fff;color:#171717;
font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1380px;margin:auto;padding:36px 32px}header{border-bottom:2px solid #222;padding-bottom:18px}
h1{font-size:28px;line-height:1.2;margin:6px 0 10px;overflow-wrap:anywhere}
h2{font-size:19px;margin:0 0 16px}h3{font-size:15px;margin:22px 0 10px}
.eyebrow{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#555}
.subtitle{font-size:16px;margin:0 0 12px}.state{margin:0}section{padding:24px 0;border-bottom:1px solid #aaa}
.table-wrap{overflow-x:auto;margin:14px 0}table{width:100%;border-collapse:collapse;font-size:12px}
th,td{border:1px solid #c4c4c4;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{background:#eee;font-weight:650}tbody tr:nth-child(even){background:#fafafa}
.note,.empty{color:#555;font-size:12px}.empty{padding:10px 0}
details{margin:12px 0;border:1px solid #ccc;padding:10px 12px}
summary{cursor:pointer;font-weight:600}pre{font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;
white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0 0}
.record{margin:12px 0}footer{padding-top:22px;font-size:11px;color:#555}
@media(max-width:700px){main{padding:20px 12px}h1{font-size:24px}table{min-width:650px}}
@page{size:A4 landscape;margin:12mm}
@media print{body{font-size:10pt}main{max-width:none;padding:0}section{padding:12px 0}
h1{font-size:20pt}h2{font-size:14pt}h1,h2,h3{break-after:avoid}table{font-size:8pt;min-width:0}
th,td{padding:5px}thead{display:table-header-group}tr{break-inside:avoid}
.table-wrap{overflow:visible}details{break-inside:avoid}details:not([open])>*:not(summary){display:none}
footer{font-size:8pt}}
"""
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            "<title>" + html.escape(str(title)) + "</title><style>" + styles +
            "</style></head><body><main>" + "".join(parts) + "</main></body></html>")


def _csv_cell(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    cell = _json(value, indent=None) if isinstance(value, (dict, list)) else str(value)
    leading = cell.lstrip(" \t\r\n\ufeff")
    formula = leading.startswith(("=", "+", "-", "@"))
    control_prefix = cell.startswith(("\t", "\r", "\n", "\ufeff"))
    numeric_text = bool(re.fullmatch(r"(?:[0-9]{16,}|0[0-9]+)", cell))
    return "'" + cell if formula or control_prefix or numeric_text else cell


def _csv(rows, fields=None):
    records = [r if isinstance(r, dict) else {"value": r} for r in rows]
    if fields is None:
        fields = sorted({key for row in records for key in row})
    buf = io.StringIO(newline="")
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow([_csv_cell(field) for field in fields])
    for row in records:
        writer.writerow([_csv_cell(row.get(field)) for field in fields])
    return buf.getvalue().encode("utf-8")


def _ledger_rows(detail):
    rows = []
    for lane in LANES:
        for row in _array(_object(detail.get("rows")).get(lane)):
            if not isinstance(row, dict):
                rows.append({"lane": lane, "unparsed_native_row": row})
                continue
            item = dict(row)
            item["lane"] = lane
            original = _object(row.get("original"))
            item["original_capture_id"] = original.get("capture_id")
            item["original_record"] = original.get("line")
            item["original_values"] = original.get("values")
            rows.append(item)
    return rows


def _csv_members(detail):
    tx_fields = [
        "lane", "record_key", "transaction_id", "permit_id", "invoice_id", "fee_code",
        "session_id", "business_date", "currency", "event", "status", "amount_minor",
        "requested_minor", "paid_minor", "net_minor", "related_transaction_id",
        "denial_reason", "payment_type", "original_capture_id", "original_record",
        "original_values", "original"
    ]
    transactions = _ledger_rows(detail)
    extra = sorted({key for r in transactions for key in r} - set(tx_fields))
    members = {"transactions.csv": _csv(transactions, tx_fields + extra)}
    for name, key, fields in [
        ("groups.csv", "groups", ["id", "kind", "transaction_id", "currency", "net_minor",
                                 "allocated_minor", "remaining_minor", "record_keys", "permit_ids",
                                 "invoice_ids", "fee_codes", "payment_types", "session_ids"]),
        ("allocations.csv", "allocations", ["id", "source_group_id", "target_group_id",
                                           "amount_minor", "currency", "owner", "note",
                                           "created_at", "active"]),
        ("findings.csv", "findings", ["id", "code", "severity", "message", "waivable",
                                     "review_status", "review_owner", "review_note",
                                     "review_updated_at", "details", "review"]),
        ("balances.csv", "balances", ["business_date", "session_id", "payment_type", "currency",
                                     "expected_minor", "cashier_minor", "processor_minor",
                                     "cashier_difference_minor", "processor_difference_minor"]),
        ("totals.csv", "totals", ["currency", "permit_minor", "receivables_minor",
                                 "processor_minor", "cashier_minor", "allocated_minor",
                                 "permit_remaining_minor", "receivables_remaining_minor"]),
        ("corrections.csv", "corrections", None),
        ("signoffs.csv", "signoffs", ["reviewer_id", "name", "role", "statement", "note",
                                     "signed_at", "edit_revision", "snapshot_hash"]),
        ("closings.csv", "closings", None),
        ("interface-exports.csv", "interface_exports", None)
    ]:
        rows = []
        for raw in _array(detail.get(key)):
            row = dict(raw) if isinstance(raw, dict) else {"value": raw}
            if key == "findings":
                review = _object(row.get("review"))
                for attr in ("status", "owner", "note", "updated_at"):
                    row["review_" + attr] = review.get(attr)
            rows.append(row)
        if fields is not None:
            fields = fields + sorted({k for row in rows for k in row} - set(fields))
        elif not rows:
            fields = ["id", "status", "owner", "note"]
        members[name] = _csv(rows, fields)
    return members


def _safe_name(value, fallback):
    # This only names the archive member. Metadata retains the original name.
    raw = unicodedata.normalize("NFC", str(value or fallback)).replace("\\", "/")
    raw = raw.rsplit("/", 1)[-1]
    name = re.sub(r'[\x00-\x1f\x7f<>:"/\\|?*]', "_", raw).strip(" .")
    if not name or name in (".", ".."):
        name = fallback
    return name[:180]


def _safe_source_path(value):
    text = str(value)
    if not text or "\\" in text or "\x00" in text:
        raise ValueError("Source member must be a nonempty relative POSIX path.")
    path = PurePosixPath(text)
    if path.is_absolute() or any(part in ("", ".", "..") for part in text.split("/")):
        raise ValueError("Source member may not escape the source directory: " + text)
    if ":" in path.parts[0] or any(ord(c) < 32 for c in text):
        raise ValueError("Invalid source member path: " + text)
    return str(path)


def _bytes(value, label):
    if not isinstance(value, (bytes, bytearray, memoryview)):
        raise TypeError(label + " must contain original bytes.")
    return bytes(value)


def _add(members, name, raw):
    if name in members:
        raise ValueError("Duplicate packet member: " + name)
    members[name] = raw


def _original_members(records, role, members):
    metadata = []
    identities = {}
    for index, entry in enumerate(records, 1):
        if not isinstance(entry, dict):
            raise TypeError(role + " entries must be objects.")
        raw = _bytes(entry.get("raw"), role + " " + str(entry.get("id")))
        actual = hashlib.sha256(raw).hexdigest()
        expected = entry.get("sha256")
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", expected):
            raise ValueError(role + " " + str(entry.get("id")) + " requires its source SHA-256.")
        if actual != expected.lower():
            raise ValueError(role + " " + str(entry.get("id")) + " differs from its retained SHA-256.")
        if entry.get("id") is None or entry.get("filename") is None:
            raise ValueError(role + " entries require original id and filename.")
        identity = (str(entry["id"]), str(entry.get("kind")))
        meta = {key: value for key, value in entry.items() if key != "raw"}
        _json(meta)
        if identity in identities:
            previous = identities[identity]
            if previous["metadata"] != meta or previous["sha256"] != actual:
                raise ValueError("Conflicting original artifact identity: " + str(identity))
            # Repeated reference to the same exact capture retains one byte member.
            metadata.append(dict(previous["result"], repeated_reference=True))
            continue
        path = (role + "/" + str(index).zfill(4) + "-" +
                _safe_name(entry["id"], "capture")[:60] + "--" +
                _safe_name(entry["filename"], "original.bin")[:160])
        _add(members, path, raw)
        result = dict(meta, archive_path=path, bytes=len(raw), verified_sha256=actual)
        identities[identity] = {"metadata": meta, "sha256": actual, "result": result}
        metadata.append(result)
    return metadata


def _content_type(name):
    suffix = name.lower().rsplit(".", 1)[-1] if "." in name else ""
    return {"html": "text/html; charset=utf-8", "json": "application/json",
            "csv": "text/csv; charset=utf-8", "md": "text/markdown; charset=utf-8",
            "txt": "text/plain; charset=utf-8", "py": "text/x-python; charset=utf-8"}.get(
                suffix, "application/octet-stream")


def build_packet(detail: dict, originals: list[dict], documents: list[dict], *,
                 source_files: dict[str, bytes] | None = None) -> tuple[bytes, dict]:
    """Package complete supplied native detail, exact originals and optional source.

    The returned manifest is identical to manifest.json inside the ZIP. It lists
    every other member; its own hash and the archive hash are intentionally left
    to the receiving storage layer. ZIP metadata is fixed and members sorted.
    """
    _validate_detail(detail)
    if not isinstance(originals, list) or not isinstance(documents, list):
        raise TypeError("Originals and documents must be complete artifact lists.")
    members = {
        "report.html": render_report(detail).encode("utf-8"),
        "run.json": (_json(detail) + "\n").encode("utf-8"),
        "source-manifest.json": (_json(detail.get("manifest", [])) + "\n").encode("utf-8"),
        "history.json": (_json(detail.get("history", [])) + "\n").encode("utf-8")
    }
    members.update(_csv_members(detail))
    source_metadata = _original_members(originals, "originals", members)
    document_metadata = _original_members(documents, "documents", members)
    members["originals.json"] = (_json(source_metadata) + "\n").encode("utf-8")
    members["documents.json"] = (_json(document_metadata) + "\n").encode("utf-8")
    if source_files is not None:
        if not isinstance(source_files, Mapping):
            raise TypeError("source_files must map relative paths to supplied bytes.")
        for relative, raw in source_files.items():
            _add(members, "source/" + _safe_source_path(relative),
                 _bytes(raw, "Source member " + str(relative)))
    readme = """# Daily cashiering and receivables handoff

Open report.html for the readable financial report. It formats the native supplied
amounts and decisions; it does not recalculate or claim an external posting.

## Complete working data

- run.json: the entire native run detail, including selected settings, every lane
  and row, groups, allocations, findings, balances, totals, corrections, signoffs,
  all closing editions, selected close, interface records, counts and history.
- transactions.csv, groups.csv, allocations.csv, findings.csv, balances.csv and
  totals.csv: complete human-review ledgers. Monetary columns ending in _minor
  are exact original integer minor-unit values; currency scales are in run.json.
- corrections.csv, signoffs.csv, closings.csv and interface-exports.csv: complete
  recorded operational history for those families.
- source-manifest.json and history.json: the original selected source projection
  and full event history.
- originals.json / documents.json: supplied metadata and their exact archive
  members, byte counts and verified hashes.
- originals/ / documents/: unchanged original bytes.
- source/: the exact implementation files when the caller supplied them.

CSV is for human spreadsheet review. Potential formula cells and long or
zero-prefixed numeric identifiers are prefixed with an apostrophe to keep them
text. JSON and original files retain the exact supplied values. Missing CSV
values are empty cells; JSON preserves null. Do not turn missing observations
into zero amounts.

## Source and decision boundaries

A prepared ERP file is distinct from its transmission and actual receiving or
posting results. The selected close and reviewer records are the supplied
observations at their recorded revisions, not proof of Treasury deposit or
external system acceptance. Historical source versions and later observations
remain separately identifiable in the full data.

manifest.json lists every other packet member and its exact size and SHA-256.
Its own digest and the complete archive digest are recorded by the receiving
storage layer. The archive uses fixed metadata and can be recreated from the
same complete inputs. Keep this packet in the owner's approved private working
location: it may contain actual financial rows and review documents.

Reopen the supplied workspace through its maintained application and receiving
guide. This packet contains complete retained reporting data and supplied
originals; it does not invent a database restore command or a vendor import
layout that the application has not provided.
"""
    members["README.md"] = readme.encode("utf-8")
    run = detail["run"]
    manifest = {
        "schema": PACKET_SCHEMA,
        "run": {key: run.get(key) for key in (
            "id", "label", "start_date", "end_date", "created_at", "source_revision",
            "edit_revision", "status")},
        "currency_scales": _scales(detail),
        "counts": detail.get("counts", {}),
        "originals": source_metadata,
        "documents": document_metadata,
        "source_files_included": source_files is not None,
        "source_file_count": len(source_files) if source_files is not None else 0,
        "csv_policy": "Human-review CSV escapes potential formulas and preserves long numeric identifiers as text; JSON and original files remain exact.",
        "financial_calculation": "Supplied native engine projections only.",
        "member_hash_scope": "All members except manifest.json; archive identity belongs to the receiving layer.",
        "member_count_including_manifest": len(members) + 1,
        "members": [{
            "path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
            "content_type": _content_type(name)
        } for name, raw in sorted(members.items())]
    }
    members["manifest.json"] = (_json(manifest) + "\n").encode("utf-8")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9,
                         allowZip64=True) as archive:
        for name, raw in sorted(members.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return out.getvalue(), manifest
