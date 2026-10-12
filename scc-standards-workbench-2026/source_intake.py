"""Source-preserving discovery, relationship review and SQL Server handover.

No network, database writes, spreadsheet evaluation or implicit entity matching.
All analytical cell values are exact text or None; original bytes are retained by
the caller. XLSX date/zero-padding interpretations have explicit cell annotations.
"""

from __future__ import annotations

import codecs
import csv
import hashlib
import io
import json
import posixpath
import re
import zipfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN
from itertools import combinations
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET


SCHEMA = "nekcv.discovery-intake/v1"
MAX_BYTES = 32 * 1024 * 1024
MAX_XML_BYTES = 96 * 1024 * 1024
MAX_ROWS = 100_000
MAX_COLUMNS = 512
MAX_CELLS = 2_000_000
EXAMPLE_LIMIT = 12
NORMALIZATIONS = ("exact", "trim", "casefold", "trim_casefold")
_INTEGER = re.compile(r"^[+-]?(?:0|[1-9][0-9]*)$")
_NUMBER = re.compile(r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$")
_DATE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
_DATETIME = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$")
_DATE_FORMATS = {14: "mm-dd-yy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yy h:mm", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0"}


class IntakeError(ValueError):
    """An actionable source or mapping input error."""


class _JsonNumber(str):
    """A JSON number token, retained without binary floating-point conversion."""


def _digest(data):
    return hashlib.sha256(data).hexdigest()


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _text(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, _JsonNumber):
        return str(value)
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError as exc:
            raise IntakeError("A source string contains an unpaired Unicode surrogate.") from exc
        return value
    return _lossless_json(value)


def _lossless_json(value):
    if isinstance(value, _JsonNumber):
        return str(value)
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + _lossless_json(v) for k, v in value.items()) + "}"
    if isinstance(value, list):
        return "[" + ",".join(_lossless_json(v) for v in value) + "]"
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def _pointer_part(value):
    return str(value).replace("~", "~0").replace("/", "~1")


def _decode(raw, encoding=None):
    if encoding is None:
        encoding = ("utf-32" if raw.startswith((codecs.BOM_UTF32_LE, codecs.BOM_UTF32_BE)) else
                    "utf-16" if raw.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)) else "utf-8-sig")
    try:
        return raw.decode(encoding), codecs.lookup(encoding).name
    except (UnicodeError, LookupError) as exc:
        raise IntakeError("Cannot decode the source. Select its actual encoding (for example utf-8 or cp1252); no replacement characters were inserted.") from exc


def _header_row(options):
    value = options.get("header_row", 1)
    if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 1):
        raise IntakeError("header_row must be a positive 1-based record/worksheet row or null for generated headers.")
    return value


def _columns(headers, width, warnings):
    cols = []
    seen = Counter()
    for index in range(width):
        original = headers[index] if index < len(headers) else None
        name = str(original) if original is not None else ""
        seen[name] += 1
        if not name.strip():
            warnings.append({"code": "blank_header", "column": index + 1, "message": "Blank source header retained with a distinct column key."})
        elif seen[name] > 1:
            warnings.append({"code": "duplicate_header", "column": index + 1, "name": name, "message": "Duplicate source header retained; use column keys for mappings."})
        cols.append({"key": f"c{index + 1:04d}", "name": name, "source_position": index + 1})
    return cols


def _table(source_id, ordinal, name, headers, values, origins, warnings, annotations=None):
    width = max([len(headers)] + [len(row) for row in values], default=0)
    if width > MAX_COLUMNS or len(values) > MAX_ROWS or width * len(values) > MAX_CELLS:
        raise IntakeError(f"Source table exceeds this discovery workspace's {MAX_ROWS:,}-row, {MAX_COLUMNS}-column or {MAX_CELLS:,}-cell intake limit. Export a declared partition; no rows were silently sampled.")
    if not width:
        raise IntakeError(f"Table {name!r} contains no columns.")
    columns = _columns(headers, width, warnings)
    rows = [{column["key"]: _text(row[i]) if i < len(row) else None for i, column in enumerate(columns)} for row in values]
    table = {"id": f"{source_id}:t{ordinal}", "source_id": source_id, "name": str(name), "columns": columns, "rows": rows,
             "row_origins": origins, "cell_annotations": annotations or [], "warnings": warnings}
    table["profile"] = profile_table(table)
    return table


def _csv_tables(raw, filename, options, source_id):
    text, encoding = _decode(raw, options.get("encoding"))
    delimiter = options.get("delimiter")
    warnings = []
    if delimiter is None:
        if filename.lower().endswith(".tsv"):
            delimiter = "\t"
        else:
            try:
                delimiter = csv.Sniffer().sniff(text[:65536], delimiters=",;\t|").delimiter
            except csv.Error:
                delimiter = ","
                warnings.append({"code": "delimiter_default", "message": "Delimiter could not be inferred; comma selected. Reimport with an explicit delimiter if needed."})
    if not isinstance(delimiter, str) or len(delimiter) != 1 or delimiter in ('"', "\r", "\n", "\0"):
        raise IntakeError("CSV delimiter must be one non-newline character, excluding the quote character.")
    header = _header_row(options)
    records, origins = [], []
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True)
    previous = 0
    try:
        for record_no, row in enumerate(reader, 1):
            records.append(row)
            origins.append({"record": record_no, "line_start": previous + 1, "line_end": reader.line_num})
            previous = reader.line_num
            if len(records) > MAX_ROWS + (header or 0) or len(row) > MAX_COLUMNS:
                raise IntakeError("CSV exceeds the discovery intake row or column limit; export a declared partition.")
    except csv.Error as exc:
        raise IntakeError(f"CSV parsing failed near physical line {reader.line_num}: {exc}. Check delimiter, quoting and long-field exports.") from exc
    if not records:
        raise IntakeError("CSV contains no records.")
    if header is not None and header > len(records):
        raise IntakeError("Selected header_row is beyond the final CSV record.")
    headers = records[header - 1] if header else [f"column_{i + 1}" for i in range(max(map(len, records)))]
    values, row_origins = (records[header:], origins[header:]) if header else (records, origins)
    widths = Counter(map(len, values))
    if any(width != len(headers) for width in widths):
        warnings.append({"code": "ragged_rows", "header_columns": len(headers), "observed_widths": dict(widths), "message": "Short rows are represented by nulls; extra fields retain distinct generated columns."})
    return [_table(source_id, 1, PurePosixPath(filename).stem or "CSV", headers, values, row_origins, warnings)], {"encoding": encoding, "delimiter": delimiter, "header_row": header}


def _json_tables(raw, filename, options, source_id):
    text, encoding = _decode(raw, options.get("encoding"))
    duplicates = []
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                duplicates.append(key)
            result[key] = value
        return result
    try:
        document = json.loads(text, parse_int=_JsonNumber, parse_float=_JsonNumber,
                              parse_constant=lambda x: (_ for _ in ()).throw(IntakeError(f"Non-standard JSON number {x} is not accepted.")), object_pairs_hook=pairs)
    except (json.JSONDecodeError, RecursionError) as exc:
        raise IntakeError(f"Invalid JSON: {exc}") from exc
    if duplicates:
        raise IntakeError("Duplicate JSON object members cannot be mapped without loss: " + ", ".join(repr(x) for x in duplicates[:EXAMPLE_LIMIT]))
    path = options.get("records_path")
    warnings = []
    if path is None:
        if isinstance(document, dict) and isinstance(document.get("features"), list):
            path = "/features"
        elif isinstance(document, dict) and isinstance(document.get("records"), list):
            path = "/records"
        elif isinstance(document, dict) and isinstance(document.get("data"), list):
            path = "/data"
        else:
            path = ""
    if not isinstance(path, str) or (path and not path.startswith("/")):
        raise IntakeError("records_path must be a JSON Pointer, for example /features or /records; use an empty string for the root.")
    records = document
    try:
        for token in path.split("/")[1:] if path else []:
            token = token.replace("~1", "/").replace("~0", "~")
            records = records[int(token)] if isinstance(records, list) else records[token]
    except (KeyError, IndexError, ValueError, TypeError) as exc:
        raise IntakeError("records_path does not identify a value in this JSON source.") from exc
    if isinstance(records, dict):
        records = [records]
        root_object = True
    else:
        root_object = False
    if not isinstance(records, list):
        raise IntakeError("JSON records must be an array or an object. Select the records array using records_path.")
    if not records:
        raise IntakeError("Selected JSON records array is empty.")
    if len(records) > MAX_ROWS:
        raise IntakeError("JSON exceeds the discovery intake row limit; export a declared partition.")
    flattened, names, seen, row_origins, annotations = [], [], set(), [], []
    def flatten(value, prefix=""):
        if isinstance(value, dict) and value:
            result = {}
            for key, nested in value.items():
                result.update(flatten(nested, prefix + "/" + _pointer_part(key)))
            return result
        return {prefix or "/value": value}
    for index, record in enumerate(records):
        origin = path if root_object else path + "/" + str(index)
        flat = flatten(record)
        for field, value in flat.items():
            if field not in seen:
                names.append(field)
                seen.add(field)
            if not isinstance(value, str) or isinstance(value, _JsonNumber):
                kind = "number" if isinstance(value, _JsonNumber) else "boolean" if isinstance(value, bool) else "null" if value is None else "nested_json"
                annotation = {"row_index": index, "field_path": field, "source_path": origin + field, "source_type": kind}
                if kind == "nested_json":
                    annotation["message"] = "Nested array/empty object preserved as JSON text, not exploded."
                annotations.append(annotation)
        if len(names) > MAX_COLUMNS:
            raise IntakeError("Flattened JSON exceeds the discovery column limit; choose a more specific records_path.")
        flattened.append(flat)
        row_origins.append({"record": index + 1, "json_pointer": origin})
    values = [[flat.get(name) for name in names] for flat in flattened]
    table = _table(source_id, 1, PurePosixPath(filename).stem or "JSON", names, values, row_origins, warnings, annotations)
    for column, field in zip(table["columns"], names):
        column["source_path"] = field
    column_keys = {column["source_path"]: column["key"] for column in table["columns"]}
    for annotation in annotations:
        annotation["column_key"] = column_keys[annotation.pop("field_path")]
    for index, flat in enumerate(flattened):
        missing = [column_keys[name] for name in names if name not in flat]
        if missing:
            row_origins[index]["missing_columns"] = missing
    table["json_shape"] = "object" if root_object else "array"
    if isinstance(document, dict) and document.get("exceededTransferLimit") is True:
        table["warnings"].append({"code": "provider_page_incomplete", "message": "Source declares exceededTransferLimit; this is one incomplete provider page, not a complete inventory."})
    return [table], {"encoding": encoding, "records_path": path}


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _rich_text(element):
    values, pending = [], [element]
    while pending:
        node = pending.pop()
        kind = _local(node.tag)
        if kind in ("rPh", "phoneticPr"):
            continue
        if kind == "t":
            values.append(node.text or "")
        else:
            pending.extend(reversed(list(node)))
    return "".join(values)


def _cell_column(reference):
    match = re.fullmatch(r"([A-Za-z]+)([1-9][0-9]*)", reference or "")
    if not match:
        raise IntakeError(f"Invalid XLSX cell coordinate {reference!r}.")
    result = 0
    for char in match.group(1).upper():
        result = result * 26 + ord(char) - 64
    return result - 1, int(match.group(2))


def _format_kind(code, number):
    if number in range(27, 37) or number in range(50, 59):
        return "date"
    stripped = re.sub(r'"[^"]*"|\\.|_.|\*.', "", code.lower())
    if re.search(r"\[(?:h+|m+|s+)\]", stripped):
        return "duration"
    stripped = re.sub(r"\[[^]]*\]", "", stripped)
    if re.search(r"[yd]", stripped):
        return "datetime" if re.search(r"[hs]", stripped) else "date"
    if re.search(r"[hs]", stripped):
        return "time"
    return None


def _excel_value(value, code, number, date1904, annotation):
    kind = _format_kind(code, number)
    if kind and value is not None:
        try:
            serial = Decimal(value)
            if not serial.is_finite():
                return value
            annotation.update({"logical_type": kind, "excel_serial": value, "date_system": "1904" if date1904 else "1900"})
            if kind == "duration":
                annotation["interpretation"] = "Elapsed duration serial retained; not a time of day."
                return value
            days = int(serial // 1)
            if not date1904 and days == 60:
                annotation["warning"] = "excel_fictitious_1900_leap_day"
                return value
            adjusted = days if date1904 or days < 60 else days - 1
            exact_microseconds = (serial - days) * Decimal(86400000000)
            microseconds = int(exact_microseconds.quantize(Decimal(1), rounding=ROUND_HALF_EVEN))
            annotation["interpretation"] = "Excel serial interpreted as ISO calendar text; the original serial and number format are retained."
            if exact_microseconds != Decimal(microseconds):
                annotation["fractional_seconds_rounding"] = "nearest_microsecond_half_even"
            instant = datetime(1904, 1, 1) if date1904 else datetime(1899, 12, 31)
            instant += timedelta(days=adjusted, microseconds=microseconds)
            if kind == "time":
                if days != 0:
                    annotation["warning"] = "time_format_hides_elapsed_days"
                    return value
                return instant.time().isoformat()
            if kind == "date" and not microseconds:
                return instant.date().isoformat()
            return instant.isoformat()
        except (InvalidOperation, ValueError, OverflowError):
            annotation["warning"] = "uninterpretable_excel_date_serial"
            return value
    if value is not None and re.fullmatch(r"0{2,}", code) and re.fullmatch(r"-?[0-9]+", value):
        annotation["logical_type"] = "formatted_identifier"
        annotation["interpretation"] = "Plain zero-padding number format preserved in analytical text."
        return ("-" if value.startswith("-") else "") + value.lstrip("-").zfill(len(code))
    return value


def _xlsx_tables(raw, filename, options, source_id):
    warnings = []
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as exc:
        raise IntakeError("XLSX must be an unencrypted OOXML workbook; legacy .xls needs an explicit CSV/XLSX export.") from exc
    with archive:
        infos = archive.infolist()
        if len({info.filename for info in infos}) != len(infos):
            raise IntakeError("XLSX contains duplicate ZIP member names.")
        if len(infos) > 10000 or sum(info.file_size for info in infos) > MAX_XML_BYTES:
            raise IntakeError("Expanded XLSX exceeds the discovery archive-size limit.")
        if any(info.flag_bits & 1 for info in infos):
            raise IntakeError("Encrypted XLSX cannot be inspected; supply an authorized unencrypted export.")
        names = {info.filename for info in infos}
        def xml(path, required=True):
            if path not in names:
                if required:
                    raise IntakeError(f"XLSX is missing {path}.")
                return None
            data = archive.read(path)
            if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
                raise IntakeError("XLSX XML declarations with DTD/entities are not accepted.")
            try:
                return ET.fromstring(data)
            except ET.ParseError as exc:
                raise IntakeError(f"Invalid XLSX XML in {path}: {exc}") from exc
        workbook = xml("xl/workbook.xml")
        rels = xml("xl/_rels/workbook.xml.rels")
        relationships = {}
        for relationship in rels:
            target = relationship.attrib.get("Target", "")
            if relationship.attrib.get("TargetMode") == "External":
                continue
            path = posixpath.normpath(target.lstrip("/") if target.startswith("/") else "xl/" + target)
            if path.startswith("../") or path == "..":
                raise IntakeError("XLSX relationship escapes the package root.")
            relationships[relationship.attrib.get("Id")] = path
        shared = []
        strings = xml("xl/sharedStrings.xml", required=False)
        if strings is not None:
            for item in strings:
                # Phonetic annotations are not part of the cell's base string.
                shared.append(_rich_text(item))
        formats, styles = dict(_DATE_FORMATS), []
        style_doc = xml("xl/styles.xml", required=False)
        if style_doc is not None:
            for section in style_doc:
                if _local(section.tag) == "numFmts":
                    formats.update({int(child.attrib["numFmtId"]): child.attrib.get("formatCode", "") for child in section})
                elif _local(section.tag) == "cellXfs":
                    styles = [int(child.attrib.get("numFmtId", "0")) for child in section]
        date1904 = any(_local(child.tag) == "workbookPr" and child.attrib.get("date1904") in ("1", "true") for child in workbook)
        header = _header_row(options) if "header_rows" not in options else None
        header_rows = options.get("header_rows", [header] if header else [])
        if not isinstance(header_rows, list) or any(isinstance(row, bool) or not isinstance(row, int) or row < 1 for row in header_rows) or header_rows != sorted(set(header_rows)):
            raise IntakeError("header_rows must be a sorted list of distinct positive worksheet row numbers.")
        if len(header_rows) > 20:
            raise IntakeError("Select at most twenty header rows.")
        if "header_rows" in options and "header_row" in options:
            raise IntakeError("Use header_row or header_rows, not both.")
        for option in ("data_start_row", "data_end_row"):
            if option in options and (isinstance(options[option], bool) or not isinstance(options[option], int) or options[option] < 1):
                raise IntakeError(option + " must be a positive worksheet row number.")
        selected = options.get("sheet")
        if selected is not None and not isinstance(selected, str):
            raise IntakeError("sheet must be an exact worksheet name.")
        sheets = [child for child in workbook.iter() if _local(child.tag) == "sheet"]
        if selected is not None and not any(sheet.attrib.get("name") == selected for sheet in sheets):
            raise IntakeError(f"Worksheet {selected!r} does not exist.")
        result = []
        for ordinal, sheet in enumerate(sheets, 1):
            name = sheet.attrib.get("name", f"Sheet {ordinal}")
            if selected is not None and selected != name:
                continue
            relation_id = next((value for key, value in sheet.attrib.items() if key.endswith("}id")), None)
            path = relationships.get(relation_id)
            if not path:
                raise IntakeError(f"Worksheet {name!r} has no internal relationship target.")
            document = xml(path)
            table_warnings, rows_by_number, annotations = [], {}, []
            formula_count, missing_cache = 0, 0
            for row_node in (node for node in document.iter() if _local(node.tag) == "row"):
                row_number = int(row_node.attrib.get("r", len(rows_by_number) + 1))
                if row_number in rows_by_number:
                    raise IntakeError(f"Worksheet {name!r} repeats row {row_number}.")
                cells = {}
                for cell in (node for node in row_node if _local(node.tag) == "c"):
                    reference = cell.attrib.get("r")
                    index, cell_row = _cell_column(reference)
                    if cell_row != row_number or index in cells:
                        raise IntakeError(f"Worksheet {name!r} has duplicate or inconsistent cell coordinates at {reference}.")
                    if index >= MAX_COLUMNS:
                        raise IntakeError(f"Worksheet {name!r} has data beyond the {MAX_COLUMNS}-column discovery limit; select a smaller export.")
                    kind = cell.attrib.get("t", "n")
                    raw_value = next((node.text for node in cell if _local(node.tag) == "v"), None)
                    formula = next((node for node in cell if _local(node.tag) == "f"), None)
                    style_index = int(cell.attrib.get("s", "0"))
                    if styles and style_index >= len(styles):
                        raise IntakeError(f"Invalid XLSX style reference at {name}!{reference}.")
                    number = styles[style_index] if styles else 0
                    code = formats.get(number, "")
                    annotation = {"sheet": name, "cell": reference, "worksheet_row": row_number, "column_key": f"c{index + 1:04d}", "source_type": kind, "raw_value": raw_value}
                    if kind == "s":
                        try:
                            shared_index = int(raw_value)
                            if shared_index < 0:
                                raise IndexError()
                            value = shared[shared_index]
                        except (TypeError, ValueError, IndexError) as exc:
                            raise IntakeError(f"Invalid shared-string reference at {name}!{reference}.") from exc
                    elif kind == "inlineStr":
                        value = _rich_text(cell)
                    elif kind == "b":
                        if raw_value not in (None, "0", "1"):
                            raise IntakeError(f"Invalid boolean cell at {name}!{reference}.")
                        value = None if raw_value is None else ("true" if raw_value == "1" else "false")
                    else:
                        value = raw_value
                    if code:
                        annotation["number_format"] = code
                    if kind == "n":
                        value = _excel_value(value, code, number, date1904, annotation)
                    if formula is not None:
                        formula_count += 1
                        missing_cache += raw_value is None
                        annotation.update({"formula": formula.text or "", "formula_attributes": dict(formula.attrib), "cached_value_present": raw_value is not None, "calculation": "not_evaluated"})
                    if kind == "e":
                        annotation["warning"] = "spreadsheet_error_cell"
                    if kind not in ("s", "inlineStr") or formula is not None or annotation.get("warning"):
                        annotations.append(annotation)
                    cells[index] = value
                if cells:
                    rows_by_number[row_number] = [cells.get(i) for i in range(max(cells) + 1)]
                    if len(rows_by_number) > MAX_ROWS + max(header_rows, default=0) + 100:
                        raise IntakeError(f"Worksheet {name!r} exceeds the discovery row limit.")
            if not rows_by_number:
                warnings.append({"code": "empty_worksheet", "sheet": name})
                continue
            if any(number not in rows_by_number for number in header_rows):
                raise IntakeError(f"Worksheet {name!r} has no cells in a selected header row; choose its actual header rows or select another sheet.")
            first_data = options.get("data_start_row", max(header_rows, default=0) + 1)
            last_data = options.get("data_end_row", max(rows_by_number))
            if first_data > last_data or any(first_data <= number <= last_data for number in header_rows):
                raise IntakeError("Data row range must be ordered and must not include a selected header row.")
            numbers = sorted(number for number in rows_by_number if first_data <= number <= last_data)
            values = [rows_by_number[number] for number in numbers]
            width = max(map(len, rows_by_number.values()))
            merged = [node.attrib.get("ref") for node in document.iter() if _local(node.tag) == "mergeCell"]
            header_grid = {number: {i: value for i, value in enumerate(rows_by_number[number])} for number in header_rows}
            header_ranges = defaultdict(list)
            if "header_rows" in options:
                for cell_range in merged:
                    parts = cell_range.split(":")
                    if len(parts) != 2:
                        continue
                    start_col, start_row = _cell_column(parts[0])
                    end_col, end_row = _cell_column(parts[1])
                    if end_col >= MAX_COLUMNS or end_col < start_col or end_row < start_row:
                        raise IntakeError("Invalid or excessive merged-header range.")
                    selected_rows = range(start_row, end_row + 1)
                    if all(number in header_grid for number in selected_rows):
                        anchor = header_grid[start_row].get(start_col)
                        for number in selected_rows:
                            for col in range(start_col, end_col + 1):
                                if header_grid[number].get(col) is None:
                                    header_grid[number][col] = anchor
                                header_ranges[col].append({"range": cell_range, "anchor_cell": parts[0], "value": anchor})
            headers = []
            if header_rows:
                for col in range(width):
                    labels = []
                    for number in header_rows:
                        value = header_grid[number].get(col)
                        if value is not None and value not in labels:
                            labels.append(value)
                    headers.append(" / ".join(labels))
            else:
                headers = [f"column_{i + 1}" for i in range(width)]
            origins = [{"record": i + 1, "sheet": name, "worksheet_row": number} for i, number in enumerate(numbers)]
            number_to_index = {number: i for i, number in enumerate(numbers)}
            for annotation in annotations:
                annotation["row_index"] = number_to_index.get(annotation["worksheet_row"])
                if annotation["worksheet_row"] in header_rows:
                    annotation["header"] = True
            if sheet.attrib.get("state", "visible") != "visible":
                table_warnings.append({"code": "hidden_worksheet", "state": sheet.attrib["state"], "message": "Hidden worksheet data is included explicitly."})
            if formula_count:
                table_warnings.append({"code": "formula_cache", "formula_cells": formula_count, "missing_cached_values": missing_cache, "message": "Formulas were not evaluated. Retained cached values may be stale; missing caches remain null."})
            for code, count in Counter(annotation["warning"] for annotation in annotations if annotation.get("warning")).items():
                table_warnings.append({"code": code, "cell_count": count, "message": "Original cell values and explanatory annotations are retained; inspect them before assigning a business type."})
            if merged:
                table_warnings.append({"code": "merged_cells", "ranges": merged, "message": "Data cells are never filled down/across. Explicit multirow headers use declared source merge spans with retained anchors." if "header_rows" in options else "Only original populated cells are used; merged values are not filled down or across."})
            table = _table(source_id, ordinal, name, headers, values, origins, table_warnings, annotations)
            table["worksheet_path"] = path
            table["date_system"] = "1904" if date1904 else "1900"
            table["row_selection"] = {"header_rows": header_rows, "data_start_row": first_data, "data_end_row": last_data}
            table["excluded_rows"] = [{"worksheet_row": number, "role": "header" if number in header_rows else "outside_data_range", "cells": row} for number, row in sorted(rows_by_number.items()) if number not in number_to_index]
            for index, column in enumerate(table["columns"]):
                column["header_origins"] = [{"sheet": name, "worksheet_row": number, "column_position": index + 1, "original_value": rows_by_number[number][index] if index < len(rows_by_number[number]) else None} for number in header_rows]
                if index in header_ranges:
                    column["header_merge_spans"] = header_ranges[index]
            result.append(table)
        if not result:
            raise IntakeError("Selected workbook contains no nonempty tabular worksheets.")
        if any("externalLink" in name for name in names):
            warnings.append({"code": "external_workbook_links", "message": "Workbook external links were not opened or refreshed."})
        if any(name.lower().endswith("vbaproject.bin") for name in names):
            warnings.append({"code": "workbook_macros", "message": "Workbook macros were not executed."})
        return result, {"sheet": selected, "header_rows": header_rows, "table_ranges": {table["id"]: table["row_selection"] for table in result}, "date_system": "1904" if date1904 else "1900"}, warnings


def parse_source(raw: bytes, filename: str, options: dict | None = None) -> dict:
    """Parse a full declared snapshot. Row values are text or null, never floats.

    Options: format; CSV encoding/delimiter/header_row; JSON encoding/records_path
    (JSON Pointer); XLSX sheet/header_row or header_rows, data_start_row and
    data_end_row. A null header_row generates names. Explicit multirow XLSX
    headers interpret only declared header merge spans and retain their anchors.
    Source IDs bind raw SHA-256, original filename, format and parsing options.
    """
    if not isinstance(raw, bytes) or not raw:
        raise IntakeError("Supply a nonempty byte string as the original source.")
    if len(raw) > MAX_BYTES:
        raise IntakeError(f"Source exceeds the {MAX_BYTES // 1048576}-MiB discovery intake limit; export a declared partition.")
    if not isinstance(filename, str) or not filename:
        raise IntakeError("Supply the original source filename.")
    options = dict(options or {})
    suffix = PurePosixPath(filename).suffix.lower()
    format_name = options.pop("format", None) or {".csv": "csv", ".tsv": "csv", ".json": "json", ".geojson": "json", ".xlsx": "xlsx", ".xlsm": "xlsx"}.get(suffix)
    if format_name not in ("csv", "json", "xlsx"):
        raise IntakeError("Select CSV, JSON or XLSX; legacy XLS and arbitrary ZIP files are not inferred as workbooks.")
    allowed = {"csv": {"encoding", "delimiter", "header_row"}, "json": {"encoding", "records_path"}, "xlsx": {"sheet", "header_row", "header_rows", "data_start_row", "data_end_row"}}[format_name]
    unknown = set(options) - allowed
    if unknown:
        raise IntakeError("Unknown parsing options for " + format_name + ": " + ", ".join(sorted(unknown)))
    if format_name == "csv" or format_name == "xlsx" and "header_rows" not in options:
        options["header_row"] = _header_row(options)
    identity_options = dict(options)
    if format_name == "csv" and "delimiter" not in options and suffix == ".tsv":
        identity_options["delimiter"] = "\t"
    content_sha = _digest(raw)
    source_id = "src_" + _digest(_json({"parser_schema": SCHEMA, "sha256": content_sha, "filename": filename, "format": format_name, "options": identity_options}).encode())
    warnings = []
    if format_name == "csv":
        tables, resolved = _csv_tables(raw, filename, options, source_id)
    elif format_name == "json":
        tables, resolved = _json_tables(raw, filename, options, source_id)
    else:
        tables, resolved, warnings = _xlsx_tables(raw, filename, options, source_id)
    for table in tables:
        table["source_sha256"] = content_sha
    return {"schema": SCHEMA, "id": source_id, "sha256": content_sha, "byte_length": len(raw), "filename": filename, "format": format_name,
            "options": {"format": format_name, **identity_options}, "resolved_options": resolved, "tables": tables, "warnings": warnings,
            "completeness": "all_rows_in_declared_selection", "limits": {"bytes": MAX_BYTES, "rows_per_table": MAX_ROWS, "columns_per_table": MAX_COLUMNS, "cells_per_table": MAX_CELLS}}


def _kind(value):
    if value is None:
        return "null"
    if not value.strip():
        return "blank"
    if value != value.strip():
        return "text"
    if value.lower() in ("true", "false"):
        return "boolean"
    if re.fullmatch(r"[+-]?0[0-9]+", value):
        return "text"
    if _INTEGER.fullmatch(value):
        return "integer"
    if _NUMBER.fullmatch(value):
        try:
            if Decimal(value).is_finite():
                return "decimal"
        except InvalidOperation:
            pass
    if _DATE.fullmatch(value):
        try:
            date.fromisoformat(value)
            return "date"
        except ValueError:
            pass
    if _DATETIME.fullmatch(value):
        try:
            instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return "datetimeoffset" if instant.tzinfo else "datetime"
        except ValueError:
            pass
    return "text"


def _row_ref(table, index):
    origin = table.get("row_origins", [])
    return {"table_id": table["id"], "row_index": index, "row_number": index + 1, "origin": origin[index] if index < len(origin) else {"record": index + 1}}


def _suggest_type(name, values, kinds, utf16_length):
    text_type = "NVARCHAR(MAX)" if utf16_length > 4000 else f"NVARCHAR({max(1, utf16_length)})"
    if not values:
        return "NVARCHAR(MAX)", "No populated values; type remains unconfirmed."
    if re.search(r"(?:^|[/_\s])(?:id|geoid|towngeoid|zip|postal|fips|code|identifier)(?:$|[_\s])", name, re.I):
        return text_type, "Identifier-like field name; preserve lexical spelling until a field owner decides otherwise."
    if kinds <= {"integer", "decimal"}:
        if any("e" in value.lower() for value in values):
            return text_type, "Scientific notation retained as text; explicit normalization requires review."
        decimals = [Decimal(value) for value in values]
        scale = max(max(0, -value.as_tuple().exponent) for value in decimals)
        integer_digits = max(max(0, len(value.as_tuple().digits) + value.as_tuple().exponent) for value in decimals)
        precision = max(1, integer_digits + scale)
        if kinds == {"integer"} and min(decimals) >= -(2 ** 63) and max(decimals) <= 2 ** 63 - 1:
            return "BIGINT", "All observed populated values are exact signed 64-bit integer text."
        if precision <= 38:
            return f"DECIMAL({precision},{scale})", "Precision and scale cover the observed decimal spellings; no float conversion."
        return text_type, "Observed exact precision exceeds SQL Server DECIMAL(38); retain text."
    if kinds == {"boolean"}:
        return "BIT", "Observed populated values are true/false."
    if kinds == {"date"}:
        return "DATE", "Observed populated values are valid ISO dates."
    if kinds in ({"datetime"}, {"datetimeoffset"}):
        if any(len(re.search(r"\.([0-9]+)", value).group(1)) > 7 for value in values if re.search(r"\.([0-9]+)", value)):
            return text_type, "Timestamp precision exceeds SQL Server's seven fractional digits; retain text."
        return ("DATETIMEOFFSET(7)" if "datetimeoffset" in kinds else "DATETIME2(7)"), "ISO timestamps retain the presence or absence of an explicit offset."
    return text_type, "Preserve exact lexical values; inferred observations are not approved business types."


def profile_table(table: dict) -> dict:
    """Profile all retained rows; a key candidate is an observation, not approval."""
    rows, columns = table["rows"], table["columns"]
    profiles, candidate_keys, complete_columns = [], [], []
    row_counts = Counter(tuple(row.get(column["key"]) for column in columns) for row in rows)
    for column in columns:
        key = column["key"]
        values = [row.get(key) for row in rows]
        counts = Counter(values)
        populated = [value for value in values if value is not None and value.strip()]
        kind_counts = Counter(_kind(value) for value in values)
        kinds = set(kind_counts) - {"null", "blank"}
        max_length = max(map(len, populated), default=0)
        max_utf16 = max((len(value.encode("utf-16-le")) // 2 for value in populated), default=0)
        sql_type, rationale = _suggest_type(column["name"], populated, kinds, max_utf16)
        distinct = len(set(populated))
        candidate = bool(rows) and len(populated) == len(rows) and distinct == len(rows)
        if candidate:
            candidate_keys.append([key])
        if len(populated) == len(rows) and rows:
            complete_columns.append(key)
        issues = []
        predicates = {
            "surrounding_whitespace": lambda v: v is not None and v != v.strip(),
            "leading_zero_identifier": lambda v: v is not None and bool(re.fullmatch(r"[+-]?0[0-9]+", v)),
            "control_characters": lambda v: v is not None and any(ord(c) < 32 and c not in "\n\r\t" for c in v),
            "ambiguous_date_text": lambda v: v is not None and bool(re.fullmatch(r"[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4}", v)),
            "spreadsheet_formula_text": lambda v: v is not None and v.lstrip().startswith(("=", "+", "-", "@")) and not _NUMBER.fullmatch(v.strip()),
        }
        for code, predicate in predicates.items():
            indices = [index for index, value in enumerate(values) if predicate(value)]
            if indices:
                issues.append({"code": code, "count": len(indices), "examples": [{**_row_ref(table, index), "value": values[index]} for index in indices[:EXAMPLE_LIMIT]]})
        if len(kinds) > 1 and not kinds <= {"integer", "decimal"}:
            issues.append({"code": "mixed_lexical_types", "types": sorted(kinds)})
        profile = {"column_key": key, "name": column["name"], "row_count": len(rows), "null_count": counts[None], "blank_count": kind_counts["blank"],
                   "populated_count": len(populated), "distinct_nonempty": distinct, "duplicate_excess": len(populated) - distinct,
                   "is_candidate_key": candidate, "type_counts": dict(kind_counts), "inferred_type": next(iter(kinds)) if len(kinds) == 1 else ("decimal" if kinds and kinds <= {"integer", "decimal"} else "mixed" if kinds else "unknown"),
                   "max_length": max_length, "max_utf16_units": max_utf16, "suggested_sql_type": sql_type, "type_rationale": rationale,
                   "top_values": [{"value": value, "count": count} for value, count in counts.most_common(EXAMPLE_LIMIT)], "issues": issues}
        if kinds and kinds <= {"integer", "decimal"}:
            numbers = [Decimal(value) for value in populated]
            profile["numeric_range"] = {"minimum": str(min(numbers)), "maximum": str(max(numbers))}
        profiles.append(profile)
    # Pair checks are discovery assistance, with the searched space stated explicitly.
    pair_space = [key for key in complete_columns if [key] not in candidate_keys][:20]
    composite = []
    for pair in combinations(pair_space, 2):
        if len({tuple(row[key] for key in pair) for row in rows}) == len(rows):
            composite.append(list(pair))
    return {"row_count": len(rows), "column_count": len(columns), "columns": profiles, "candidate_keys": candidate_keys,
            "candidate_composite_keys": composite[:20], "composite_search": {"width": 2, "columns_searched": pair_space, "reported_limit": 20},
            "duplicate_row_excess": sum(count - 1 for count in row_counts.values()), "duplicate_row_groups": sum(count > 1 for count in row_counts.values()),
            "scope": "complete_declared_table", "key_status": "observed_candidates_require_owner_review"}


def _column_keys(table, keys):
    if not isinstance(keys, (list, tuple)) or not keys or len(keys) > 8 or len(set(keys)) != len(keys):
        raise IntakeError("Join keys must be one to eight distinct column keys.")
    existing = {column["key"] for column in table["columns"]}
    if any(key not in existing for key in keys):
        raise IntakeError("Join references a column key absent from the selected table.")
    return list(keys)


def inspect_relationship(left: dict, right: dict, left_keys: list, right_keys: list,
                         normalization: str = "exact", crosswalk: list | None = None) -> dict:
    """Inspect a proposed join without materializing it or modifying source rows.

    Explicit crosswalk entries are {left:[values],right:[values],reason:...}.
    They apply only to this report; many-to-one consequences remain visible.
    """
    left_keys, right_keys = _column_keys(left, left_keys), _column_keys(right, right_keys)
    if len(left_keys) != len(right_keys):
        raise IntakeError("Left and right composite keys must have equal arity.")
    if normalization not in NORMALIZATIONS:
        raise IntakeError("Choose a named normalization: " + ", ".join(NORMALIZATIONS))
    def norm(value):
        value = value.strip() if normalization in ("trim", "trim_casefold") else value
        return value.casefold() if normalization in ("casefold", "trim_casefold") else value
    aliases = {}
    for item in crosswalk or []:
        a, b = item.get("left"), item.get("right")
        if not isinstance(a, list) or not isinstance(b, list) or len(a) != len(left_keys) or len(b) != len(right_keys) or any(not isinstance(v, str) or not v.strip() for v in a + b):
            raise IntakeError("Each explicit crosswalk requires nonblank string tuples matching the join-key arity.")
        a, b = tuple(map(norm, a)), tuple(map(norm, b))
        if a in aliases and aliases[a] != b:
            raise IntakeError("One left crosswalk key cannot map to different right keys.")
        aliases[a] = b
    def index(table, keys, apply_aliases):
        groups, missing, original_groups = defaultdict(list), [], defaultdict(set)
        for row_index, row in enumerate(table["rows"]):
            raw_key = tuple(row.get(key) for key in keys)
            if any(value is None or not value.strip() for value in raw_key):
                missing.append(row_index)
                continue
            key = tuple(map(norm, raw_key))
            key = aliases.get(key, key) if apply_aliases else key
            groups[key].append(row_index)
            original_groups[key].add(raw_key)
        return groups, missing, original_groups
    li, ln, lo = index(left, left_keys, True)
    ri, rn, ro = index(right, right_keys, False)
    shared = set(li) & set(ri)
    left_many, right_many = any(len(li[key]) > 1 for key in shared), any(len(ri[key]) > 1 for key in shared)
    cardinality = ("many" if left_many else "one") + "_to_" + ("many" if right_many else "one") if shared else "no_matches"
    def side(table, groups, missing, originals, other):
        unmatched = [index for key, indices in groups.items() if key not in other for index in indices]
        duplicate_groups = [(key, indices) for key, indices in groups.items() if len(indices) > 1]
        return {"table_id": table["id"], "source_id": table.get("source_id"), "row_count": len(table["rows"]),
                "distinct_join_keys": len(groups), "missing_key_rows": len(missing), "matched_rows": sum(len(indices) for key, indices in groups.items() if key in other),
                "unmatched_rows": len(unmatched), "unmatched_examples": [_row_ref(table, index) | {"values": table["rows"][index]} for index in unmatched[:EXAMPLE_LIMIT]],
                "missing_key_examples": [_row_ref(table, index) for index in missing[:EXAMPLE_LIMIT]],
                "duplicate_key_groups": len(duplicate_groups), "duplicate_key_examples": [{"key": list(key), "count": len(indices), "rows": [_row_ref(table, index) for index in indices[:EXAMPLE_LIMIT]]} for key, indices in duplicate_groups[:EXAMPLE_LIMIT]],
                "normalization_collisions": [{"normalized_key": list(key), "original_keys": [list(raw) for raw in sorted(raws)]} for key, raws in originals.items() if len(raws) > 1][:EXAMPLE_LIMIT]}
    pairs = sum(len(li[key]) * len(ri[key]) for key in shared)
    return {"schema": "nekcv.relationship-review/v1", "left_keys": left_keys, "right_keys": right_keys, "normalization": normalization,
            "crosswalk": crosswalk or [], "crosswalk_status": "explicit_input_not_source_rewrite", "matched_distinct_keys": len(shared),
            "observed_cardinality": cardinality, "inner_join_rows": pairs,
            "left_join_rows": pairs + sum(len(indices) for key, indices in li.items() if key not in ri) + len(ln),
            "right_join_rows": pairs + sum(len(indices) for key, indices in ri.items() if key not in li) + len(rn),
            "left": side(left, li, ln, lo, ri), "right": side(right, ri, rn, ro, li),
            "multiplicity_examples": [{"key": list(key), "left_rows": len(li[key]), "right_rows": len(ri[key]), "joined_rows": len(li[key]) * len(ri[key])} for key in sorted(shared) if len(li[key]) > 1 or len(ri[key]) > 1][:EXAMPLE_LIMIT],
            "null_policy": "Any null or whitespace-only key component is excluded from equality matching.", "approval": "operator_decision_required"}


def resolve_relationship(left: dict, right: dict, left_keys: list, right_keys: list,
                         decisions: list | None = None, normalization: str = "exact",
                         expected_cardinality: str = "one_to_one") -> dict:
    """Apply explicit row-specific crosswalk decisions to immutable source rows.

    A decision contains left:{source_id,table_id,row_index}, right:[same refs],
    rationale and optional evidence_refs. No targets is an explicit exclusion;
    several targets is an explicit one-to-many mapping, not a numeric allocation.
    Raw observed counts are retained separately from this proposed/resolved view.
    """
    observed = inspect_relationship(left, right, left_keys, right_keys, normalization)
    if expected_cardinality not in ("one_to_one", "many_to_one", "one_to_many", "many_to_many"):
        raise IntakeError("Choose an expected relationship cardinality: one_to_one, many_to_one, one_to_many or many_to_many.")
    left_keys, right_keys = list(left_keys), list(right_keys)
    if decisions is None:
        decisions = []
    if not isinstance(decisions, list):
        raise IntakeError("Relationship decisions must be a list of source-bound row decisions.")
    def norm(value):
        value = value.strip() if normalization in ("trim", "trim_casefold") else value
        return value.casefold() if normalization in ("casefold", "trim_casefold") else value
    def row_key(row, keys):
        raw = [row.get(key) for key in keys]
        return None if any(value is None or not value.strip() for value in raw) else tuple(map(norm, raw))
    def check_ref(ref, table):
        if not isinstance(ref, dict) or ref.get("source_id") != table.get("source_id") or ref.get("table_id") != table["id"]:
            raise IntakeError("Crosswalk row identity does not belong to the selected immutable source and table.")
        index = ref.get("row_index")
        if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < len(table["rows"]):
            raise IntakeError("Crosswalk row_index must identify an existing original row.")
        return index
    def full_ref(table, index):
        return {"source_id": table.get("source_id"), "source_sha256": table.get("source_sha256"), **_row_ref(table, index)}
    indexed = {}
    for decision in decisions:
        if not isinstance(decision, dict):
            raise IntakeError("Each crosswalk decision must be an object.")
        index = check_ref(decision.get("left"), left)
        if index in indexed:
            raise IntakeError("A left source row has repeated decisions. Replace its existing decision explicitly.")
        targets = decision.get("right")
        rationale = decision.get("rationale")
        if not isinstance(targets, list) or not isinstance(rationale, str) or not rationale.strip():
            raise IntakeError("A crosswalk requires a right-row list and a nonblank rationale; an empty list is an explicit exclusion.")
        target_indices = [check_ref(ref, right) for ref in targets]
        if len(set(target_indices)) != len(target_indices):
            raise IntakeError("A crosswalk decision repeats the same right row.")
        evidence = decision.get("evidence_refs", [])
        if not isinstance(evidence, list) or any(not isinstance(item, str) or not item.strip() for item in evidence):
            raise IntakeError("evidence_refs must be a list of nonblank source references.")
        indexed[index] = {"targets": target_indices, "rationale": rationale, "evidence_refs": evidence}
    right_index = defaultdict(list)
    for index, row in enumerate(right["rows"]):
        key = row_key(row, right_keys)
        if key is not None:
            right_index[key].append(index)
    active_left = Counter()
    for index, row in enumerate(left["rows"]):
        if index in indexed and not indexed[index]["targets"]:
            continue
        key = row_key(row, left_keys)
        if key is not None:
            active_left[key] += 1
    rows, links, unresolved, excluded = [], [], [], []
    target_use = defaultdict(list)
    for index, row in enumerate(left["rows"]):
        identity = full_ref(left, index)
        key = row_key(row, left_keys)
        candidates = right_index.get(key, []) if key is not None else []
        decision = indexed.get(index)
        if decision is not None:
            targets = decision["targets"]
            status = "explicit_mapping" if targets else "explicit_exclusion"
            rationale, evidence = decision["rationale"], decision["evidence_refs"]
        elif key is None:
            targets, status, rationale, evidence = [], "unresolved_missing_key", "One or more key components are missing.", []
        elif active_left[key] > 1 and expected_cardinality not in ("many_to_one", "many_to_many"):
            targets, status, rationale, evidence = [], "unresolved_duplicate_left_key", "Multiple active left rows share this key; record a row-specific decision or explicit exclusion.", []
        elif len(candidates) == 1:
            targets, status, rationale, evidence = candidates, "proposed_unique_match", "One observed right key match within the declared cardinality; business identity approval remains with the operator.", []
        elif not candidates:
            targets, status, rationale, evidence = [], "unresolved_no_match", "No observed right key match; choose explicit source-bound targets or exclusion.", []
        elif expected_cardinality in ("one_to_many", "many_to_many"):
            targets, status, rationale, evidence = candidates, "proposed_declared_cardinality", "All exact right key matches retained under the explicitly declared one-to-many cardinality; no numeric allocation is inferred.", []
        else:
            targets, status, rationale, evidence = [], "unresolved_multiple_right_matches", "The right key is not unique; select exact right rows with a rationale.", []
        entry = {"left": identity, "left_key": list(key) if key is not None else None, "left_values": row,
                 "status": status, "right": [full_ref(right, target) for target in targets], "candidate_right": [full_ref(right, target) for target in candidates],
                 "rationale": rationale, "evidence_refs": evidence}
        rows.append(entry)
        if status.startswith("unresolved_"):
            unresolved.append(entry)
        elif status == "explicit_exclusion":
            excluded.append(entry)
        for target in targets:
            target_use[target].append(index)
            links.append({"left": identity, "right": full_ref(right, target), "left_values": row, "right_values": right["rows"][target],
                          "status": status, "rationale": rationale, "evidence_refs": evidence,
                          "allocation": "none_inferred"})
    unmapped = [{**full_ref(right, index), "values": row} for index, row in enumerate(right["rows"]) if index not in target_use]
    reused = [{"right": full_ref(right, target), "left": [full_ref(left, index) for index in indices], "mapping_count": len(indices),
               "decision_status": "explicitly_declared" if all(index in indexed for index in indices) else "declared_cardinality" if expected_cardinality in ("many_to_one", "many_to_many") else "review_required"}
              for target, indices in target_use.items() if len(indices) > 1]
    return {"schema": "nekcv.resolved-crosswalk/v1", "observed": observed,
            "sources": {"left": {"source_id": left.get("source_id"), "source_sha256": left.get("source_sha256"), "table_id": left["id"]},
                        "right": {"source_id": right.get("source_id"), "source_sha256": right.get("source_sha256"), "table_id": right["id"]}},
            "decision_sha256": _digest(_json(decisions).encode()), "normalization": normalization, "expected_cardinality": expected_cardinality,
            "rows": rows, "links": links, "unresolved": unresolved, "excluded": excluded, "right_unmapped": unmapped, "reused_right_rows": reused,
            "summary": {"left_rows": len(rows), "explicit_mapped_left_rows": sum(row["status"] == "explicit_mapping" for row in rows),
                        "proposed_unique_left_rows": sum(row["status"] == "proposed_unique_match" for row in rows), "proposed_mapped_left_rows": sum(row["status"].startswith("proposed_") for row in rows), "excluded_left_rows": len(excluded),
                        "unresolved_left_rows": len(unresolved), "crosswalk_links": len(links), "distinct_mapped_right_rows": len(target_use),
                        "unmapped_right_rows": len(unmapped), "reused_right_rows": len(reused)},
            "status": "review_required" if unresolved or any(item["decision_status"] == "review_required" for item in reused) else "ready_for_operator_approval",
            "meaning": "Crosswalk links preserve source identities. Multiple targets do not allocate measures or imply service availability; source cells are unchanged."}


def _sql_type(value):
    if not isinstance(value, str):
        raise IntakeError("target_type must be an explicit SQL Server type string.")
    value = re.sub(r"\s+", "", value.upper())
    if value in ("BIGINT", "INT", "BIT", "DATE"):
        return value
    match = re.fullmatch(r"NVARCHAR\((MAX|[0-9]+)\)", value)
    if match and (match[1] == "MAX" or 1 <= int(match[1]) <= 4000):
        return value
    match = re.fullmatch(r"DECIMAL\(([0-9]+),([0-9]+)\)", value)
    if match and 1 <= int(match[1]) <= 38 and 0 <= int(match[2]) <= int(match[1]):
        return value
    match = re.fullmatch(r"DATETIME(?:2|OFFSET)\(([0-9])\)", value)
    if match and 0 <= int(match[1]) <= 7:
        return value
    raise IntakeError("Use BIGINT, INT, BIT, DATE, DECIMAL(p,s), DATETIME2(0..7), DATETIMEOFFSET(0..7), or NVARCHAR(1..4000/MAX).")


def _identifier(value):
    if not isinstance(value, str) or not value.strip() or len(value.encode("utf-16-le")) // 2 > 128 or any(ord(char) < 32 for char in value):
        raise IntakeError("SQL identifiers must be nonblank, contain no control characters, and fit 128 UTF-16 code units.")
    return "[" + value.replace("]", "]]") + "]"


def _literal(value):
    return "N'" + str(value).replace("'", "''") + "'"


def _name(value, fallback="field"):
    value = re.sub(r"[^A-Za-z0-9_]+", "_", value).strip("_")[:80]
    return value or fallback


def build_dictionary(source: dict, mappings: list | None = None, table_id: str | None = None) -> dict:
    """Resolve field decisions against this exact source, rejecting stale IDs."""
    if source.get("schema") != SCHEMA:
        raise IntakeError("Dictionary input must be an original parsed discovery source.")
    all_fields = {(table["id"], column["key"]) for table in source["tables"] for column in table["columns"]}
    decisions = {}
    for mapping in mappings or []:
        key = (mapping.get("table_id"), mapping.get("column_key"))
        if key not in all_fields:
            raise IntakeError("Mapping references a field outside this exact source version.")
        if key in decisions:
            raise IntakeError("A source field has more than one mapping decision.")
        decisions[key] = mapping
    tables = [table for table in source["tables"] if table_id is None or table["id"] == table_id]
    if not tables:
        raise IntakeError("Selected table_id is not present in this source.")
    result = []
    for table in tables:
        profiles = {profile["column_key"]: profile for profile in table["profile"]["columns"]}
        target_names = set()
        for column in table["columns"]:
            mapping = dict(decisions.get((table["id"], column["key"]), {}))
            profile = profiles[column["key"]]
            target_name = mapping.get("target_name") or (_name(column["name"]) + "_" + column["key"])
            _identifier(target_name)
            if target_name.casefold() in target_names or target_name.casefold().startswith("_source_") or target_name.casefold() in ("_ingested_at", "_conversion_rejection_count"):
                raise IntakeError("Target names must be unique within each table, including case-insensitive SQL collations, and must not reuse reserved source metadata names.")
            target_names.add(target_name.casefold())
            target_type = _sql_type(mapping.get("target_type") or profile["suggested_sql_type"])
            result.append({**mapping, "source_id": source["id"], "source_sha256": source["sha256"], "filename": source["filename"],
                           "table_id": table["id"], "table_name": table["name"], "column_key": column["key"], "source_name": column["name"],
                           "source_position": column["source_position"], "source_path": column.get("source_path"), "header_origins": column.get("header_origins", []),
                           "header_merge_spans": column.get("header_merge_spans", []), "target_name": target_name, "target_type": target_type,
                           "definition": mapping.get("definition", ""), "owner": mapping.get("owner", ""), "classification": mapping.get("classification", "unreviewed"),
                           "decision_status": mapping.get("decision_status", "proposed" if mapping else "unreviewed"), "observed_profile": profile})
    return {"schema": "nekcv.source-dictionary/v1", "source_id": source["id"], "source_sha256": source["sha256"], "fields": result,
            "mapping_sha256": _digest(_json(mappings or []).encode()), "status": "source_bound_draft_requires_owner_approval"}


def _conversion(raw, target):
    """Produce a non-destructive expression plus a rejection predicate.

    TRY_CONVERT alone can round decimals and truncate strings. Explicit guards
    prevent those cases from looking like accepted typed output.
    """
    trimmed = f"LTRIM(RTRIM({raw}))"
    blank = f"({raw} IS NULL OR {trimmed} = N'')"
    if target.startswith("NVARCHAR"):
        size = target[9:-1]
        rejected = "1 = 0" if size == "MAX" else f"DATALENGTH({raw}) > {int(size) * 2}"
        value = f"CASE WHEN {rejected} THEN NULL ELSE CONVERT({target}, {raw}) END"
        return value, rejected
    style = ", 23" if target == "DATE" else ", 127" if target.startswith("DATETIMEOFFSET") else ", 126" if target.startswith("DATETIME2") else ""
    converted = f"TRY_CONVERT({target}, NULLIF({trimmed}, N''){style})"
    checks = [f"{converted} IS NULL"]
    if target in ("INT", "BIGINT") or target.startswith("DECIMAL"):
        checks.append(f"{trimmed} COLLATE Latin1_General_100_BIN2 LIKE N'%[^0-9.+-]%'")
        if target in ("INT", "BIGINT"):
            checks.append(f"CHARINDEX(N'.', {trimmed}) > 0")
        else:
            scale = int(target.rstrip(")").split(",")[1])
            checks.append(f"(CHARINDEX(N'.', {trimmed}) > 0 AND SUBSTRING({trimmed}, CHARINDEX(N'.', {trimmed}) + {scale + 1}, LEN({trimmed})) COLLATE Latin1_General_100_BIN2 LIKE N'%[1-9]%')")
    elif target == "BIT":
        checks.append(f"LOWER({trimmed}) NOT IN (N'0', N'1', N'true', N'false')")
    elif target == "DATE":
        checks.append(f"{trimmed} COLLATE Latin1_General_100_BIN2 NOT LIKE N'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'")
    elif target.startswith("DATETIME"):
        checks.append(f"SUBSTRING({trimmed}, 11, 1) <> N'T'")
        offset = f"(RIGHT({trimmed}, 1) = N'Z' OR RIGHT({trimmed}, 6) COLLATE Latin1_General_100_BIN2 LIKE N'[+-][0-9][0-9]:[0-9][0-9]')"
        checks.append(("NOT " if target.startswith("DATETIMEOFFSET") else "") + offset)
        precision = int(target[-2])
        tail = f"COALESCE(SUBSTRING({trimmed}, CHARINDEX(N'.', {trimmed}) + 1, 64), N'')"
        fraction = f"LEFT({tail}, PATINDEX(N'%[^0-9]%', ({tail} + N'X') COLLATE Latin1_General_100_BIN2) - 1)"
        checks.append(f"(CHARINDEX(N'.', {trimmed}) > 0 AND SUBSTRING({fraction}, {precision + 1}, 64) COLLATE Latin1_General_100_BIN2 LIKE N'%[1-9]%')")
    rejected = f"(NOT {blank} AND (" + " OR ".join(checks) + "))"
    return f"CASE WHEN {blank} OR {rejected} THEN NULL ELSE {converted} END", rejected


def build_staging_sql(source: dict, mappings: list | None = None, schema: str = "staging") -> dict:
    """Generate SQL Server 2012+ DDL and raw-to-typed/rejection views; execute none."""
    schema_sql = _identifier(schema)
    dictionary = build_dictionary(source, mappings)
    by_table = defaultdict(list)
    for field in dictionary["fields"]:
        by_table[field["table_id"]].append(field)
    statements = ["-- Source-preserving discovery handover. Review before execution.",
                  "-- SQL Server 2012+; compatibility level 110 or newer. No source data or credentials are embedded.",
                  "-- Raw columns retain exact text/null. Typed output carries a conversion rejection count.",
                  "-- The rejection view includes overflow, truncation and nonzero precision loss.",
                  "-- No DROP, UPDATE, DELETE, network operation, credential or automatic source load.",
                  "-- SOURCE " + _json({"id": source["id"], "sha256": source["sha256"], "filename": source["filename"], "options": source["options"]}),
                  f"IF SCHEMA_ID({_literal(schema)}) IS NULL EXEC({_literal('CREATE SCHEMA ' + schema_sql)});", "GO"]
    manifest, used_objects = [], set()
    for table in source["tables"]:
        fields = by_table[table["id"]]
        if any(field.get("target_table") is not None and not isinstance(field["target_table"], str) for field in fields):
            raise IntakeError("target_table must be a SQL identifier string.")
        table_names = {field["target_table"] for field in fields if field.get("target_table")}
        if len(table_names) > 1:
            raise IntakeError("One source table has conflicting target_table decisions. Staging preserves one raw source table; curate splits separately.")
        name = next(iter(table_names)) if table_names else _name(table["name"], "source") + "_" + _digest(table["id"].encode())[:10]
        # Suffixes must also fit SQL Server's identifier limit.
        raw_name, view_name, reject_name = name + "_raw", name + "_typed", name + "_rejections"
        object_names = {value.casefold() for value in (raw_name, view_name, reject_name)}
        if used_objects & object_names:
            raise IntakeError("Target table/view names collide across source worksheets; choose distinct target_table names.")
        used_objects.update(object_names)
        raw_table = schema_sql + "." + _identifier(raw_name)
        typed_view = schema_sql + "." + _identifier(view_name)
        reject_view = schema_sql + "." + _identifier(reject_name)
        metadata = "    [_source_sha256] CHAR(64) NOT NULL,\n    [_source_table_id] NVARCHAR(96) NOT NULL,\n    [_source_row] BIGINT NOT NULL,\n    [_source_record_locator] NVARCHAR(MAX) NULL,\n    [_ingested_at] DATETIME2(7) NOT NULL DEFAULT SYSUTCDATETIME(),"
        raw_columns = ",\n".join("    " + _identifier(field["column_key"]) + " NVARCHAR(MAX) NULL" for field in fields)
        statements.extend([f"CREATE TABLE {raw_table} (", metadata, raw_columns + ",", "    PRIMARY KEY ([_source_sha256], [_source_table_id], [_source_row])", ");", "GO"])
        typed_columns, rejections, reject_rows = [], [], []
        for field in fields:
            raw_column = "r." + _identifier(field["column_key"])
            value, rejected = _conversion(raw_column, field["target_type"])
            typed_columns.append("    " + value + " AS " + _identifier(field["target_name"]))
            rejections.append(f"CASE WHEN {rejected} THEN 1 ELSE 0 END")
            reject_rows.append(f"({_literal(field['target_name'])}, {_literal(field['column_key'])}, {raw_column}, {_literal(field['target_type'])}, CASE WHEN {rejected} THEN 1 ELSE 0 END)")
        retained = "r.[_source_sha256], r.[_source_table_id], r.[_source_row], r.[_source_record_locator], r.[_ingested_at]"
        statements.extend([f"CREATE VIEW {typed_view} AS", "SELECT " + retained + ",", ",\n".join(typed_columns) + ",", "    (" + " + ".join(rejections) + ") AS [_conversion_rejection_count]", f"FROM {raw_table} AS r;", "GO",
                           f"CREATE VIEW {reject_view} AS", "SELECT " + retained + ", q.[target_field], q.[source_column], q.[raw_value], q.[target_type]", f"FROM {raw_table} AS r", "CROSS APPLY (VALUES\n    " + ",\n    ".join(reject_rows) + ") AS q([target_field], [source_column], [raw_value], [target_type], [rejected])", "WHERE q.[rejected] = 1;", "GO"])
        manifest.append({"source_id": source["id"], "source_sha256": source["sha256"], "table_id": table["id"], "source_name": table["name"], "row_count": len(table["rows"]),
                         "raw_table": schema + "." + raw_name, "raw_table_sql": raw_table, "typed_view": schema + "." + view_name, "rejection_view": schema + "." + reject_name,
                         "row_identity": ["_source_sha256", "_source_table_id", "_source_row"],
                         "columns": [{key: field[key] for key in ("column_key", "source_name", "target_name", "target_type", "definition", "owner", "classification", "decision_status")} for field in fields]})
    return {"schema": "nekcv.sqlserver-staging/v1", "sql": "\n".join(statements) + "\n", "manifest": manifest, "dictionary": dictionary,
            "status": "generated_not_executed", "loading_contract": "Load one declared source with parameterized values and its original row locator. Preserve exact text/null and validate the source hash. Typed views are proposed projections; review rejection rows and field-owner decisions before promotion."}


def build_load_plan(source: dict, mappings: list | None = None, schema: str = "staging") -> dict:
    """Prepare qmark SQL and a replay contract; no connection or write occurs.

    The caller owns one non-autocommit transaction for all table preflights and
    inserts. Inspect rows with the generated locked SELECT, reconcile all tables
    exactly, then insert only missing indices. Roll back the whole operation on
    any conflict or failure. The primary source-row key is a final duplicate guard.
    """
    handover = build_staging_sql(source, mappings, schema)
    tables = []
    for entry in handover["manifest"]:
        columns = ["_source_sha256", "_source_table_id", "_source_row", "_source_record_locator"] + [field["column_key"] for field in entry["columns"]]
        column_sql = ", ".join(map(_identifier, columns))
        tables.append({"table_id": entry["table_id"], "source_id": source["id"], "source_sha256": source["sha256"],
                       "row_count": entry["row_count"], "raw_table": entry["raw_table"], "raw_table_sql": entry["raw_table_sql"],
                       "parameter_columns": columns, "parameter_count": len(columns),
                       "inspect_sql": f"SELECT {column_sql} FROM {entry['raw_table_sql']} WITH (UPDLOCK, HOLDLOCK) WHERE [_source_sha256] = ? AND [_source_table_id] = ? ORDER BY [_source_row];",
                       "inspect_parameters": [source["sha256"], entry["table_id"]],
                       "insert_sql": f"INSERT INTO {entry['raw_table_sql']} ({column_sql}) VALUES ({', '.join('?' for _ in columns)});",
                       "row_index_base": 0, "parameter_values": "Original SHA/table/parsed-row index, canonical original locator JSON, then exact parsed text or null in column order."})
    plan = {"schema": "nekcv.sqlserver-load-plan/v1", "source_id": source["id"], "source_sha256": source["sha256"],
            "filename": source["filename"], "source_options": source["options"], "mapping_sha256": handover["dictionary"]["mapping_sha256"],
            "paramstyle": "qmark", "status": "prepared_not_executed", "tables": tables,
            "transaction": {"owner": "caller", "autocommit": False, "isolation": "SERIALIZABLE", "setup_sql": ["SET XACT_ABORT ON;", "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;"],
                            "sequence": ["Use an otherwise idle caller-owned connection with autocommit disabled and the reviewed raw tables already created.",
                                         "Execute inspect_sql and reconcile_load_rows for every table, retaining locks in this same transaction.",
                                         "After every preflight succeeds, insert only missing_row_indices using parameterized insert_sql.",
                                         "Commit once after all inserts succeed; roll back everything on a conflict, driver error or cancellation."],
                            "replay": "Existing identical source rows are skipped; partial identical loads can be completed. Any changed cell, locator, unexpected source row or duplicate existing row rejects the preflight.",
                            "retry": "After rollback, any retry restarts the complete locked preflight. Never retry only a failed INSERT or use a cached preflight result."}}
    plan["plan_sha256"] = _digest(_json(plan).encode())
    return plan


def _load_tables(source, plan):
    if source.get("schema") != SCHEMA or plan.get("schema") != "nekcv.sqlserver-load-plan/v1":
        raise IntakeError("Load rows require an original parsed source and its prepared SQL Server load plan.")
    if plan.get("source_id") != source["id"] or plan.get("source_sha256") != source["sha256"] or plan.get("source_options") != source["options"] or plan.get("filename") != source["filename"]:
        raise IntakeError("The load plan does not belong to this original source version and parsing selection.")
    if plan.get("plan_sha256") != _digest(_json({key: value for key, value in plan.items() if key != "plan_sha256"}).encode()):
        raise IntakeError("The prepared load plan changed after generation; regenerate it from the current source and mappings.")
    entries = plan.get("tables")
    if not isinstance(entries, list) or len(entries) != len(source["tables"]) or len({entry.get("table_id") for entry in entries}) != len(entries):
        raise IntakeError("The load plan must retain each original source table exactly once.")
    indexed = {table["id"]: table for table in source["tables"]}
    for entry in entries:
        table = indexed.get(entry.get("table_id"))
        if table is None:
            raise IntakeError("The load plan references an unknown source table.")
        columns = ["_source_sha256", "_source_table_id", "_source_row", "_source_record_locator"] + [column["key"] for column in table["columns"]]
        if entry.get("row_count") != len(table["rows"]) or entry.get("parameter_columns") != columns or entry.get("parameter_count") != len(columns):
            raise IntakeError("The load plan's row or parameter shape differs from the original parsed table.")
    return indexed


def _load_parameters(source, table, index):
    return [source["sha256"], table["id"], index, _json(table["row_origins"][index])] + [table["rows"][index][column["key"]] for column in table["columns"]]


def iter_load_rows(source: dict, plan: dict, table_id: str | None = None):
    """Yield JSON-serializable parameter records without SQL interpolation.

    The optional table filter preserves source order and zero-based row indices.
    The same records can be written as offline JSONL or bound through a caller's
    qmark DB-API driver. No cell coercion, replacement, escaping or truncation is
    performed: parameter binding, not SQL text quoting, carries the cell values.
    """
    indexed = _load_tables(source, plan)
    if table_id is not None and table_id not in indexed:
        raise IntakeError("The selected load table is absent from the original source.")
    for entry in plan["tables"]:
        if table_id is not None and entry["table_id"] != table_id:
            continue
        table = indexed[entry["table_id"]]
        for index in range(len(table["rows"])):
            yield {"table_id": table["id"], "row_index": index, "parameters": _load_parameters(source, table, index)}


def reconcile_load_rows(source: dict, plan: dict, table_id: str, existing_rows) -> dict:
    """Compare actual locked SELECT rows to exact expected parameters offline.

    Accept DB-API row sequences, or dictionaries keyed by parameter_columns.
    The caller must exhaust and reconcile every source table before inserting
    any row. This function does not infer that rows came from a real database;
    lock/transaction custody is the responsibility of the executing caller.
    """
    indexed = _load_tables(source, plan)
    if table_id not in indexed:
        raise IntakeError("The selected reconciliation table is absent from the original source.")
    table = indexed[table_id]
    entry = next(entry for entry in plan["tables"] if entry["table_id"] == table_id)
    seen = set()
    for existing in existing_rows:
        if isinstance(existing, dict):
            if set(existing) != set(entry["parameter_columns"]):
                raise IntakeError("Existing source-row fields differ from the generated locked SELECT columns.")
            values = [existing[column] for column in entry["parameter_columns"]]
        else:
            if isinstance(existing, (str, bytes)):
                raise IntakeError("Existing rows must be DB-API row sequences or named-column dictionaries.")
            try:
                values = list(existing)
            except TypeError as exc:
                raise IntakeError("An existing source row is not a row sequence.") from exc
        if len(values) != entry["parameter_count"] or values[:2] != [source["sha256"], table_id]:
            raise IntakeError("Existing source-row identity or parameter count conflicts with the declared original source.")
        index = values[2]
        if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < len(table["rows"]) or index in seen:
            raise IntakeError("Existing source rows contain an unexpected, duplicate or invalid row index; roll back before loading.")
        expected = _load_parameters(source, table, index)
        if values != expected:
            differing = [column for column, actual, original in zip(entry["parameter_columns"], values, expected) if actual != original]
            raise IntakeError(f"Existing source row {index} conflicts in {', '.join(differing)}; preserve it and investigate before loading.")
        seen.add(index)
    missing = [index for index in range(len(table["rows"])) if index not in seen]
    return {"schema": "nekcv.sqlserver-load-reconciliation/v1", "source_id": source["id"], "source_sha256": source["sha256"],
            "table_id": table_id, "plan_sha256": plan["plan_sha256"], "expected_rows": len(table["rows"]),
            "matched_existing_rows": len(seen), "missing_rows": len(missing), "missing_row_indices": missing,
            "status": "complete_replay" if not missing else "ready_for_missing_rows", "database_execution": "not_performed_by_reconciler"}
