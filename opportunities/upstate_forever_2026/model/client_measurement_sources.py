"""Mechanical worksheet projection for the original Measurements preparation.

The existing reader supplies cells and source positions. No unit, date, fraction
or scientific normalisation happens here; the original Measurements engine owns it.
"""
from __future__ import annotations
from collections import Counter
import csv
import hashlib
import io
import json
from pathlib import Path

from .client_source_files import need, options, scalar, table_records
from .common import file_digest

SCHEMA = "upper-savannah-measurement-source-lineage/v1"
MAX_REQUEST = 128 * 1024 * 1024


def _cell(value):
    value = scalar(value)
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _record_values(record):
    return [_cell(value) for value in record["values"]]


def project_worksheet(path, *, sheet, reading, original, project_id,
                      source_collection_id, source_id, inspection_id):
    path = Path(path)
    opts = options(reading)
    need(path.stat().st_size == original["bytes"] and file_digest(path) == original["sha256"],
         "The complete original workbook or text file changed.")
    header_row = opts["header_row"]
    width, labels, observed = 0, None, 0
    first = table_records(path, opts, sheet)
    try:
        for record in first:
            observed = record["row"]
            width = max(width, len(record["values"]))
            if record["row"] == header_row:
                labels = _record_values(record)
    finally:
        first.close()
    need(labels is not None and width, "Choose an existing original header row with source columns.")
    # The native parser's original one-million-record bound is preserved.
    need(observed - header_row <= 1000000,
         "This worksheet exceeds the existing Measurements row route; keep its full original and use the maintained large-file workflow.")
    labels += [""] * (width - len(labels))
    canonical = [value.strip() for value in labels]
    counts, used, columns = Counter(canonical), set(), []
    for index, label in enumerate(labels):
        proposed = canonical[index] if canonical[index] and counts[canonical[index]] == 1 else (label.strip() or "Unnamed") + " · column " + str(index + 1)
        while proposed in used:
            proposed += " · column " + str(index + 1)
        used.add(proposed)
        columns.append({"index": index, "column_id": "c" + str(index),
                        "original_label": label, "transport_column": proposed})
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")
    writer.writerow([column["transport_column"] for column in columns])
    current_line = stream.getvalue().count("\n") + 1
    rows, excluded = [], []
    records = table_records(path, opts, sheet)
    formulas = table_records(path, {**opts, "formula_mode": "formulas"}, sheet) \
        if path.suffix.lower() in {".xlsx", ".xlsm"} and opts["formula_mode"] == "cached" else None
    try:
        for record in records:
            original_record = next(formulas) if formulas else record
            need(original_record["row"] == record["row"], "The original worksheet row alignment changed.")
            number = record["row"]
            position = {"source_row": number, "source_line_start": record["line_start"],
                        "source_line_end": record["line_end"]}
            if number <= header_row:
                excluded.append({**position, "reason": "header" if number == header_row else "preamble"})
                continue
            raw_cells = original_record["values"]
            if not any(value is not None and str(value) != "" for value in raw_cells):
                excluded.append({**position, "reason": "blank"})
                continue
            values = _record_values(record)
            # An explicit cached read never substitutes an absent result for a formula.
            if formulas:
                for index, raw in enumerate(raw_cells):
                    if isinstance(raw, str) and raw.startswith("="):
                        need(index < len(record["values"]) and record["values"][index] is not None,
                             "Worksheet row " + str(number) + ", column " + str(index + 1) +
                             " has an original formula without a cached result. Recalculate/save the original or choose its preserved formula reading; no row was imported.")
            values += [""] * (width - len(values))
            if not any(value != "" for value in values):
                excluded.append({**position, "reason": "empty-derived"})
                continue
            item = io.StringIO(newline="")
            csv.writer(item, lineterminator="\r\n").writerow(values)
            encoded_row = item.getvalue()
            stream.write(encoded_row)
            rows.append({"line": current_line, **position})
            current_line += encoded_row.count("\n")
            need(stream.tell() <= MAX_REQUEST,
                 "The full selected worksheet exceeds the original preparation route; its complete original remains retained.")
    finally:
        records.close()
        if formulas:
            formulas.close()
    content = stream.getvalue()
    body = content.encode("utf-8")
    need(len(body) <= MAX_REQUEST, "The complete UTF-8 worksheet exceeds the original Measurements request capacity.")
    need(path.stat().st_size == original["bytes"] and file_digest(path) == original["sha256"],
         "The original file changed during worksheet reading; no preparation was issued.")
    lineage = {"schema": SCHEMA, "project_id": project_id,
               "source_collection_id": source_collection_id, "source_id": source_id,
               "inspection_id": inspection_id, "original": dict(original),
               "sheet": sheet, "reading": opts,
               "source_row_kind": "worksheet-row" if path.suffix.lower() in {".xlsx", ".xlsm"} else "csv-record",
               "columns": columns, "rows": rows, "excluded_rows": excluded,
               "original_record_count": observed,
               "derived": {"format": "csv", "sha256": hashlib.sha256(body).hexdigest(),
                           "bytes": len(body), "filename": path.stem + "-selected-sheet.csv"},
               "meaning": "Mechanical original-cell text only. Scientific mapping, units, fractions and interpretation remain subject to original native review."}
    # Bind the whole lineage deterministically; no local absolute path enters it.
    return {"text": content, "lineage": lineage}


def preparation_value(projection, *, kind, label, reviewer, note, context):
    need(kind in {"wqp", "stations"}, "Choose chemistry measurements or station metadata for this worksheet.")
    for name, value in {"label": label, "reviewer": reviewer, "note": note, "context": context}.items():
        need(isinstance(value, str), "Keep the " + name + " as original text.")
    need(label.strip() and reviewer.strip(), "Name this preparation and its source reviewer.")
    lineage = projection["lineage"]
    return {"kind": kind, "label": label, "sourceName": lineage["derived"]["filename"],
            "sourceSha": lineage["derived"]["sha256"], "mapping": {},
            "reviewer": reviewer, "note": note, "context": context,
            "lineage": lineage}


def checked_request(value):
    raw = json.dumps(value, ensure_ascii=True, allow_nan=False).encode("utf-8")
    need(len(raw) <= MAX_REQUEST,
         "The complete original workbook, worksheet and lineage exceed the existing 128 MiB request route. Keep the original source; do not send a partial preparation.")
    return raw
