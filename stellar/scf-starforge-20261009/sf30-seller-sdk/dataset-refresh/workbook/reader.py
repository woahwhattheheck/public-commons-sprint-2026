#!/usr/bin/env python3
"""MIT. Read original XLSX values into an explicitly mapped SF30 CSV.
No workbook authoring, formula evaluation, external requests, or path input.
The parent supplies private held descriptors 3 (source), 4 (CSV), 5 (row map).
"""
import csv
import datetime as dt
import hashlib
import io
import json
import os
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN, localcontext

SCHEMA = "stellar-forge.workbook-projection.v1"
PARSER = "stellar-forge.xlsx-reader.v1"
SHEET_NS = {"http://schemas.openxmlformats.org/spreadsheetml/2006/main",
            "http://purl.oclc.org/ooxml/spreadsheetml/main"}
CELL_RE = re.compile(r"^([A-Z]{1,3})([1-9][0-9]{0,6})$")
NUMBER_RE = re.compile(r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]{1,5})?$")
LIMITS = {"sourceBytes": 64 * 1024 * 1024, "expandedBytes": 64 * 1024 * 1024,
          "partBytes": 32 * 1024 * 1024, "entries": 4096, "sheets": 128,
          "cells": 500000, "strings": 250000, "cellChars": 1024 * 1024}
DATE_FORMATS = {14:"mm-dd-yy",15:"d-mmm-yy",16:"d-mmm",17:"mmm-yy",
                18:"h:mm AM/PM",19:"h:mm:ss AM/PM",20:"h:mm",21:"h:mm:ss",
                22:"m/d/yy h:mm",45:"mm:ss",46:"[h]:mm:ss",47:"mmss.0"}
KNOWN_FORMATS = {0:"General",1:"0",2:"0.00",3:"#,##0",4:"#,##0.00",
                 9:"0%",10:"0.00%",11:"0.00E+00",12:"# ?/?",13:"# ??/??",
                 49:"@", **DATE_FORMATS}

class WorkbookError(Exception):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code, self.details = code, details

def fail(code, message, details=None):
    raise WorkbookError(code, message, details)

def integer(value, label, low, high):
    if type(value) is not int or not low <= value <= high:
        fail("INVALID_WORKBOOK_SELECTION", "%s must be an integer from %s to %s." % (label, low, high))
    return value

def local(tag):
    return tag.rsplit("}", 1)[-1]

def children(node, name):
    return [x for x in node if local(x.tag) == name]

def child(node, name):
    return next((x for x in node if local(x.tag) == name), None)

def column_number(label):
    if not isinstance(label, str) or not re.fullmatch(r"[A-Z]{1,3}", label):
        fail("INVALID_WORKBOOK_SELECTION", "Use an original column coordinate such as A or BC.")
    result = 0
    for c in label:
        result = result * 26 + ord(c) - 64
    if result > 16384:
        fail("INVALID_WORKBOOK_SELECTION", "A worksheet column must be A through XFD.")
    return result

def column_label(number):
    out = ""
    while number:
        number, rem = divmod(number - 1, 26)
        out = chr(65 + rem) + out
    return out

def coordinate(value):
    match = CELL_RE.fullmatch(value or "")
    if not match:
        fail("INVALID_CELL_REFERENCE", "The worksheet contains an invalid cell coordinate.")
    col, row = column_number(match[1]), int(match[2])
    if row > 1048576:
        fail("INVALID_CELL_REFERENCE", "A worksheet row exceeds the XLSX limit.")
    return col, row

def selection_range(value):
    if not isinstance(value, str):
        fail("INVALID_WORKBOOK_SELECTION", "Select an explicit worksheet range.")
    parts = value.split(":")
    if len(parts) == 1:
        parts *= 2
    if len(parts) != 2:
        fail("INVALID_WORKBOOK_SELECTION", "Use a range such as A1:D40.")
    left, top = coordinate(parts[0]); right, bottom = coordinate(parts[1])
    if left > right or top > bottom:
        fail("INVALID_WORKBOOK_SELECTION", "The selected range must run top-left to bottom-right.")
    return left, top, right, bottom

def range_name(bounds):
    a, b, c, d = bounds
    return "%s%d:%s%d" % (column_label(a), b, column_label(c), d)

def excel_text(text):
    text = re.sub(r"_x([0-9A-Fa-f]{4})_", lambda m: chr(int(m[1], 16)), text or "")
    try:
        return text.encode("utf-16-le", "surrogatepass").decode("utf-16-le")
    except UnicodeError:
        fail("INVALID_WORKBOOK_TEXT", "A cell contains an unpaired Unicode surrogate.")

def rich_text(node):
    if node is None:
        return ""
    parts = []
    for item in node:
        if local(item.tag) == "t":
            parts.append(item.text or "")
        elif local(item.tag) == "r":
            parts.extend(x.text or "" for x in item if local(x.tag) == "t")
    return excel_text("".join(parts))

def check_xml(data):
    if b"<!doctype" in data.replace(b"\x00", b"").lower() or b"<!entity" in data.replace(b"\x00", b"").lower():
        fail("WORKBOOK_DTD_UNSUPPORTED", "Workbook XML must not contain a DTD or entity declaration.")
    try:
        return ET.fromstring(data)
    except ET.ParseError:
        fail("INVALID_WORKBOOK_XML", "A required workbook part is not valid XML.")

def member_target(owner, target):
    if not isinstance(target, str) or "\\" in target or "\x00" in target or "?" in target or "#" in target:
        fail("INVALID_WORKBOOK_RELATIONSHIP", "A required workbook relationship has an unsupported target.")
    result = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join(posixpath.dirname(owner), target))
    if result == ".." or result.startswith("../") or result.startswith("/"):
        fail("INVALID_WORKBOOK_RELATIONSHIP", "A workbook relationship leaves its package.")
    return result

def rels_name(part):
    return posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels")

def scalar(cell):
    return cell.get("value") if cell else None

def blank_cell(col, row, hidden=False):
    return {"cell": column_label(col) + str(row), "column": column_label(col), "row": row,
            "type": "blank", "value": None, "raw": None, "present": False,
            "formula": None, "cachedPresent": False, "styleId": None,
            "numberFormat": None, "dateStyle": False, "hiddenRow": hidden}

class Workbook:
    def __init__(self, source, expected):
        self.source = source
        before = os.fstat(source.fileno())
        if not expected or before.st_size != expected.get("bytes") or before.st_size > LIMITS["sourceBytes"]:
            fail("WORKBOOK_SOURCE_CHANGED", "The original workbook size differs from its retained identity.")
        h = hashlib.sha256()
        while True:
            block = source.read(1024 * 1024)
            if not block: break
            h.update(block)
        after = os.fstat(source.fileno())
        if h.hexdigest() != expected.get("sha256") or (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            fail("WORKBOOK_SOURCE_CHANGED", "The workbook differs from its retained original bytes.")
        self.sha, self.size = h.hexdigest(), before.st_size
        source.seek(0)
        try:
            self.zip = zipfile.ZipFile(source)
        except zipfile.BadZipFile:
            fail("XLSX_REQUIRED", "Choose an unencrypted XLSX workbook.")
        infos = self.zip.infolist()
        if len(infos) > LIMITS["entries"] or sum(x.file_size for x in infos) > LIMITS["expandedBytes"]:
            fail("WORKBOOK_CAPACITY", "The expanded workbook exceeds the published intake limits.")
        names = [x.filename for x in infos]
        if len(set(names)) != len(names):
            fail("AMBIGUOUS_WORKBOOK", "The XLSX contains repeated package member names.")
        for item in infos:
            name = item.filename
            if item.flag_bits & 1 or item.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                fail("XLSX_COMPRESSION_UNSUPPORTED", "Choose an unencrypted stored/deflated XLSX workbook.")
            if item.file_size > LIMITS["partBytes"] or "\\" in name or "\x00" in name or name.startswith("/") or ".." in name.split("/"):
                fail("WORKBOOK_CAPACITY", "A workbook part has an unsupported path or exceeds its intake limit.")
        self.names = set(names)
        roots = self.relationships("", "_rels/.rels")
        offices = [x for x in roots.values() if x["type"].endswith("/officeDocument") and not x["external"]]
        if len(offices) != 1:
            fail("XLSX_REQUIRED", "The package must contain one original spreadsheet workbook.")
        self.part = offices[0]["target"]
        root = self.xml(self.part)
        namespace = root.tag.split("}")[0].lstrip("{")
        if local(root.tag) != "workbook" or namespace not in SHEET_NS:
            fail("XLSX_REQUIRED", "The original package is not a supported SpreadsheetML workbook.")
        if any(name.endswith("vbaProject.bin") for name in self.names):
            fail("XLSX_REQUIRED", "This intake accepts XLSX; save a separate macro-free XLSX for publication.")
        props = child(root, "workbookPr")
        self.epoch = "1904" if props is not None and props.get("date1904") in ("1", "true") else "1900"
        calc = child(root, "calcPr")
        self.calculation = dict(calc.attrib) if calc is not None else {}
        self.rels = self.relationships(self.part)
        self.external = sum(x["external"] for x in self.rels.values())
        self.strings = []
        string_parts = [x["target"] for x in self.rels.values() if x["type"].endswith("/sharedStrings") and not x["external"]]
        if len(string_parts) > 1:
            fail("AMBIGUOUS_WORKBOOK", "The workbook has multiple shared-string parts.")
        if string_parts:
            for item in self.xml(string_parts[0]):
                if local(item.tag) != "si": continue
                value = rich_text(item)
                if len(value) > LIMITS["cellChars"] or len(self.strings) >= LIMITS["strings"]:
                    fail("WORKBOOK_CAPACITY", "The shared-string table exceeds its intake limits.")
                self.strings.append(value)
        self.styles = []
        style_parts = [x["target"] for x in self.rels.values() if x["type"].endswith("/styles") and not x["external"]]
        if len(style_parts) > 1:
            fail("AMBIGUOUS_WORKBOOK", "The workbook has multiple style parts.")
        if style_parts:
            styles = self.xml(style_parts[0])
            formats = dict(KNOWN_FORMATS)
            formats_node = child(styles, "numFmts")
            if formats_node is not None:
                for fmt in formats_node:
                    if local(fmt.tag) == "numFmt":
                        formats[int(fmt.get("numFmtId"))] = fmt.get("formatCode", "")
            xfs = child(styles, "cellXfs")
            if xfs is not None:
                for xf in xfs:
                    fid = int(xf.get("numFmtId", "0"))
                    code = formats.get(fid)
                    cleaned = re.sub(r'"[^"]*"|\\.|_.|\*.', "", code or "")
                    cleaned = re.sub(r"\[[^\]]*\]", "", cleaned)
                    self.styles.append({"id": fid, "code": code,
                        "dateStyle": fid in DATE_FORMATS or bool(re.search(r"[ymdhs]", cleaned, re.I))})
        self.sheets = []
        self.cache = {}
        sheets = child(root, "sheets")
        for sheet in sheets if sheets is not None else []:
            if local(sheet.tag) != "sheet": continue
            rid = next((v for k, v in sheet.attrib.items() if k.endswith("}id")), None)
            rel = self.rels.get(rid)
            if not rel or rel["external"] or not rel["type"].endswith("/worksheet"):
                continue
            name = sheet.get("name")
            if not name or any(x["name"] == name for x in self.sheets):
                fail("AMBIGUOUS_WORKBOOK", "Worksheet names must be present and unique.")
            self.sheets.append({"id": sheet.get("sheetId"), "name": name,
                                "state": sheet.get("state", "visible"), "part": rel["target"]})
        if not self.sheets or len(self.sheets) > LIMITS["sheets"]:
            fail("WORKBOOK_CAPACITY", "Select a workbook containing 1–128 ordinary worksheets.")
        names_node = child(root, "definedNames")
        self.defined_names = [{"name": x.get("name"), "localSheetId": x.get("localSheetId"),
                               "text": x.text or "", "hidden": x.get("hidden") in ("1", "true")}
                              for x in names_node if local(x.tag) == "definedName"] if names_node is not None else []
        self.cells_seen = 0

    def xml(self, name):
        if name not in self.names:
            fail("WORKBOOK_PART_MISSING", "A required original workbook part is missing.")
        try:
            return check_xml(self.zip.read(name))
        except (zipfile.BadZipFile, RuntimeError, EOFError):
            fail("WORKBOOK_PART_DAMAGED", "A required workbook part could not be read intact.")

    def relationships(self, owner, name=None):
        name = name or rels_name(owner)
        if name not in self.names: return {}
        result = {}
        for row in self.xml(name):
            if local(row.tag) != "Relationship": continue
            rid = row.get("Id")
            if not rid or rid in result:
                fail("AMBIGUOUS_WORKBOOK", "Workbook relationship identifiers must be unique.")
            external = row.get("TargetMode") == "External"
            result[rid] = {"type": row.get("Type", ""), "external": external,
                           "target": None if external else member_target(owner, row.get("Target"))}
        return result

    def sheet(self, name):
        if name in self.cache: return self.cache[name]
        descriptor = next((x for x in self.sheets if x["name"] == name), None)
        if not descriptor: fail("WORKSHEET_NOT_FOUND", "Choose one of this original workbook's sheets.")
        root = self.xml(descriptor["part"])
        dimension = child(root, "dimension")
        cells, hidden, row_ids, bounds = {}, set(), set(), None
        count_formula = count_errors = count_dates = 0
        data = child(root, "sheetData")
        next_row = 1
        for row_node in data if data is not None else []:
            if local(row_node.tag) != "row": continue
            try: row_number = int(row_node.get("r", next_row))
            except ValueError: fail("INVALID_CELL_REFERENCE", "A worksheet row has an invalid coordinate.")
            integer(row_number, "Worksheet row", 1, 1048576)
            if row_number in row_ids: fail("AMBIGUOUS_WORKBOOK", "The worksheet repeats a row coordinate.")
            row_ids.add(row_number); next_row = row_number + 1
            is_hidden = row_node.get("hidden") in ("1", "true")
            if is_hidden: hidden.add(row_number)
            next_col = 1
            for item in row_node:
                if local(item.tag) != "c": continue
                ref = item.get("r") or column_label(next_col) + str(row_number)
                col, cell_row = coordinate(ref); next_col = col + 1
                if cell_row != row_number or (col, cell_row) in cells:
                    fail("AMBIGUOUS_WORKBOOK", "A worksheet cell repeats or disagrees with its row coordinate.")
                self.cells_seen += 1
                if self.cells_seen > LIMITS["cells"]:
                    fail("WORKBOOK_CAPACITY", "The workbook exceeds 500,000 observed cells.")
                kind = item.get("t", "n")
                v, f = child(item, "v"), child(item, "f")
                raw = v.text if v is not None else None
                value = raw
                if kind == "s":
                    if raw is None or not re.fullmatch(r"[0-9]+", raw) or int(raw) >= len(self.strings):
                        fail("INVALID_SHARED_STRING", "A cell references an unavailable original shared string.")
                    value, kind = self.strings[int(raw)], "string"
                elif kind == "inlineStr":
                    value, kind = rich_text(child(item, "is")), "string"
                elif kind == "str":
                    value, kind = excel_text(raw or ""), "string"
                elif kind == "b":
                    if raw not in ("0", "1"): fail("INVALID_BOOLEAN_CELL", "A Boolean cell must contain 0 or 1.")
                    value, kind = ("true" if raw == "1" else "false"), "boolean"
                elif kind == "e":
                    kind = "error"; count_errors += 1
                elif kind == "d":
                    kind = "date"; count_dates += 1
                elif kind == "n":
                    kind = "number" if raw is not None else "blank"
                else:
                    fail("UNSUPPORTED_CELL_TYPE", "A selected workbook contains an unsupported cell type: " + str(kind))
                if isinstance(value, str) and len(value) > LIMITS["cellChars"]:
                    fail("WORKBOOK_CAPACITY", "A cell exceeds the source text limit.")
                style_id = int(item.get("s", "0"))
                if style_id < 0 or self.styles and style_id >= len(self.styles):
                    fail("INVALID_CELL_STYLE", "A cell references an unavailable style.")
                style = self.styles[style_id] if self.styles else {"code": None, "dateStyle": False}
                formula = {"text": f.text, "attributes": dict(f.attrib)} if f is not None else None
                if formula: count_formula += 1
                if style["dateStyle"] and kind != "date": count_dates += 1
                cells[(col, cell_row)] = {"cell": ref, "column": column_label(col), "row": cell_row,
                    "type": kind, "value": value, "raw": raw, "present": True, "formula": formula,
                    "cachedPresent": v is not None and (raw is not None or item.get("t") == "str"),
                    "styleId": style_id, "numberFormat": style["code"], "dateStyle": style["dateStyle"],
                    "hiddenRow": is_hidden}
                bounds = (min(bounds[0], col), min(bounds[1], cell_row), max(bounds[2], col), max(bounds[3], cell_row)) if bounds else (col, cell_row, col, cell_row)
        merged = []
        m = child(root, "mergeCells")
        for item in m if m is not None else []:
            if local(item.tag) == "mergeCell":
                merged.append({"range": item.get("ref"), "bounds": selection_range(item.get("ref"))})
        columns = []
        cols = child(root, "cols")
        for col in cols if cols is not None else []:
            if local(col.tag) == "col":
                columns.append({"min": int(col.get("min")), "max": int(col.get("max")),
                                "hidden": col.get("hidden") in ("1", "true")})
        meta = {**descriptor, "declaredRange": dimension.get("ref") if dimension is not None else None,
                "observedRange": range_name(bounds) if bounds else None, "cellCount": len(cells),
                "rowCount": len(row_ids), "formulaCells": count_formula, "errorCells": count_errors,
                "dateCells": count_dates, "hiddenRowCount": len(hidden), "columnRanges": columns,
                "mergedRanges": [x["range"] for x in merged[:512]],
                "mergedRangeCount": len(merged), "mergedRangesComplete": len(merged) <= 512}
        result = {"metadata": meta, "cells": cells, "hidden": hidden, "merged": merged, "bounds": bounds}
        self.cache[name] = result
        return result

    def describe(self):
        return {"parser": PARSER, "epoch": self.epoch, "calculationProperties": self.calculation,
                "externalRelationships": self.external, "definedNames": self.defined_names,
                "sourceSha256": self.sha, "sourceBytes": self.size, "limits": LIMITS,
                "sheets": [self.sheet(x["name"])["metadata"] for x in self.sheets]}

    def inspect(self, request):
        sheet = self.sheet(request.get("sheet") or self.sheets[0]["name"])
        if request.get("range"):
            bounds = selection_range(request["range"])
        else:
            a, b, c, d = sheet["bounds"] or (1, 1, 1, 1)
            bounds = (a, b, min(c, a + 63), d)
        a, b, c, d = bounds
        if c - a + 1 > 64:
            fail("WORKBOOK_PREVIEW_WIDTH", "Select at most 64 columns for one source preview.")
        offset = integer(request.get("offset", 0), "Offset", 0, 1048576)
        limit = integer(request.get("limit", 30), "Limit", 1, 100)
        rows = []
        for row in range(b + offset, min(d + 1, b + offset + limit)):
            rows.append({"row": row, "hidden": row in sheet["hidden"], "cells": [
                sheet["cells"].get((col, row), blank_cell(col, row, row in sheet["hidden"]))
                for col in range(a, c + 1)]})
        return {"metadata": sheet["metadata"], "epoch": self.epoch, "range": range_name(bounds),
                "offset": offset, "limit": limit, "totalRows": d - b + 1,
                "nextOffset": offset + len(rows) if b + offset + len(rows) <= d else None,
                "columns": [column_label(x) for x in range(a, c + 1)], "rows": rows}

def schema_columns(config):
    cols = config.get("columns")
    if not isinstance(cols, dict) or not 1 <= len(cols) <= 64:
        fail("NATIVE_SCHEMA_REQUIRED", "Use the current original dataset's declared public columns.")
    out = []
    for name, raw in cols.items():
        spec = {"type": raw} if isinstance(raw, str) else raw
        if not isinstance(spec, dict) or spec.get("type") not in ("string", "number", "integer", "boolean"):
            fail("NATIVE_SCHEMA_REQUIRED", "The original dataset has an unsupported column declaration.")
        out.append({"name": name, "type": spec["type"], "nullable": spec.get("nullable", False)})
    return out

def validate_plan(plan, config):
    if not isinstance(plan, dict):
        fail("INVALID_WORKBOOK_PLAN", "Save an explicit workbook projection.")
    allowed = {"name","notes","sheet","range","headerRow","hiddenRows","blankRows","mergedCells","columns"}
    if set(plan) != allowed or not isinstance(plan["sheet"], str):
        fail("INVALID_WORKBOOK_PLAN", "The workbook plan has unsupported or missing fields.")
    bounds = selection_range(plan["range"])
    if plan["headerRow"] is not None:
        integer(plan["headerRow"], "Header row", bounds[1], bounds[3])
    for key, choices in {"hiddenRows": ("include","exclude"), "blankRows": ("keep","skip"),
                         "mergedCells": ("reject","anchor")}.items():
        if plan[key] not in choices: fail("INVALID_WORKBOOK_PLAN", "Choose an explicit " + key + " policy.")
    schema = schema_columns(config)
    if not isinstance(plan["columns"], list) or len(plan["columns"]) != len(schema):
        fail("INVALID_WORKBOOK_PLAN", "Map every declared public column exactly once.")
    mapped = {x.get("name"): x for x in plan["columns"] if isinstance(x, dict)}
    if len(mapped) != len(schema) or set(mapped) != {x["name"] for x in schema}:
        fail("INVALID_WORKBOOK_PLAN", "Map each original public column once, using its original name.")
    result = []
    for spec in schema:
        bind = mapped[spec["name"]]
        if set(bind) != {"name","source","blank","formula","error","date","trim","valueMap"}:
            fail("INVALID_WORKBOOK_PLAN", "A column mapping has unsupported or missing fields.")
        col = column_number(bind["source"])
        if not bounds[0] <= col <= bounds[2]:
            fail("INVALID_WORKBOOK_PLAN", "A mapped column falls outside the selected original range.")
        for key, choices in {"blank": ("reject","null","empty"), "formula": ("reject","cached","text"),
                             "error": ("reject","text","null"), "date": ("raw","iso-date","iso-datetime-ms")}.items():
            if bind[key] not in choices: fail("INVALID_WORKBOOK_PLAN", "Choose an explicit " + key + " policy.")
        if type(bind["trim"]) is not bool or not isinstance(bind["valueMap"], list) or len(bind["valueMap"]) > 256:
            fail("INVALID_WORKBOOK_PLAN", "Use an explicit text-trim choice and up to 256 value mappings.")
        seen = set()
        for item in bind["valueMap"]:
            if not isinstance(item, dict) or set(item) != {"from","to"} or not isinstance(item["from"], str) or not (item["to"] is None or isinstance(item["to"], str)) or item["from"] in seen:
                fail("INVALID_WORKBOOK_PLAN", "Value-map sources must be unique literal strings.")
            seen.add(item["from"])
            if max(len(item["from"]), len(item["to"] or "")) > config.get("maxCellChars", 65536):
                fail("INVALID_WORKBOOK_PLAN", "A value mapping exceeds the native cell limit.")
            if item["to"] is None and not spec["nullable"]:
                fail("INVALID_WORKBOOK_PLAN", "Only a nullable public column can map a value to null.")
        if (bind["blank"] == "null" or bind["error"] == "null") and not spec["nullable"]:
            fail("INVALID_WORKBOOK_PLAN", "Null requires a nullable original public column.")
        if bind["blank"] == "empty" and (spec["type"] != "string" or spec["nullable"]):
            fail("INVALID_WORKBOOK_PLAN", "Empty text requires a nonnullable original string column.")
        if (bind["formula"] == "text" or bind["date"] != "raw") and spec["type"] != "string":
            fail("INVALID_WORKBOOK_PLAN", "Formula text and ISO dates require an original string column.")
        result.append((spec, bind, col))
    return bounds, result

def date_value(value, kind, epoch, policy):
    if kind == "date":
        try:
            parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00")) if "T" in value else dt.date.fromisoformat(value)
        except (ValueError, TypeError):
            fail("INVALID_DATE_VALUE", "The original ISO date is invalid.")
        if policy == "iso-date":
            if isinstance(parsed, dt.datetime) and parsed.time() != dt.time():
                fail("DATE_HAS_TIME", "Date-only conversion would discard the original time.")
            return parsed.date().isoformat() if isinstance(parsed, dt.datetime) else parsed.isoformat()
        return value if isinstance(parsed, dt.datetime) else parsed.isoformat() + "T00:00:00.000"
    if not isinstance(value, str) or not NUMBER_RE.fullmatch(value) or len(value) > 1024:
        fail("DATE_SERIAL_REQUIRED", "Calendar conversion requires an original numeric serial or ISO date.")
    serial = Decimal(value)
    if not serial.is_finite() or serial < (0 if epoch == "1904" else 1) or serial > 3000000:
        fail("DATE_OUT_OF_RANGE", "Keep this original serial raw; it is outside supported calendar conversion.")
    day = int(serial)
    if epoch == "1900" and day == 60:
        fail("EXCEL_FICTIONAL_DATE", "The original serial identifies Excel's fictional 1900-02-29; keep it raw or correct the source.")
    with localcontext() as ctx:
        ctx.prec = max(40, len(serial.as_tuple().digits) + 20)
        fraction = serial - Decimal(day)
        if policy == "iso-date" and fraction:
            fail("DATE_HAS_TIME", "Date-only conversion would discard the original time fraction.")
        millis = int((fraction * Decimal(86400000)).quantize(Decimal(1), rounding=ROUND_HALF_EVEN))
    if epoch == "1900" and day == 59 and millis == 86400000:
        fail("EXCEL_FICTIONAL_DATE", "Millisecond conversion would round into Excel\'s fictional 1900-02-29; keep the serial raw.")
    origin = dt.datetime(1904,1,1) if epoch == "1904" else dt.datetime(1899,12,31)
    try:
        result = origin + dt.timedelta(days=day - (1 if epoch == "1900" and day > 60 else 0), milliseconds=millis)
    except OverflowError:
        fail("DATE_OUT_OF_RANGE", "The original serial exceeds the supported calendar.")
    return result.date().isoformat() if policy == "iso-date" else result.isoformat(timespec="milliseconds")

def mapped_value(cell, spec, bind, epoch):
    formula = cell.get("formula")
    value, kind = cell.get("value"), cell.get("type")
    if formula is not None:
        if bind["formula"] == "reject":
            fail("FORMULA_REVIEW_REQUIRED", "Select saved-cache or original-formula-text handling for this column.")
        if bind["formula"] == "text":
            if formula.get("text") is None:
                fail("FORMULA_TEXT_UNAVAILABLE", "This shared-formula follower has no stored equation text; choose its cache or an original recalculated source.")
            value, kind = "=" + formula["text"], "string"
        elif not cell.get("cachedPresent"):
            fail("FORMULA_CACHE_MISSING", "This formula has no original saved result. Recalculate/save the source or choose another explicit policy.")
    if kind == "error":
        if bind["error"] == "reject": fail("EXCEL_ERROR_VALUE", "Choose explicit handling for this original Excel error.")
        if bind["error"] == "null": return ""
    if bind["date"] != "raw" and value is not None and (formula is None or bind["formula"] != "text"):
        value = date_value(value, kind, epoch, bind["date"])
    if isinstance(value, str) and bind["trim"]: value = value.strip()
    replacements = {x["from"]: x["to"] for x in bind["valueMap"]}
    if isinstance(value, str) and value in replacements:
        value = replacements[value]
        if value is None: return ""
    if value is None or value == "":
        if bind["blank"] == "reject":
            fail("BLANK_CELL", "The selected original cell is empty under this mapping.")
        return ""
    if not isinstance(value, str):
        fail("UNSUPPORTED_CELL_VALUE", "The source value is not a supported literal.")
    if spec["type"] == "string": return value
    if spec["type"] == "boolean":
        if value not in ("true","false"):
            fail("BOOLEAN_MAPPING_REQUIRED", "Map the original value explicitly to true or false.")
        return value
    if len(value) > 1024 or not NUMBER_RE.fullmatch(value):
        fail("NUMERIC_MAPPING_REQUIRED", "Map the original value to the declared native numeric type.")
    try: number = Decimal(value)
    except InvalidOperation: fail("NUMERIC_MAPPING_REQUIRED", "The original numeric token is invalid.")
    if not number.is_finite(): fail("FINITE_NUMBER_REQUIRED", "The native dataset accepts finite numbers only.")
    if spec["type"] == "integer":
        if number != number.to_integral_value() or abs(number) > 9007199254740991:
            fail("NATIVE_INTEGER_RANGE", "The native integer column requires an exact safe integer; retain larger identifiers in a declared string column.")
        return str(int(number))
    try: finite = float(number)
    except (ValueError, OverflowError): finite = float("inf")
    if not (-float("inf") < finite < float("inf")):
        fail("FINITE_NUMBER_REQUIRED", "The original number exceeds the native finite-number range.")
    # Preserve source coefficient; original loadDatasetConfig owns actual Number coercion.
    if value.startswith("+"): value = value[1:]
    if value.startswith("."): value = "0" + value
    if value.startswith("-."): value = "-0" + value[1:]
    if value.endswith("."): value += "0"
    if not re.fullmatch(r"-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?", value):
        value = str(number)
    return value

def prepare(workbook, request, output, rows_output):
    plan, config = request["plan"], request["config"]
    bounds, bindings = validate_plan(plan, config)
    sheet = workbook.sheet(plan["sheet"])
    a, first, c, last = bounds
    if plan["headerRow"] is not None: first = plan["headerRow"] + 1
    selected_columns = {col for _, _, col in bindings}
    if plan["mergedCells"] == "reject":
        for merged in sheet["merged"]:
            l, t, r, b = merged["bounds"]
            if b >= first and t <= last and any(l <= x <= r for x in selected_columns):
                fail("MERGED_CELL_REVIEW", "The selected data intersects merged cells; choose original-anchor handling explicitly.", {"range": merged["range"]})
    merged_order = sorted((x["bounds"] for x in sheet["merged"]), key=lambda x: x[1])
    merged_cursor, active_merges = 0, []
    headers = []
    for spec, bind, col in bindings:
        header = sheet["cells"].get((col, plan["headerRow"])) if plan["headerRow"] is not None else None
        headers.append({**spec, "sourceColumn": bind["source"], "sourceHeader": scalar(header),
                        "sourceHeaderCell": header["cell"] if header else None})
    max_bytes = min(config.get("maxBytes", 64 * 1024 * 1024), request.get("maxCsvBytes", 64 * 1024 * 1024))
    max_rows = min(config.get("maxRows", 250000), 1000000)
    max_cell = config.get("maxCellChars", 65536)
    digest = hashlib.sha256(); map_digest = hashlib.sha256()
    max_prepared = request.get("maxPreparedBytes", max_bytes + 64 * 1024 * 1024)
    size = map_size = count = skipped_blank = skipped_hidden = 0
    examples, issues = [], []
    def write_record(values):
        nonlocal size
        buf = io.StringIO(newline="")
        csv.writer(buf, lineterminator="\n").writerow(values)
        raw = buf.getvalue().encode("utf-8")
        size += len(raw)
        if size > max_bytes or size + map_size > max_prepared: fail("WORKBOOK_CSV_CAPACITY", "The reviewed CSV exceeds the native or retained byte capacity.")
        output.write(raw); digest.update(raw)
    write_record([x["name"] for x in headers])
    for row in range(first, last + 1):
        if row in sheet["hidden"] and plan["hiddenRows"] == "exclude":
            skipped_hidden += 1; continue
        while merged_cursor < len(merged_order) and merged_order[merged_cursor][1] <= row:
            active_merges.append(merged_order[merged_cursor]); merged_cursor += 1
        active_merges = [x for x in active_merges if x[3] >= row]
        original = []
        for _, _, col in bindings:
            item = sheet["cells"].get((col, row), blank_cell(col, row, row in sheet["hidden"]))
            if plan["mergedCells"] == "anchor" and any(l <= col <= r and (col, row) != (l, t) for l,t,r,end in active_merges):
                item = blank_cell(col, row, row in sheet["hidden"])
            original.append(item)
        if plan["blankRows"] == "skip" and all(x["value"] in (None, "") and x["formula"] is None for x in original):
            skipped_blank += 1; continue
        if count >= max_rows: fail("WORKBOOK_ROW_CAPACITY", "The reviewed selection exceeds the native row limit.")
        values = []
        for (spec, bind, col), cell in zip(bindings, original):
            try:
                value = mapped_value(cell, spec, bind, workbook.epoch)
                if len(value) > max_cell: fail("NATIVE_CELL_CAPACITY", "The mapped value exceeds the original native cell limit.")
                values.append(value)
            except WorkbookError as error:
                issues.append({"cell": cell["cell"], "field": spec["name"], "code": error.code,
                               "message": str(error), "sourceValue": cell["value"][:512] if isinstance(cell["value"], str) else cell["value"],
                               "sourceValueTruncated": isinstance(cell["value"], str) and len(cell["value"]) > 512})
                values.append("")
        if issues:
            if len(issues) >= 50: break
            continue
        write_record(values)
        raw_map = (json.dumps({"record": count, "row": row}, separators=(",",":")) + "\n").encode()
        if size + map_size + len(raw_map) > max_prepared: fail("WORKBOOK_CSV_CAPACITY", "The CSV and its exact source-row map exceed retained capacity.")
        rows_output.write(raw_map); map_digest.update(raw_map); map_size += len(raw_map)
        if len(examples) < 20:
            examples.append({"record": count, "sourceRow": row,
                             "values": dict(zip([x["name"] for x in headers], values))})
        count += 1
    if issues:
        fail("WORKBOOK_PROJECTION_REJECTED", "Review the original cells and mapping choices before preparing this candidate.", {"issues": issues, "shownLimit": 50})
    return {"schema": SCHEMA, "parser": PARSER, "sourceSha256": workbook.sha,
            "sourceBytes": workbook.size, "epoch": workbook.epoch, "sheet": plan["sheet"],
            "range": range_name(bounds), "headerRow": plan["headerRow"], "columns": headers,
            "rowCount": count, "skippedBlankRows": skipped_blank, "skippedHiddenRows": skipped_hidden,
            "csvSha256": digest.hexdigest(), "csvBytes": size,
            "rowMapSha256": map_digest.hexdigest(), "rowMapBytes": map_size, "preview": examples}

def bundle(request):
    files = request["files"]
    members = []
    with os.fdopen(os.dup(7), "wb") as dest, zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for item in files:
            if item["fd"] not in (3,4,5,6) or item["name"] not in ("original.xlsx","data.csv","source-rows.jsonl","workbook-parser.py"):
                fail("INVALID_WORKBOOK_BUNDLE", "The source bundle has an unsupported original member.")
            h = hashlib.sha256(); count = 0
            with os.fdopen(os.dup(item["fd"]), "rb") as source, z.open(item["name"], "w", force_zip64=True) as target:
                source.seek(0)
                while True:
                    raw = source.read(1024 * 1024)
                    if not raw: break
                    count += len(raw)
                    if count > item["bytes"]: fail("WORKBOOK_SOURCE_CHANGED", "A retained export member grew.")
                    h.update(raw); target.write(raw)
            if count != item["bytes"] or h.hexdigest() != item["sha256"]:
                fail("WORKBOOK_SOURCE_CHANGED", "A retained export member differs from its reviewed identity.")
            members.append({"name": item["name"], "bytes": count, "sha256": h.hexdigest()})
        for name, content in request["documents"].items():
            if name not in ("candidate.json","dataset.json","workbook-projection.json","review.json"):
                fail("INVALID_WORKBOOK_BUNDLE", "The source bundle has an unsupported review member.")
            raw = content["text"].encode("utf-8")
            if len(raw) > 4 * 1024 * 1024: fail("WORKBOOK_CAPACITY", "A review member exceeds the bundle limit.")
            if len(raw) != content["bytes"] or hashlib.sha256(raw).hexdigest() != content["sha256"]:
                fail("WORKBOOK_SOURCE_CHANGED", "A retained review member differs from its exact bytes.")
            z.writestr(name, raw); members.append({"name": name, "bytes": len(raw), "sha256": content["sha256"]})
        manifest = {"schema": "stellar-forge.workbook-private-handoff.v1", "members": members}
        z.writestr("manifest.json", json.dumps(manifest, indent=2) + "\n")
    return {"manifest": manifest, "members": len(members) + 1}

def main():
    if sys.version_info < (3, 10): fail("WORKBOOK_PYTHON_VERSION", "Workbook intake requires Python 3.10 or newer.")
    raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024: fail("WORKBOOK_REQUEST_CAPACITY", "The workbook request is too large.")
    request = json.loads(raw)
    if request.get("action") == "bundle":
        return bundle(request)
    with os.fdopen(os.dup(3), "rb") as source:
        workbook = Workbook(source, request.get("source"))
        action = request.get("action")
        if action == "describe": return workbook.describe()
        if action == "inspect": return workbook.inspect(request)
        if action == "validate":
            validate_plan(request["plan"], request["config"]); workbook.sheet(request["plan"]["sheet"])
            return {"valid": True, "sourceSha256": workbook.sha}
        if action == "prepare":
            with os.fdopen(os.dup(4), "wb") as output, os.fdopen(os.dup(5), "wb") as row_output:
                result = prepare(workbook, request, output, row_output)
                output.flush(); os.fsync(output.fileno()); row_output.flush(); os.fsync(row_output.fileno())
                return result
        fail("INVALID_WORKBOOK_ACTION", "Choose a supported workbook operation.")

if __name__ == "__main__":
    try:
        value = main()
        sys.stdout.write(json.dumps({"ok": True, "result": value}, ensure_ascii=True, separators=(",",":")) + "\n")
    except WorkbookError as error:
        sys.stdout.write(json.dumps({"ok": False, "error": error.code, "message": str(error), "details": error.details}, ensure_ascii=True) + "\n")
        sys.exit(2)
    except Exception as error:
        sys.stdout.write(json.dumps({"ok": False, "error": "WORKBOOK_READ_FAILED",
            "message": "The workbook could not be read with its retained source and reviewed contract.", "type": type(error).__name__}) + "\n")
        sys.exit(2)
