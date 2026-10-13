"""Original XLSX/CSV intake for ATSSC company coverage and contact operations.

The caller retains file_bytes in the maintained workspace's original source
store. Reports carry byte/hash identities, every selected row and exact source
locations; this module never rewrites, recalculates or silently truncates input.
"""
from __future__ import annotations
import base64
import csv
import hashlib
import io
import json
import posixpath
import re
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET

SCHEMA = "commons.atssc.respondent-source.v1"
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "p": "http://schemas.openxmlformats.org/package/2006/relationships"}
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_XML_BYTES = 256 * 1024 * 1024
MAX_CELLS = 2_000_000
IDENTIFIER_FIELDS = ("company_id", "hs_code", "country")

class SourceError(ValueError):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code, self.details = code, details
    def as_dict(self):
        return {"code": self.code, "message": str(self), **self.details}

def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))

def digest(value):
    raw = value if isinstance(value, bytes) else canonical(value).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()

def column_number(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Z]{1,3}", value):
        raise SourceError("INVALID_COLUMN", "Use the visible Excel column identifier.", column=value)
    result = 0
    for char in value:
        result = result * 26 + ord(char) - 64
    if result > 16384:
        raise SourceError("INVALID_COLUMN", "Column exceeds Excel's XFD column.", column=value)
    return result

def column_name(number):
    if not isinstance(number, int) or not 1 <= number <= 16384:
        raise SourceError("INVALID_COLUMN", "Column must be between 1 and 16384.", column=number)
    out = ""
    while number:
        number, digit = divmod(number - 1, 26)
        out = chr(65 + digit) + out
    return out

def _xml(data, member):
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise SourceError("XML_DECLARATION", "Workbook XML contains an unsupported declaration.", member=member)
    try:
        return ET.fromstring(data)
    except ET.ParseError as error:
        raise SourceError("INVALID_WORKBOOK_XML", str(error), member=member) from error

def _member_name(base, target):
    if target.startswith("/"):
        candidate = target.lstrip("/")
    else:
        candidate = posixpath.normpath(posixpath.join(posixpath.dirname(base), target))
    parts = PurePosixPath(candidate).parts
    if not candidate or "\\" in candidate or ".." in parts or candidate.startswith("/"):
        raise SourceError("INVALID_WORKBOOK_MEMBER", "Unsafe workbook relationship.", target=target)
    return candidate

def _read_workbook(file_bytes, options):
    try:
        archive = zipfile.ZipFile(io.BytesIO(file_bytes))
    except zipfile.BadZipFile as error:
        raise SourceError("INVALID_XLSX", "The selected file is not a readable XLSX archive.") from error
    with archive:
        infos = archive.infolist()
        if len(infos) != len({x.filename for x in infos}):
            raise SourceError("DUPLICATE_ZIP_MEMBER", "The workbook has duplicate archive member names.")
        if sum(x.file_size for x in infos) > MAX_XML_BYTES or len(infos) > 10000:
            raise SourceError("WORKBOOK_SIZE", "Expanded workbook exceeds the intake limit; retain this source for a larger original-source import.")
        if any(x.flag_bits & 1 for x in infos):
            raise SourceError("ENCRYPTED_XLSX", "Open and export an unencrypted original edition before intake.")
        names = set(archive.namelist())
        def member(name):
            if name not in names:
                raise SourceError("MISSING_WORKBOOK_MEMBER", "A workbook relationship target is absent.", member=name)
            return _xml(archive.read(name), name)
        workbook_name = "xl/workbook.xml"
        workbook = member(workbook_name)
        relationships = member("xl/_rels/workbook.xml.rels")
        rels = {}
        for rel in relationships:
            if rel.get("TargetMode") != "External":
                rels[rel.get("Id")] = {
                    "name": _member_name(workbook_name, rel.get("Target", "")),
                    "type": rel.get("Type", "")}
        strings = []
        for rel in rels.values():
            if rel["type"].endswith("/sharedStrings"):
                for item in member(rel["name"]).findall("s:si", NS):
                    strings.append("".join(t.text or "" for t in item.iter("{"+NS["s"]+"}t")))
        styles = []
        number_formats = {}
        for rel in rels.values():
            if rel["type"].endswith("/styles"):
                tree = member(rel["name"])
                for item in tree.findall("s:numFmts/s:numFmt", NS):
                    number_formats[item.get("numFmtId")] = item.get("formatCode")
                for item in tree.findall("s:cellXfs/s:xf", NS):
                    styles.append({"number_format_id": item.get("numFmtId", "0"),
                                   "number_format": number_formats.get(item.get("numFmtId"))})
        sheets = []
        for item in workbook.findall("s:sheets/s:sheet", NS):
            relation = rels.get(item.get("{"+NS["r"]+"}id"))
            if relation and relation["type"].endswith("/worksheet"):
                sheets.append({"name": item.get("name", ""), "sheet_id": item.get("sheetId"),
                               "state": item.get("state", "visible"), "member": relation["name"]})
        if not sheets:
            raise SourceError("NO_WORKSHEETS", "The workbook has no ordinary data worksheets.")
        selected_name = options.get("sheet")
        if selected_name is None and len(sheets) == 1:
            selected_name = sheets[0]["name"]
        if selected_name is None:
            return {"sheets": sheets, "requires_sheet": True, "rows": [], "columns": [],
                    "workbook": {"date1904": workbook.find("s:workbookPr", NS) is not None and
                       workbook.find("s:workbookPr", NS).get("date1904") in ("1", "true")}}
        choices = [s for s in sheets if s["name"] == selected_name]
        if len(choices) != 1:
            raise SourceError("SHEET_NOT_FOUND", "Select one exact source worksheet.", sheet=selected_name)
        selected = choices[0]
        tree = member(selected["member"])
        rows, used_rows, used_cells, total_cells = [], set(), set(), 0
        for row in tree.findall("s:sheetData/s:row", NS):
            raw_number = row.get("r")
            if not raw_number or not raw_number.isdigit() or int(raw_number) < 1:
                raise SourceError("INVALID_ROW", "Every source row must have its original positive row number.")
            row_number = int(raw_number)
            if row_number in used_rows:
                raise SourceError("DUPLICATE_ROW", "Worksheet repeats a row number.", row=row_number)
            used_rows.add(row_number)
            cells = []
            for cell in row.findall("s:c", NS):
                address = cell.get("r", "")
                match = re.fullmatch(r"([A-Z]{1,3})([1-9][0-9]*)", address)
                if not match or int(match.group(2)) != row_number or address in used_cells:
                    raise SourceError("INVALID_CELL_ADDRESS", "Cell has a repeated or inconsistent original address.", address=address)
                used_cells.add(address)
                total_cells += 1
                if total_cells > MAX_CELLS:
                    raise SourceError("CELL_LIMIT", "The complete worksheet exceeds this intake's cell limit; no rows were retained.")
                index = column_number(match.group(1))
                typ = cell.get("t", "n")
                raw_value = cell.findtext("s:v", default="", namespaces=NS)
                value = raw_value
                if typ == "s":
                    try:
                        offset = int(raw_value)
                        if offset < 0:
                            raise ValueError()
                        value = strings[offset]
                    except (ValueError, IndexError) as error:
                        raise SourceError("INVALID_SHARED_STRING", "A source cell references an absent text value.", address=address) from error
                elif typ == "inlineStr":
                    value = "".join(t.text or "" for t in cell.findall("s:is//s:t", NS))
                formula = cell.find("s:f", NS)
                style = cell.get("s")
                style_info = None
                if style is not None:
                    try:
                        style_index = int(style)
                        if style_index < 0:
                            raise ValueError()
                        style_info = styles[style_index]
                    except (ValueError, IndexError) as error:
                        raise SourceError("INVALID_CELL_STYLE", "A source cell references an absent style.", address=address) from error
                cells.append({"column": match.group(1), "index": index, "address": address,
                              "value": value, "type": typ, "xml_value": raw_value,
                              "formula": None if formula is None else {"text": formula.text or "", "attributes": dict(formula.attrib)},
                              "style": style_info})
            rows.append({"number": row_number, "cells": sorted(cells, key=lambda x: x["index"]),
                         "source": {"format": "XLSX", "sheet": selected["name"], "member": selected["member"],
                                    "row": row_number, "pointer": selected["member"]+"#row="+str(row_number)}})
        rows.sort(key=lambda x: x["number"])
        return {"sheets": sheets, "selected_sheet": selected, "requires_sheet": False, "rows": rows,
                "workbook": {"date1904": workbook.find("s:workbookPr", NS) is not None and
                   workbook.find("s:workbookPr", NS).get("date1904") in ("1", "true"),
                   "calculation": dict(workbook.find("s:calcPr", NS).attrib) if workbook.find("s:calcPr", NS) is not None else {},
                   "defined_names": [{"name": x.get("name"), "value": x.text or "", "attributes": dict(x.attrib)}
                       for x in workbook.findall("s:definedNames/s:definedName", NS)]}}

def _read_csv(file_bytes, options):
    encoding = options.get("encoding", "utf-8-sig")
    if encoding not in ("utf-8-sig", "utf-8", "utf-16", "utf-16-le", "utf-16-be", "cp1252", "iso-8859-1"):
        raise SourceError("UNSUPPORTED_ENCODING", "Select a supported source encoding.", encoding=encoding)
    delimiter = options.get("delimiter", ",")
    if delimiter not in (",", ";", "\t", "|"):
        raise SourceError("INVALID_DELIMITER", "Select comma, semicolon, tab or pipe.")
    try:
        text = file_bytes.decode(encoding)
    except UnicodeError as error:
        raise SourceError("SOURCE_ENCODING", "The selected encoding cannot decode every original byte.") from error
    if "\x00" in text:
        raise SourceError("SOURCE_ENCODING", "Decoded source contains null characters; select the original encoding.")
    lines = text.splitlines(keepends=True)
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True)
    rows, previous_line, total_cells = [], 0, 0
    try:
        for number, values in enumerate(reader, 1):
            total_cells += len(values)
            if total_cells > MAX_CELLS:
                raise SourceError("CELL_LIMIT", "The complete source exceeds this intake's cell limit; no rows were retained.")
            cells = [{"column": column_name(index), "index": index, "address": column_name(index)+str(number),
                      "value": value, "type": "text", "xml_value": None, "formula": None, "style": None}
                     for index, value in enumerate(values, 1)]
            rows.append({"number": number, "cells": cells, "source": {
                "format": "CSV", "row": number, "line_start": previous_line+1,
                "line_end": reader.line_num, "raw": "".join(lines[previous_line:reader.line_num]),
                "pointer": "record/"+str(number)}})
            previous_line = reader.line_num
    except csv.Error as error:
        raise SourceError("INVALID_CSV", str(error), line=reader.line_num) from error
    return {"sheets": [], "requires_sheet": False, "rows": rows,
            "csv": {"encoding": encoding, "delimiter": delimiter, "record_count": len(rows)}}

def read_source(file_bytes, file_name, options=None):
    options = dict(options or {})
    if not isinstance(file_bytes, bytes):
        raise SourceError("SOURCE_BYTES", "Pass the unchanged original bytes.")
    if len(file_bytes) > MAX_FILE_BYTES:
        raise SourceError("SOURCE_SIZE", "The original file exceeds the 64 MiB receiving limit.", bytes=len(file_bytes))
    if not isinstance(file_name, str) or not file_name.strip() or any(c in file_name for c in "\x00\r\n"):
        raise SourceError("FILE_NAME", "A nonempty original filename is required.")
    selected_format = options.get("format") or ("XLSX" if file_name.lower().endswith(".xlsx") else "CSV")
    if selected_format not in ("CSV", "XLSX"):
        raise SourceError("SOURCE_FORMAT", "Use an original XLSX or CSV file.")
    parsed = _read_workbook(file_bytes, options) if selected_format == "XLSX" else _read_csv(file_bytes, options)
    header_row = options.get("header_row", 1)
    if not isinstance(header_row, int) or isinstance(header_row, bool) or header_row < 1:
        raise SourceError("HEADER_ROW", "Choose an original positive header-row number.")
    columns = []
    if not parsed["requires_sheet"]:
        header = next((r for r in parsed["rows"] if r["number"] == header_row), None)
        if header is None:
            raise SourceError("HEADER_ROW_MISSING", "The selected header row is absent.", row=header_row)
        max_column = max((c["index"] for r in parsed["rows"] for c in r["cells"]), default=0)
        header_cells = {c["index"]: c for c in header["cells"]}
        for index in range(1, max_column+1):
            cell = header_cells.get(index)
            columns.append({"id": column_name(index), "index": index, "label": cell["value"] if cell else "",
                            "header_address": column_name(index)+str(header_row)})
    report = {"schema": SCHEMA, "file": {"name": file_name, "bytes": len(file_bytes),
              "sha256": digest(file_bytes), "format": selected_format},
              "interpretation": options, "header_row": header_row, **parsed, "columns": columns}
    for row in report["rows"]:
        row["source"]["file_sha256"] = report["file"]["sha256"]
        row["source_id"] = digest({"file": report["file"]["sha256"], "source": row["source"]})
        row["is_header"] = row["number"] == header_row
        row["is_preamble"] = row["number"] < header_row
        row["empty"] = not any(c["value"].strip() or c["formula"] for c in row["cells"])
    report["counts"] = {"source_rows": len(report["rows"]),
        "data_rows": sum(not r["is_header"] and not r["is_preamble"] and not r["empty"] for r in report["rows"]),
        "cells": sum(len(r["cells"]) for r in report["rows"])}
    report["review_sha256"] = digest(report)
    return report

def decode_input(value):
    if not isinstance(value, dict) or not isinstance(value.get("content_base64"), str):
        raise SourceError("SOURCE_INPUT", "Provide the complete original file as content_base64.")
    try:
        original = base64.b64decode(value["content_base64"], validate=True)
    except (ValueError, TypeError) as error:
        raise SourceError("SOURCE_BASE64", "The original file encoding is invalid.") from error
    return original, read_source(original, value.get("name"), value.get("options"))

def decimal_value(raw, settings=None):
    settings = settings or {}
    decimal_separator = settings.get("decimal_separator", ".")
    group_separator = settings.get("group_separator", "")
    if decimal_separator not in (".", ",") or group_separator not in ("", ".", ",", " ", "\u00a0", "\u202f") or group_separator == decimal_separator:
        raise SourceError("NUMBER_FORMAT", "Choose distinct decimal and grouping separators.")
    value = str(raw).strip()
    negative_parentheses = value.startswith("(") and value.endswith(")")
    if negative_parentheses:
        if not settings.get("parentheses_negative", False):
            raise SourceError("NUMBER_FORMAT", "Parenthesized negatives require an explicit interpretation.", value=raw)
        value = value[1:-1].strip()
    if not value:
        raise SourceError("EMPTY_AMOUNT", "The source amount is empty.")
    sign = ""
    if value[:1] in ("+", "-"):
        sign, value = value[0], value[1:]
    if negative_parentheses and sign:
        raise SourceError("NUMBER_FORMAT", "The source has two negative/sign conventions.", value=raw)
    if value.count(decimal_separator) > 1:
        raise SourceError("NUMBER_FORMAT", "The amount has more than one decimal separator.", value=raw)
    chunks = value.split(decimal_separator)
    integer, fraction = chunks[0], chunks[1] if len(chunks) == 2 else None
    if group_separator and group_separator in integer:
        groups = integer.split(group_separator)
        if not re.fullmatch(r"[0-9]{1,3}", groups[0]) or any(not re.fullmatch(r"[0-9]{3}", g) for g in groups[1:]):
            raise SourceError("NUMBER_GROUPING", "The amount has inconsistent grouping.", value=raw)
        integer = "".join(groups)
    if not integer or not integer.isascii() or not integer.isdigit() or (fraction is not None and (not fraction or not fraction.isascii() or not fraction.isdigit())):
        raise SourceError("NUMBER_FORMAT", "The amount does not match the selected source convention.", value=raw)
    if len(integer) + len(fraction or "") > 80:
        raise SourceError("NUMBER_PRECISION", "The source amount exceeds 80 decimal digits.", value=raw)
    result = Decimal(("-" if negative_parentheses else sign) + integer + ("."+fraction if fraction is not None else ""))
    if not result.is_finite():
        raise SourceError("NUMBER_FINITE", "The source amount must be finite.")
    return format(result, "f")

def _selected_cell(row, mapping, field):
    col = mapping.get(field)
    if col is None:
        return None
    column_number(col)
    return next((cell for cell in row["cells"] if cell["column"] == col), None)

def _source_text(row, mapping, field, settings):
    cell = _selected_cell(row, mapping, field)
    if cell is None:
        return "", None
    if cell["type"] == "e":
        raise SourceError("SOURCE_CELL_ERROR", "The selected source cell contains an Excel error.", field=field, address=cell["address"], value=cell["value"])
    if cell["formula"] is not None and field not in settings.get("accept_cached_formula_fields", []):
        raise SourceError("FORMULA_REVIEW_REQUIRED", "Review and explicitly accept this original cached formula result.", field=field, address=cell["address"])
    value = cell["value"].strip()
    identifier_options = settings.get("identifiers", {}).get(field, {})
    if field in IDENTIFIER_FIELDS and cell["type"] == "n" and value:
        try:
            numeric = Decimal(value)
            if not numeric.is_finite() or numeric.adjusted() > 30 or numeric != numeric.to_integral_value() or numeric < 0:
                raise ValueError()
            value = format(numeric, "f").split(".")[0]
        except (ValueError, InvalidOperation) as error:
            raise SourceError("NUMERIC_IDENTIFIER", "The identifier is not a nonnegative whole source value.", field=field, address=cell["address"]) from error
        if not identifier_options.get("accept_numeric", False):
            raise SourceError("IDENTIFIER_REVIEW_REQUIRED", "Review this numeric identifier and its original number format before mapping.", field=field, address=cell["address"], style=cell["style"])
        padding = identifier_options.get("pad_digits")
        if padding is not None:
            if not isinstance(padding, int) or not 1 <= padding <= 30 or len(value) > padding:
                raise SourceError("IDENTIFIER_PADDING", "Explicit identifier padding cannot shorten the original value.", field=field)
            value = value.zfill(padding)
    if identifier_options.get("remove_spaces"):
        value = "".join(value.split())
    casing = identifier_options.get("case", "KEEP")
    if casing == "UPPER":
        value = value.upper()
    elif casing == "LOWER":
        value = value.lower()
    elif casing != "KEEP":
        raise SourceError("IDENTIFIER_CASE", "Identifier case must be KEEP, UPPER or LOWER.", field=field)
    return value, cell

def map_source(report, kind, mapping, settings=None):
    settings = dict(settings or {})
    if report.get("schema") != SCHEMA or report.get("requires_sheet"):
        raise SourceError("SOURCE_NOT_SELECTED", "Select the complete original source table before mapping.")
    if kind not in ("TRADE", "CONTACTS"):
        raise SourceError("MAPPING_KIND", "Select TRADE or CONTACTS.")
    required = ("company_id", "hs_code", "country", "value_for_duty") if kind == "TRADE" else ("company_id", "company_name")
    allowed = set(required) | {"company_name", "contact_name", "email", "phone", "postal_address", "language", "country", "role"}
    if not isinstance(mapping, dict) or any(not mapping.get(k) for k in required):
        raise SourceError("MAPPING_REQUIRED", "Map every required original column.", required=list(required))
    unknown = set(mapping) - allowed - {k for k in mapping if k.startswith("custom.")}
    if unknown:
        raise SourceError("MAPPING_UNKNOWN", "The mapping contains unknown fields.", fields=sorted(unknown))
    column_ids = {c["id"] for c in report["columns"]}
    if any(col not in column_ids for col in mapping.values()):
        raise SourceError("MAPPING_COLUMN", "A selected mapping column is absent from the original table.")
    if kind == "TRADE" and not re.fullmatch(r"[A-Z]{3}", str(settings.get("currency", ""))):
        raise SourceError("CURRENCY_REQUIRED", "Select the original three-letter value-for-duty currency.")
    rows = []
    for row in report["rows"]:
        if row["is_header"] or row["is_preamble"] or row["empty"]:
            continue
        values, references, errors, warnings = {}, {}, [], []
        for field in mapping:
            try:
                values[field], cell = _source_text(row, mapping, field, settings)
                references[field] = None if cell is None else {"column": cell["column"], "address": cell["address"],
                      "original_value": cell["value"], "type": cell["type"], "formula": cell["formula"], "style": cell["style"]}
                if cell and cell["formula"] is not None:
                    warnings.append({"code": "CACHED_FORMULA_ACCEPTED", "field": field, "address": cell["address"]})
            except SourceError as error:
                values[field] = ""
                errors.append(error.as_dict())
        for field in required:
            if not values.get(field):
                errors.append({"code": "REQUIRED_VALUE", "field": field, "message": "Required source value is absent or unresolved."})
        item = {"id": row["source_id"], "source": row["source"], "source_values": values,
                "source_fields": references, "errors": errors, "warnings": warnings}
        if kind == "TRADE":
            value = None
            if values.get("value_for_duty"):
                try:
                    cell = _selected_cell(row, mapping, "value_for_duty")
                    number_settings = {"decimal_separator": ".", "group_separator": ""} if cell and cell["type"] == "n" else settings.get("numbers")
                    raw_amount = values["value_for_duty"]
                    if cell and cell["type"] == "n" and re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)[Ee][+-]?[0-9]+", raw_amount):
                        numeric_amount = Decimal(raw_amount)
                        if not numeric_amount.is_finite() or abs(numeric_amount.adjusted()) > 80:
                            raise SourceError("NUMBER_PRECISION", "The original numeric amount exceeds the supported precision.")
                        raw_amount = format(numeric_amount, "f")
                    value = decimal_value(raw_amount, number_settings)
                    if Decimal(value) < 0:
                        warnings.append({"code": "NEGATIVE_TRADE_VALUE", "field": "value_for_duty",
                                         "message": "Keep this adjustment in the selected coverage basis."})
                except (SourceError, InvalidOperation) as error:
                    errors.append(error.as_dict() if isinstance(error, SourceError) else {"code": "NUMBER_FORMAT", "message": str(error)})
            item.update({"company_id": values.get("company_id", ""), "company_name": values.get("company_name", ""),
                         "hs_code": values.get("hs_code", ""), "country": values.get("country", ""),
                         "value_for_duty": value, "currency": settings["currency"]})
        else:
            email = values.get("email", "")
            if email and (len(email) > 320 or not re.fullmatch(r"[^<>\s@,;]+@[^<>\s@,;]+\.[^<>\s@,;]+", email)):
                errors.append({"code": "CONTACT_EMAIL", "field": "email", "message": "Review this original email address."})
            language = values.get("language", "").upper() or settings.get("default_language", "")
            if language not in ("EN", "FR"):
                errors.append({"code": "CONTACT_LANGUAGE", "field": "language", "message": "Select EN or FR for this contact."})
            item.update({k: values.get(k, "") for k in ("company_id", "company_name", "contact_name", "email", "phone", "postal_address", "country", "role")})
            item["language"] = language
            item["custom"] = {key[7:]: val for key, val in values.items() if key.startswith("custom.")}
            item["available_channels"] = (["EMAIL"] if email else []) + (["POSTAL"] if values.get("postal_address") else []) + (["PHONE"] if values.get("phone") else [])
            if not item["available_channels"]:
                warnings.append({"code": "CONTACT_ROUTE_NEEDED", "message": "Review a public link, referral or original contact-source continuation."})
        item["valid"] = not errors
        rows.append(item)
    if kind == "CONTACTS":
        identity_rows = {}
        for item in rows:
            key = (item["company_id"], item["email"].casefold(), item["contact_name"].casefold())
            identity_rows.setdefault(key, []).append(item)
        for group in identity_rows.values():
            if len(group) > 1:
                for item in group:
                    item["warnings"].append({"code": "DUPLICATE_CONTACT_CANDIDATE",
                        "source_row_ids": [other["id"] for other in group if other is not item],
                        "message": "Review these original rows; no contact has been silently merged."})
    result = {"schema": "commons.atssc.respondent-mapping.v1", "kind": kind,
              "source_file": report["file"], "source_review_sha256": report["review_sha256"],
              "mapping": dict(mapping), "settings": settings, "rows": rows,
              "counts": {"rows": len(rows), "valid": sum(x["valid"] for x in rows),
                         "invalid": sum(not x["valid"] for x in rows),
                         "with_warnings": sum(bool(x["warnings"]) for x in rows)}}
    result["review_sha256"] = digest(result)
    return result
