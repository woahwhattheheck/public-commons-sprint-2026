"""Read complete XLSX selections into the existing grant-planning source tables.

The maintained dataset-refresh reader owns XLSX parsing and saved-cache/date
semantics. This adapter retains its original materials, supplies string columns
to the planning mapper, and replays selections during native save and receiving.
"""
from __future__ import annotations

import base64
import binascii
from contextlib import contextmanager
from copy import deepcopy
import csv
from decimal import Decimal
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import sys
import tempfile

SOURCE_SCHEMA = "stellar-forge.planning-workbook-source.v1"
PROJECTION_SCHEMA = "stellar-forge.planning-workbook-selection.v1"
REQUEST_SCHEMA = "stellar-forge.planning-workbook-mapping.v1"
READER_PATH = "stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/workbook/reader.py"
HERE = Path(__file__).resolve().parent
READER_FILE = HERE.parents[2] / "scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/workbook/reader.py"
MAX_BOOK_BYTES = 32 * 1024 * 1024
MAX_TABLE_BYTES = 16 * 1024 * 1024
MAX_ROWS = 100000
MAX_CELL_CHARS = 1024 * 1024
HASH = re.compile(r"[a-f0-9]{64}\Z")
_reader = None
_reader_digest = None


class WorkbookInputError(ValueError):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code, self.status, self.details = code, 422, details


def need(value, code, message, details=None):
    if not value:
        raise WorkbookInputError(code, message, details)


def encoded(value):
    try:
        return value.encode("utf-8")
    except (AttributeError, UnicodeError) as exc:
        raise WorkbookInputError("WORKBOOK_TEXT", "Retain ordinary valid UTF-8 text.") from exc


def packed(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def plain_text(value, label, maximum=4000, required=False):
    need(isinstance(value, str) and len(value) <= maximum and "\x00" not in value and
         (not required or value.strip()), "WORKBOOK_TEXT", label + " needs ordinary text.")
    encoded(value)
    return value


def reader():
    global _reader, _reader_digest
    if _reader is None:
        spec = importlib.util.spec_from_file_location("_grant_planning_original_xlsx_reader", READER_FILE)
        need(spec and spec.loader, "WORKBOOK_READER", "Install the complete Grant Operations workbook reader.")
        module = importlib.util.module_from_spec(spec)
        raw = READER_FILE.read_bytes()
        exec(compile(raw, str(READER_FILE), 'exec'), module.__dict__)
        _reader_digest = digest(raw)
        _reader = module
    return _reader


def reader_identity():
    original = reader()
    return {"path": READER_PATH, "sha256": _reader_digest, "parser": original.PARSER}


def decode_source(value):
    need(isinstance(value, dict), "WORKBOOK_SOURCE", "Choose an original XLSX workbook.")
    name = plain_text(value.get("filename"), "Original workbook filename", 500, True)
    need("/" not in name and "\\" not in name, "WORKBOOK_FILENAME", "Use the original filename without a directory.")
    data = value.get("dataBase64")
    need(isinstance(data, str) and 0 < len(data) <= 4 * ((MAX_BOOK_BYTES + 2) // 3),
         "WORKBOOK_CAPACITY", "The complete workbook must fit the retained 32 MiB source project.")
    try:
        raw = base64.b64decode(data, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise WorkbookInputError("WORKBOOK_BYTES", "Retain the complete original workbook bytes.") from exc
    need(base64.b64encode(raw).decode("ascii") == data and raw, "WORKBOOK_BYTES", "Use the complete canonical workbook byte encoding.")
    sha = digest(raw)
    if "bytes" in value:
        need(type(value["bytes"]) is int and value["bytes"] == len(raw), "WORKBOOK_BYTES", "The workbook size differs from its original bytes.")
    if "sha256" in value:
        need(value["sha256"] == sha, "WORKBOOK_BYTES", "The workbook differs from its original source identity.")
    if "id" in value:
        need(value["id"] == "xlsx-" + sha and value.get("schema") == SOURCE_SCHEMA,
             "WORKBOOK_SOURCE", "Retain the complete original workbook identity.")
    return name, raw, sha


@contextmanager
def opened(value):
    name, raw, sha = decode_source(value)
    original = reader()
    with tempfile.TemporaryFile("w+b") as stream:
        stream.write(raw)
        stream.flush()
        stream.seek(0)
        workbook = None
        try:
            workbook = original.Workbook(stream, {"bytes": len(raw), "sha256": sha})
            source = {"schema": SOURCE_SCHEMA, "id": "xlsx-" + sha, "filename": name,
                      "bytes": len(raw), "sha256": sha, "dataBase64": value["dataBase64"],
                      "description": workbook.describe(), "decoder": reader_identity()}
            need(len(packed(source)) <= MAX_BOOK_BYTES, "WORKBOOK_CAPACITY",
                 "The original workbook and its description exceed the retained 32 MiB source project.")
            yield source, workbook
        except original.WorkbookError as exc:
            raise WorkbookInputError(exc.code, str(exc), exc.details) from exc
        finally:
            if workbook is not None:
                workbook.zip.close()


def inspect_workbook(request):
    need(isinstance(request, dict), "WORKBOOK_REQUEST", "Choose a workbook and source preview.")
    with opened(request.get("source")) as (source, workbook):
        preview_request = request.get("preview") or {}
        need(isinstance(preview_request, dict), "WORKBOOK_PREVIEW", "Choose a worksheet and source range.")
        preview = workbook.inspect(preview_request)
        header_row = request.get("headerRow")
        header_cells = []
        if header_row is not None:
            bounds = reader().selection_range(preview["range"])
            reader().integer(header_row, "Header row", bounds[1], bounds[3])
            header_cells = workbook.inspect({"sheet": preview["metadata"]["name"], "range": preview["range"],
                                             "offset": header_row - bounds[1], "limit": 1})["rows"][0]["cells"]
        return {"source": source, "preview": preview, "headerCells": header_cells}


def mapping_request(value):
    need(isinstance(value, dict) and set(value) == {"schema", "plan", "numericText"} and
         value.get("schema") == REQUEST_SCHEMA and isinstance(value.get("plan"), dict),
         "WORKBOOK_MAPPING", "Save the complete worksheet selection and conversion choices.")
    plan = value["plan"]
    plain_text(plan.get("name"), "Selection name", 200, True)
    plain_text(plan.get("notes"), "Selection note", 4000)
    columns = plan.get("columns")
    need(isinstance(columns, list) and 1 <= len(columns) <= 64 and all(isinstance(x, dict) for x in columns),
         "WORKBOOK_COLUMNS", "Select between one and 64 source columns.")
    names = [plain_text(x.get("name"), "Projected field name", 128, True) for x in columns]
    need(len(set(names)) == len(names), "WORKBOOK_COLUMNS", "Give each projected field a distinct name.")
    policies = value.get("numericText")
    need(isinstance(policies, dict) and set(policies) == set(names) and
         all(x in ("source", "decimal") for x in policies.values()), "WORKBOOK_NUMERIC_TEXT",
         "Choose original spelling or exact decimal expansion for every projected field.")
    for column in columns:
        if policies[column["name"]] == "decimal":
            need(column.get("formula") != "text" and column.get("date") == "raw",
                 "WORKBOOK_NUMERIC_TEXT", "Exact decimal expansion requires raw numeric text; keep formula text and calendar dates as text.")
    # Every target is a string. The existing planning mapper owns semantic types,
    # keys, prices and rounding; the workbook reader never coerces them to float.
    config = {"columns": {name: {"type": "string", "nullable": False} for name in names},
              "maxBytes": MAX_TABLE_BYTES, "maxRows": MAX_ROWS, "maxCellChars": MAX_CELL_CHARS}
    reader().validate_plan(plan, config)
    return deepcopy(value), config


def decimal_text(value):
    need(len(value) <= 1024 and reader().NUMBER_RE.fullmatch(value),
         "WORKBOOK_DECIMAL_TEXT", "Exact decimal expansion needs a finite original numeric token.")
    number = Decimal(value)
    need(number.is_finite(), "WORKBOOK_DECIMAL_TEXT", "Use finite decimal source values.")
    sign, digits, exponent = number.as_tuple()
    # Bound fixed-point output before formatting, including a future compatible
    # reader that admits a wider exponent than the current five-digit grammar.
    if exponent >= 0:
        width = 1 if number.is_zero() else len(digits) + exponent
    elif len(digits) + exponent > 0:
        width = len(digits) + 1
    else:
        width = 2 - exponent
    need(width + sign <= MAX_CELL_CHARS, "WORKBOOK_DECIMAL_TEXT",
         "The expanded decimal exceeds the original source-cell allowance.")
    result = format(number, "f")
    need(len(result) <= MAX_CELL_CHARS, "WORKBOOK_DECIMAL_TEXT", "The expanded decimal exceeds the original source-cell allowance.")
    return result


def append_exclusion(rows, row, reason):
    if rows and rows[-1]["reason"] == reason and rows[-1]["toRow"] + 1 == row:
        rows[-1]["toRow"] = row
    else:
        rows.append({"fromRow": row, "toRow": row, "reason": reason})


def projection_from_open(source, workbook, selected):
    mapping, config = mapping_request(selected)
    original = reader()
    csv_output, row_output = io.BytesIO(), io.BytesIO()
    projection = original.prepare(workbook, {"plan": mapping["plan"], "config": config,
                                  "maxCsvBytes": MAX_TABLE_BYTES, "maxPreparedBytes": MAX_BOOK_BYTES},
                                  csv_output, row_output)
    initial_csv = csv_output.getvalue().decode("utf-8")
    row_text = row_output.getvalue().decode("utf-8")
    source_rows = [json.loads(line) for line in row_text.splitlines()]
    values = list(csv.reader(io.StringIO(initial_csv, newline="")))
    fields = values[0]
    # Numeric conversion is ASCII-to-ASCII and preserves CSV quoting. Bound the
    # growing projection before retaining each expanded value, including when a
    # whole worksheet column contains large exponents.
    expanded_csv_bytes = len(csv_output.getvalue())
    transforms = []
    for index, row in enumerate(values[1:]):
        for col, field in enumerate(fields):
            if row[col] != "" and mapping["numericText"][field] == "decimal":
                try:
                    after = decimal_text(row[col])
                    expanded_csv_bytes += len(after) - len(row[col])
                    need(expanded_csv_bytes <= MAX_TABLE_BYTES, "WORKBOOK_CAPACITY",
                         "The exact decimal projection exceeds the original 16 MiB source-table allowance. Select a smaller worksheet range or keep original numeric spelling.")
                except WorkbookInputError as exc:
                    coordinate = mapping["plan"]["columns"][col]["source"] + str(source_rows[index]["row"])
                    raise WorkbookInputError(exc.code, str(exc), {"cell": coordinate, "field": field, "sourceValue": row[col]}) from exc
                if after != row[col]:
                    transforms.append({"record": index + 2, "row": source_rows[index]["row"], "field": field,
                                       "before": row[col], "after": after, "operation": "exact-decimal-expansion"})
                row[col] = after
    stream = io.StringIO(newline="")
    csv.writer(stream, lineterminator="\n").writerows(values)
    csv_text = stream.getvalue()
    csv_raw = encoded(csv_text)
    need(len(csv_raw) <= MAX_TABLE_BYTES, "WORKBOOK_CAPACITY", "The projected CSV exceeds the original 16 MiB source-table allowance.")
    plan = mapping["plan"]
    sheet = workbook.sheet(plan["sheet"])
    bounds, columns = original.validate_plan(plan, config)
    _, first, _, last = bounds
    excluded = []
    if plan["headerRow"] is not None:
        for row in range(first, plan["headerRow"]):
            append_exclusion(excluded, row, "before-header")
        append_exclusion(excluded, plan["headerRow"], "header")
        first = plan["headerRow"] + 1
    included = {row["row"] for row in source_rows}
    for row in range(first, last + 1):
        if row not in included:
            reason = "hidden" if row in sheet["hidden"] and plan["hiddenRows"] == "exclude" else "blank"
            append_exclusion(excluded, row, reason)
    retained_rows = []
    retained_bytes = len(packed(source)) + len(csv_raw) + len(encoded(row_text)) + len(packed(transforms)) + len(packed(excluded))
    merge_ranges = sorted((x for x in sheet["merged"] if x["bounds"][3] >= first and x["bounds"][1] <= last),
                          key=lambda x: x["bounds"][1])
    merge_cursor, active = 0, []
    for index, position in enumerate(source_rows):
        row = position["row"]
        while merge_cursor < len(merge_ranges) and merge_ranges[merge_cursor]["bounds"][1] <= row:
            active.append(merge_ranges[merge_cursor])
            merge_cursor += 1
        active = [x for x in active if x["bounds"][3] >= row]
        cells = []
        for offset, (_spec, bind, col) in enumerate(columns):
            cell = sheet["cells"].get((col, row), original.blank_cell(col, row, row in sheet["hidden"]))
            merged = [x["range"] for x in active if x["bounds"][0] <= col <= x["bounds"][2]]
            non_anchor = plan["mergedCells"] == "anchor" and any(
                x["bounds"][0] <= col <= x["bounds"][2] and (col, row) != x["bounds"][:2] for x in active)
            cells.append({"field": bind["name"], "original": deepcopy(cell),
                          "selection": "merged-non-anchor-empty" if non_anchor else "original",
                          "mergedRanges": merged, "output": values[index + 1][offset]})
        item = {"record": index + 2, "dataRecord": index + 1, "row": row,
                "hidden": row in sheet["hidden"], "cells": cells}
        retained_bytes += len(packed(item))
        need(retained_bytes <= MAX_BOOK_BYTES, "WORKBOOK_CAPACITY",
             "The complete workbook, selected cell provenance and CSV exceed the retained 32 MiB source project. Select a smaller source range.")
        retained_rows.append(item)
    body = {"schema": PROJECTION_SCHEMA, "sourceId": source["id"], "sourceSha256": source["sha256"],
            "sourceBytes": source["bytes"], "decoder": reader_identity(), "mapping": mapping,
            "description": {"epoch": workbook.epoch, "sheet": sheet["metadata"],
                            "calculationProperties": workbook.calculation,
                            "externalRelationships": workbook.external},
            "readerProjection": projection,
            "csv": {"text": csv_text, "bytes": len(csv_raw), "sha256": digest(csv_raw)},
            "rowMap": {"text": row_text, "bytes": len(encoded(row_text)), "sha256": digest(encoded(row_text))},
            "rows": retained_rows, "excludedRanges": excluded, "transformations": transforms,
            "formulaPolicy": "The stored workbook result is used only when cached is selected. Formulas and external links are never recalculated."}
    raw = packed(body)
    need(len(raw) + len(packed(source)) <= MAX_BOOK_BYTES, "WORKBOOK_CAPACITY",
         "The complete source and selected projection exceed the retained 32 MiB source project.")
    return {"text": raw.decode("utf-8"), "bytes": len(raw), "sha256": digest(raw)}


def project_workbook(request):
    need(isinstance(request, dict), "WORKBOOK_REQUEST", "Choose a workbook and complete mapping.")
    with opened(request.get("source")) as (source, workbook):
        selected = projection_from_open(source, workbook, request.get("mapping"))
        return {"source": source, "projection": selected}


def projection_body(value):
    need(isinstance(value, dict) and isinstance(value.get("text"), str) and
         HASH.fullmatch(str(value.get("sha256", ""))), "WORKBOOK_SELECTION", "Retain the complete selected workbook projection.")
    raw = encoded(value["text"])
    need(0 < len(raw) <= MAX_BOOK_BYTES and digest(raw) == value["sha256"],
         "WORKBOOK_SELECTION", "The retained workbook selection differs from its source identity.")
    if "bytes" in value:
        need(type(value["bytes"]) is int and value["bytes"] == len(raw),
             "WORKBOOK_SELECTION", "The retained workbook selection size differs.")
    try:
        body = json.loads(raw, parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError) as exc:
        raise WorkbookInputError("WORKBOOK_SELECTION", "Open the complete saved workbook selection.") from exc
    need(isinstance(body, dict) and body.get("schema") == PROJECTION_SCHEMA,
         "WORKBOOK_SELECTION", "Use the original workbook-selection format.")
    return body


def validate_workbook_materials(book):
    """Replay the retained original bytes during native estimate/save/ZIP import."""
    if not any(key in book for key in ("workbookSources", "workbookSelections", "selectedWorkbooks")):
        return
    sources, selections, active = book.get("workbookSources", []), book.get("workbookSelections", []), book.get("selectedWorkbooks", {})
    need(isinstance(sources, list) and isinstance(selections, list) and isinstance(active, dict),
         "WORKBOOK_SOURCE", "Retain all original workbooks, selections and selected edition references.")
    documents = {x["id"]: x for x in book["project"]["documents"]}
    originals, ids = {}, set()
    for value in sources:
        need(isinstance(value, dict) and value.get("schema") == SOURCE_SCHEMA and
             value.get("id") not in originals, "WORKBOOK_SOURCE", "Retain each original workbook once.")
        originals[value.get("id")] = value
    by_source, found = {}, {}
    for value in selections:
        body = projection_body(value)
        source_id, document_id = value.get("sourceId"), value.get("documentId")
        need(source_id in originals and document_id in documents and
             body.get("sourceId") == source_id, "WORKBOOK_SELECTION", "Retain the original workbook and source-table document for every selection.")
        expected_id = "wbsel-" + digest(encoded(source_id + "\n" + document_id + "\n" + value["sha256"]))
        need(value.get("id") == expected_id and expected_id not in ids,
             "WORKBOOK_SELECTION", "Retain each complete workbook selection once.")
        ids.add(expected_id)
        plain_text(value.get("receivedAt"), "Selection date", 100, True)
        edition = next((x for x in documents[document_id]["editions"] if x["id"] == value.get("editionId")), None)
        need(edition is not None and isinstance(body.get("csv"), dict) and
             body["csv"].get("text") == edition["sourceText"] and body["csv"].get("sha256") == edition["sha256"] and
             body["csv"].get("bytes") == edition["bytes"], "WORKBOOK_SELECTION",
             "The selected worksheet must match the complete retained CSV edition.")
        by_source.setdefault(source_id, []).append((value, body))
        found[value["id"]] = value
    for document_id, selection_id in active.items():
        need(document_id in documents and (selection_id is None or selection_id in found and found[selection_id]["documentId"] == document_id),
             "WORKBOOK_SELECTION", "Choose an original workbook selection for its own source document.")
    for source_id, source in originals.items():
        with opened(source) as (actual, workbook):
            need(source.get("id") == actual["id"] and source.get("description") == actual["description"],
                 "WORKBOOK_SOURCE", "The retained workbook description differs from its original sheets and stored values.")
            decoder = source.get("decoder")
            need(isinstance(decoder, dict) and decoder.get("path") == READER_PATH and
                 decoder.get("parser") == reader().PARSER and HASH.fullmatch(str(decoder.get("sha256", ""))),
                 "WORKBOOK_READER", "Retain the source workbook's original reader identity.")
            for value, body in by_source.get(source_id, []):
                replay = projection_body(projection_from_open(actual, workbook, body.get("mapping")))
                original_decoder = body.get("decoder")
                need(isinstance(original_decoder, dict) and original_decoder.get("path") == READER_PATH and
                     original_decoder.get("parser") == reader().PARSER and HASH.fullmatch(str(original_decoder.get("sha256", ""))),
                     "WORKBOOK_READER", "Retain the selected workbook reader identity.")
                # A compatible maintained reader may have a new code hash. Its
                # exact selection, saved values, cell map and output must agree.
                replay["decoder"] = original_decoder
                need(replay == body, "WORKBOOK_REPLAY_CHANGED",
                     "The complete worksheet selection differs when replayed from its original workbook. Review a new source selection before saving.")


def dispatch(request):
    need(isinstance(request, dict), "WORKBOOK_REQUEST", "Send one complete workbook operation.")
    action = request.get("action")
    if action == "inspect":
        return inspect_workbook(request)
    if action == "project":
        return project_workbook(request)
    if action == "validate":
        from source_tables import validate_source_tables
        validate_source_tables(request.get("retained"))
        return {"valid": True}
    raise WorkbookInputError("WORKBOOK_OPERATION", "Choose inspect, project or validate.")


def error_body(error):
    details = getattr(error, "details", None)
    message = str(error)
    if isinstance(details, dict) and isinstance(details.get("issues"), list):
        message += " " + " ".join(str(x.get("cell")) + " (" + str(x.get("field")) + "): " + str(x.get("message"))
                                 for x in details["issues"])
    return {"code": getattr(error, "code", "WORKBOOK_INPUT"), "message": message,
            **({"details": details} if details is not None else {})}


def write_http(handler, path, body):
    routes = {"/api/source-tables/workbook/inspect": "inspect", "/api/source-tables/workbook/project": "project"}
    if path not in routes:
        return False
    try:
        result = dispatch({**body, "action": routes[path]})
        handler.send(200, result)
    except WorkbookInputError as exc:
        handler.send(exc.status, {"error": error_body(exc)})
    return True


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_BOOK_BYTES + 1)
        need(len(raw) <= MAX_BOOK_BYTES, "WORKBOOK_CAPACITY", "The complete workbook request exceeds 32 MiB.")
        value = json.loads(raw, parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()))
        result = dispatch(value)
        sys.stdout.buffer.write(packed(result))
        return 0
    except Exception as exc:
        sys.stderr.buffer.write(packed({"error": error_body(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
