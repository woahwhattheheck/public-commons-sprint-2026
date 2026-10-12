"""Read original transfer workbooks and bind reviewed custody rows to Records.

The original workbook is immutable. Excel formulas are retained with their cached
values and never executed; numeric/date lexemes and empty cells are not guessed.
This module uses the existing saved Records source and original custody engine.
"""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import io
import json
import os
import posixpath
import re
import stat
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from urllib.parse import unquote

from offsite_records_storage_invoice_reconciliation import engine

FILE_LIMIT = 8 * 1024 * 1024
UNPACKED_LIMIT = 64 * 1024 * 1024
XML_LIMIT = 24 * 1024 * 1024
PAGE_LIMIT = 500
PAGE_BYTES = 650 * 1024
MAX_ROWS = 10000
MAX_COLUMNS = 256
SHA = re.compile(r"^[0-9a-f]{64}$")
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$")
CELL = re.compile(r"^([A-Z]{1,3})([1-9][0-9]{0,6})$")
CARTON_FIELDS = ("carton_ref", "site_ref", "admitted_at", "terminated_at", "termination_kind")
TRANSFER_FIELDS = ("temporary_box", "schedule", "series_code", "series_title", "sequence_range",
                   "year_in_box", "destroy_date", "permanent_box", "remarks", "request_date")
ROLES = ("template", "reference", "transfer-request", "custody-inventory")
DOCUMENT_KINDS = ("instructions", "retention-schedule", "rate-authority", "custody-transfer",
                  "custody-receipt", "inventory", "other")


class WorkbookError(ValueError):
    pass


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def identity(value):
    return digest(canonical(value).encode("utf-8"))


def pairs(values):
    out = {}
    for key, value in values:
        if key in out:
            raise WorkbookError("Duplicate original JSON key: " + key)
        out[key] = value
    return out


def decode_json(raw):
    try:
        return json.loads(raw.decode("utf-8-sig"), object_pairs_hook=pairs, parse_float=str,
                          parse_constant=lambda token: (_ for _ in ()).throw(WorkbookError("Nonfinite JSON value: " + token)))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise WorkbookError("Retained configuration is not valid UTF-8 JSON: " + str(exc)) from exc


def object_value(value, label):
    if type(value) is not dict:
        raise WorkbookError(label + " must be an object")
    return value


def array(value, label, maximum=10000):
    if type(value) is not list or len(value) > maximum:
        raise WorkbookError(label + " must be an array within " + str(maximum) + " entries")
    return value


def text(value, label, limit=1000, optional=False):
    if type(value) is not str or len(value) > limit or "\0" in value or not optional and not value.strip():
        raise WorkbookError(label + " needs explicit text within " + str(limit) + " characters")
    return value


def integer(value, label, low, high):
    if type(value) is not int or not low <= value <= high:
        raise WorkbookError(label + " must be an integer from " + str(low) + " to " + str(high))
    return value


def utc(value, label):
    try:
        return engine._utc(value, label)
    except engine.InputError as exc:
        raise WorkbookError(str(exc)) from exc


def column_number(value):
    if type(value) is not str or not re.fullmatch(r"[A-Z]{1,3}", value):
        raise WorkbookError("Use an exact uppercase Excel column, such as A or AB")
    number = 0
    for character in value:
        number = number * 26 + ord(character) - 64
    if number > 16384:
        raise WorkbookError("Column is outside the original Excel worksheet")
    return number


def column_name(number):
    integer(number, "column", 1, 16384)
    value = ""
    while number:
        number, digit = divmod(number - 1, 26)
        value = chr(65 + digit) + value
    return value


def cell_parts(value):
    match = CELL.fullmatch(value or "")
    if not match:
        raise WorkbookError("Invalid original worksheet cell address: " + str(value))
    column, row = match.groups()
    return column_number(column), integer(int(row), "worksheet row", 1, 1048576)


def local_name(tag):
    return tag.rsplit("}", 1)[-1]


def children(node, name):
    return [child for child in node if local_name(child.tag) == name]


def first(node, name):
    return next((child for child in node if local_name(child.tag) == name), None)


def rich_text(node):
    if node is None:
        return ""
    result = []
    for child in node:
        name = local_name(child.tag)
        if name == "t":
            result.append(child.text or "")
        elif name == "r":
            result.extend(grand.text or "" for grand in child if local_name(grand.tag) == "t")
    return "".join(result)


def retained_bytes(base, descriptor):
    descriptor = object_value(descriptor, "original file")
    relative = descriptor.get("path")
    if type(relative) is not str or not relative or "\\" in relative or "\0" in relative:
        raise WorkbookError("Original files need local relative paths")
    path_parts = relative.split("/")
    if any(part in ("", ".", "..") for part in path_parts) or relative.startswith("/"):
        raise WorkbookError("Original file must remain in the same saved workspace")
    root = Path(base).resolve(strict=True)
    target = root.joinpath(*path_parts)
    try:
        info = target.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > FILE_LIMIT:
            raise WorkbookError("Original files must be regular and within the native 8 MiB limit")
        target.resolve(strict=True).relative_to(root)
        raw = target.read_bytes()
    except (OSError, ValueError) as exc:
        raise WorkbookError("Cannot read the retained original file: " + relative) from exc
    if len(raw) > FILE_LIMIT or type(descriptor.get("bytes")) is not int or descriptor["bytes"] != len(raw):
        raise WorkbookError("Retained original byte count differs: " + relative)
    if not SHA.fullmatch(str(descriptor.get("sha256", ""))) or descriptor["sha256"] != digest(raw):
        raise WorkbookError("Retained original SHA256 differs: " + relative)
    return raw


class Workbook:
    """A source reader, not a spreadsheet calculation or authoring engine."""

    def __init__(self, raw):
        if len(raw) > FILE_LIMIT:
            raise WorkbookError("Original workbook exceeds the native per-file limit")
        self.sha256, self.bytes = digest(raw), len(raw)
        try:
            self.archive = zipfile.ZipFile(io.BytesIO(raw))
        except (zipfile.BadZipFile, OSError) as exc:
            raise WorkbookError("The original is not an OOXML .xlsx workbook") from exc
        members = self.archive.infolist()
        if len(members) > 4096 or sum(item.file_size for item in members) > UNPACKED_LIMIT:
            raise WorkbookError("Original XLSX expansion exceeds the supported 64 MiB / 4096-part allowance")
        self.members = {}
        for item in members:
            name = item.filename
            if name in self.members or name.startswith("/") or "\\" in name or "\0" in name or ".." in name.split("/"):
                raise WorkbookError("Duplicate or invalid original XLSX part: " + name)
            if item.flag_bits & 1:
                raise WorkbookError("Encrypted workbook parts require an operator-provided readable original")
            if stat.S_ISLNK(item.external_attr >> 16):
                raise WorkbookError("A workbook part cannot be a symbolic link")
            self.members[name] = item
        if "[Content_Types].xml" not in self.members:
            raise WorkbookError("The original ZIP has no OOXML content-types part")
        self.content_types = self.xml("[Content_Types].xml")
        roots = self.relationships("")
        office = [row for row in roots if row["type"].endswith("/officeDocument") and row["mode"] != "External"]
        if len(office) != 1:
            raise WorkbookError("The original package needs exactly one internal workbook relationship")
        self.workbook_path = office[0]["resolved"]
        workbook = self.xml(self.workbook_path)
        if local_name(workbook.tag) != "workbook":
            raise WorkbookError("The original office document is not a spreadsheet workbook")
        relations = self.relationships(self.workbook_path)
        self.relations = {row["id"]: row for row in relations}
        if len(self.relations) != len(relations):
            raise WorkbookError("Duplicate original workbook relationship IDs")
        props = first(workbook, "workbookPr")
        self.date_system = "1904" if props is not None and props.get("date1904", "").lower() in ("1", "true") else "1900"
        self.calculation = dict(first(workbook, "calcPr").attrib) if first(workbook, "calcPr") is not None else {}
        self.defined_names = []
        names = first(workbook, "definedNames")
        if names is not None:
            self.defined_names = [{"name": child.get("name"), "value": child.text or "", "attributes": dict(child.attrib)}
                                  for child in names if local_name(child.tag) == "definedName"]
        self.sheets = []
        sheets = first(workbook, "sheets")
        if sheets is None:
            raise WorkbookError("The original workbook declares no worksheets")
        for sheet in sheets:
            if local_name(sheet.tag) != "sheet":
                continue
            relation_id = next((value for key, value in sheet.attrib.items() if local_name(key) == "id"), None)
            relation = self.relations.get(relation_id)
            if not relation or relation["mode"] == "External" or not relation["type"].endswith("/worksheet"):
                # Chartsheets are retained in original bytes and named explicitly.
                self.sheets.append({"name": sheet.get("name"), "sheetId": sheet.get("sheetId"), "relationshipId": relation_id,
                                    "state": sheet.get("state", "visible"), "kind": "non-worksheet", "part": None})
                continue
            name = text(sheet.get("name"), "worksheet name", 160)
            if any(row["name"] == name for row in self.sheets):
                raise WorkbookError("Duplicate original worksheet name")
            self.sheets.append({"name": name, "sheetId": sheet.get("sheetId"), "relationshipId": relation_id,
                                "state": sheet.get("state", "visible"), "kind": "worksheet", "part": relation["resolved"]})
        if len(self.sheets) > 256:
            raise WorkbookError("Original workbook exceeds the supported 256-sheet limit")
        self.strings = []
        shared = [row for row in relations if row["type"].endswith("/sharedStrings") and row["mode"] != "External"]
        if len(shared) > 1:
            raise WorkbookError("Duplicate original shared-string table")
        if shared:
            table = self.xml(shared[0]["resolved"])
            self.strings = [rich_text(item) for item in table if local_name(item.tag) == "si"]
        self.number_formats, self.styles = {}, []
        styles = [row for row in relations if row["type"].endswith("/styles") and row["mode"] != "External"]
        if len(styles) > 1:
            raise WorkbookError("Duplicate original style table")
        if styles:
            style = self.xml(styles[0]["resolved"])
            formats = first(style, "numFmts")
            if formats is not None:
                for item in formats:
                    if local_name(item.tag) == "numFmt":
                        self.number_formats[item.get("numFmtId")] = item.get("formatCode")
            cell_styles = first(style, "cellXfs")
            if cell_styles is not None:
                self.styles = [dict(item.attrib) for item in cell_styles if local_name(item.tag) == "xf"]
        self.cache = {}

    def close(self):
        self.archive.close()

    def xml(self, name):
        item = self.members.get(name)
        if item is None or item.is_dir() or item.file_size > XML_LIMIT:
            raise WorkbookError("Original XML part is absent or exceeds 24 MiB: " + name)
        try:
            raw = self.archive.read(item)
        except (zipfile.BadZipFile, OSError, RuntimeError) as exc:
            raise WorkbookError("Original XLSX part could not be decoded with its CRC: " + name) from exc
        if len(raw) != item.file_size or len(raw) > XML_LIMIT:
            raise WorkbookError("Original XML part size differs: " + name)
        if re.search(br"<!\s*(?:DOCTYPE|ENTITY)\b", raw, re.I):
            raise WorkbookError("External/document entities are not part of this source reader")
        try:
            return ET.fromstring(raw)
        except ET.ParseError as exc:
            raise WorkbookError("Malformed original workbook XML: " + name + ": " + str(exc)) from exc

    def relationships(self, part):
        name = "_rels/.rels" if not part else posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels")
        if name not in self.members:
            return []
        result = []
        for row in self.xml(name):
            if local_name(row.tag) != "Relationship":
                continue
            target = row.get("Target", "")
            mode = row.get("TargetMode", "Internal")
            resolved = None
            if mode != "External":
                decoded = unquote(target)
                if "\\" in decoded or "\0" in decoded or "?" in decoded or "#" in decoded or ":" in decoded:
                    raise WorkbookError("Invalid internal OOXML relationship target")
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(part), decoded.lstrip("/")) if not decoded.startswith("/") else decoded.lstrip("/"))
                if resolved.startswith("../") or resolved in ("", ".", "..") or resolved not in self.members:
                    raise WorkbookError("Internal OOXML relationship leaves its original package")
            result.append({"id": row.get("Id"), "type": row.get("Type", ""), "target": target,
                           "mode": mode, "resolved": resolved})
        return result

    def cell(self, node, row_number):
        reference = node.get("r")
        column, row = cell_parts(reference)
        if row != row_number:
            raise WorkbookError("Original cell address differs from its worksheet row: " + reference)
        kind = node.get("t", "n")
        value_node = first(node, "v")
        raw = None if value_node is None else value_node.text or ""
        formula_node = first(node, "f")
        formula = None if formula_node is None else {"text": formula_node.text or "", "attributes": dict(formula_node.attrib)}
        value = raw
        if kind == "s":
            if raw is None or not re.fullmatch(r"0|[1-9][0-9]*", raw) or int(raw) >= len(self.strings):
                raise WorkbookError("Original shared-string index is unavailable: " + reference)
            value = self.strings[int(raw)]
        elif kind == "inlineStr":
            value = rich_text(first(node, "is"))
        elif kind == "b":
            if raw not in (None, "", "0", "1"):
                raise WorkbookError("Invalid original Boolean lexeme: " + reference)
            value = None if raw in (None, "") else raw == "1"
        elif kind not in ("n", "str", "e", "d"):
            raise WorkbookError("Unsupported original cell type " + kind + " at " + reference)
        style_index = node.get("s")
        style = None
        if style_index is not None:
            if not re.fullmatch(r"0|[1-9][0-9]*", style_index) or int(style_index) >= len(self.styles):
                raise WorkbookError("Original cell style index is unavailable: " + reference)
            style = self.styles[int(style_index)]
        result = {"cell": reference, "column": column_name(column), "row": row, "type": kind, "value": value,
                  "raw": raw, "formula": formula, "styleIndex": int(style_index) if style_index is not None else None,
                  "numberFormatId": style.get("numFmtId") if style else None,
                  "numberFormat": self.number_formats.get(style.get("numFmtId")) if style else None,
                  "present": True}
        if kind == "e":
            result["error"] = raw
        return result

    def sheet(self, name):
        if name in self.cache:
            return self.cache[name]
        spec = next((sheet for sheet in self.sheets if sheet["name"] == name), None)
        if not spec or spec["kind"] != "worksheet":
            raise WorkbookError("Select an exact original worksheet name")
        document = self.xml(spec["part"])
        if local_name(document.tag) != "worksheet":
            raise WorkbookError("Original worksheet relationship is not a worksheet")
        data = first(document, "sheetData")
        rows, cell_count, populated = {}, 0, []
        if data is not None:
            inferred_row = 0
            for node in data:
                if local_name(node.tag) != "row":
                    continue
                raw_number = node.get("r")
                if raw_number is not None and not re.fullmatch(r"[1-9][0-9]*", raw_number):
                    raise WorkbookError("Invalid original worksheet row")
                number = int(raw_number) if raw_number is not None else inferred_row + 1
                integer(number, "original worksheet row", 1, 1048576)
                inferred_row = number
                if number in rows:
                    raise WorkbookError("Duplicate original worksheet row: " + str(number))
                cells = {}
                for child in node:
                    if local_name(child.tag) != "c":
                        continue
                    cell = self.cell(child, number)
                    if cell["column"] in cells:
                        raise WorkbookError("Duplicate original worksheet cell: " + cell["cell"])
                    cells[cell["column"]] = cell
                    cell_count += 1
                    if cell_count > 500000:
                        raise WorkbookError("Original worksheet exceeds the supported 500,000 stored-cell limit")
                    if cell["value"] not in (None, "") or cell["formula"] is not None:
                        populated.append((column_number(cell["column"]), number))
                rows[number] = {"row": number, "present": True, "hidden": node.get("hidden", "").lower() in ("1", "true"),
                                "attributes": dict(node.attrib), "cells": cells}
        dimension = first(document, "dimension")
        merges = first(document, "mergeCells")
        merged = [item.get("ref") for item in merges or [] if local_name(item.tag) == "mergeCell"]
        columns = first(document, "cols")
        validations = first(document, "dataValidations")
        hyperlinks = first(document, "hyperlinks")
        result = {**spec, "declaredDimension": dimension.get("ref") if dimension is not None else None,
                  "storedRows": len(rows), "storedCells": cell_count,
                  "populatedBounds": None if not populated else {
                      "firstColumn": column_name(min(item[0] for item in populated)),
                      "lastColumn": column_name(max(item[0] for item in populated)),
                      "firstRow": min(item[1] for item in populated), "lastRow": max(item[1] for item in populated)},
                  "mergedRanges": merged, "columns": [dict(item.attrib) for item in columns or []],
                  "validations": [{"attributes": dict(item.attrib), "formulas": [child.text or "" for child in item]}
                                  for item in validations or []],
                  "hyperlinks": [dict(item.attrib) for item in hyperlinks or []],
                  "relationships": self.relationships(spec["part"]), "_rows": rows}
        self.cache[name] = result
        return result

    def metadata(self, selected=None):
        sheets = []
        for spec in self.sheets:
            row = copy.deepcopy(spec)
            if selected == spec["name"] and spec["kind"] == "worksheet":
                row.update({key: value for key, value in self.sheet(spec["name"]).items() if key != "_rows"})
            sheets.append(row)
        return {"sha256": self.sha256, "bytes": self.bytes, "workbookPart": self.workbook_path,
                "dateSystem": self.date_system, "calculationProperties": self.calculation,
                "definedNames": self.defined_names, "sheets": sheets, "partCount": len(self.members),
                "interpretation": "Original cell values, numeric/date lexemes, formulas, cached results, blanks, hidden rows and merged ranges are retained. Formulas are not executed and merged cells are not filled down."}

    def rows(self, selection):
        spec = object_value(selection, "workbook.selection")
        sheet_name = text(spec.get("sheet"), "selection.sheet", 160)
        sheet = self.sheet(sheet_name)
        first_row = integer(spec.get("firstRow"), "selection.firstRow", 1, 1048576)
        last_row = integer(spec.get("lastRow"), "selection.lastRow", first_row, 1048576)
        first_column = column_number(spec.get("firstColumn"))
        last_column = column_number(spec.get("lastColumn"))
        if last_column < first_column or last_column - first_column + 1 > MAX_COLUMNS or last_row - first_row + 1 > MAX_ROWS:
            raise WorkbookError("Select at most 10,000 explicit rows and 256 explicit columns; the complete original remains retained")
        for number in range(first_row, last_row + 1):
            source = sheet["_rows"].get(number, {"row": number, "present": False, "hidden": False, "attributes": {}, "cells": {}})
            cells = {key: copy.deepcopy(value) for key, value in source["cells"].items()
                     if first_column <= column_number(key) <= last_column}
            bare = {"workbookSha256": self.sha256, "sheet": sheet_name, "row": number,
                    "firstColumn": column_name(first_column), "lastColumn": column_name(last_column),
                    "present": source["present"], "hidden": source["hidden"], "attributes": source["attributes"], "cells": cells}
            blank = not any(cell["value"] not in (None, "") or cell["formula"] is not None for cell in cells.values())
            yield {**bare, "id": sheet_name + "!" + str(number), "sourceRowSha256": identity(bare),
                   "blank": blank, "locator": sheet_name + "!" + column_name(first_column) + str(number) + ":" + column_name(last_column) + str(number)}


def locate(workspace_path=None, period_id=None, edition_id=None):
    path = Path(workspace_path or "workspace.json")
    if path.is_dir():
        path /= "workspace.json"
    path = path.resolve(strict=True)
    if not stat.S_ISREG(path.lstat().st_mode) or path.stat().st_size > FILE_LIMIT:
        raise WorkbookError("Select the original saved Records workspace.json")
    raw = path.read_bytes()
    config = object_value(decode_json(raw), "workspace")
    if config.get("schema") != "tj.records-operator-workspace.v1":
        raise WorkbookError("Select the original Records workspace schema")
    periods = array(config.get("periods"), "periods", 120)
    period = next((row for row in periods if row.get("id") == (period_id or config.get("selectedPeriod"))), None)
    if period is None:
        raise WorkbookError("Select an original named period")
    edition = next((row for row in array(period.get("editions"), "editions", 100)
                    if row.get("id") == (edition_id or period.get("selectedEdition"))), None)
    if edition is None:
        raise WorkbookError("Select an original retained edition")
    return path, raw, config, period, edition


class Intake:
    def __init__(self, base, descriptor):
        self.base = Path(base)
        self.descriptor = object_value(descriptor, "workbook intake")
        self.id = text(descriptor.get("id"), "workbook.id", 160)
        if descriptor.get("sourceId") is not None:
            text(descriptor["sourceId"], "workbook.sourceId", 160)
        self.role = descriptor.get("role", "reference")
        if self.role not in ROLES:
            raise WorkbookError("Choose template, reference, transfer-request or custody-inventory")
        utc(descriptor.get("capturedAt"), "workbook.capturedAt")
        text(descriptor.get("sourceKind"), "workbook.sourceKind", 300)
        if not re.fullmatch(r"captures/[0-9a-f]{64}\.xlsx", str(descriptor.get("path", ""))):
            raise WorkbookError("Retain the exact XLSX at captures/<sha256>.xlsx")
        self.raw = retained_bytes(base, descriptor)
        if Path(descriptor["path"]).stem != digest(self.raw):
            raise WorkbookError("Workbook capture name differs from its original SHA256")
        self.book = Workbook(self.raw)
        self.documents = {}
        for document in array(descriptor.get("documents", []), "workbook.documents", 100):
            document = object_value(document, "workbook document")
            name = text(document.get("id"), "document.id", 160)
            if name in self.documents:
                raise WorkbookError("Duplicate workbook supporting-document identity")
            if document.get("kind") not in DOCUMENT_KINDS:
                raise WorkbookError("Choose an explicit supporting-document kind")
            retained_bytes(base, document)
            self.documents[name] = copy.deepcopy(document)
        self.selection = descriptor.get("selection")
        self.field_map = object_value(descriptor.get("fieldMap", {}), "workbook.fieldMap")
        self.mapping = object_value(descriptor.get("mapping", {}), "workbook.mapping")
        self.constants = object_value(descriptor.get("constants", {}), "workbook.constants")
        for field, column in self.field_map.items():
            text(field, "original field name", 160)
            column_number(column)
        for field, column in self.mapping.items():
            if field not in CARTON_FIELDS:
                raise WorkbookError("Custody mapping field is outside the original carton schema: " + field)
            column_number(column)
        if set(self.mapping) & set(self.constants) or set(self.constants) - set(CARTON_FIELDS):
            raise WorkbookError("Custody constants must be explicit absent original carton fields")
        self.decisions = {}
        for decision in array(descriptor.get("rowDecisions", []), "workbook.rowDecisions", MAX_ROWS):
            number = integer(object_value(decision, "row decision").get("row"), "decision.row", 1, 1048576)
            if number in self.decisions:
                raise WorkbookError("One workbook row has more than one current disposition")
            self.decisions[number] = copy.deepcopy(decision)
        selected_binding = {key: copy.deepcopy(descriptor.get(key)) for key in
                            ("id", "path", "sha256", "bytes", "capturedAt", "sourceKind", "role", "selection", "fieldMap",
                             "mapping", "constants", "requiredFields", "requiredContext", "context", "documents",
                             "custody", "rowDecisions", "excludeBlankRows", "emptyInventory", "sourceId")}
        self.binding_sha = identity(selected_binding)
        self.selection_sha = identity({"sha256": descriptor["sha256"], "selection": self.selection})
        self.rows = list(self.book.rows(self.selection)) if self.selection else []
        if self.selection:
            low, high = column_number(self.selection["firstColumn"]), column_number(self.selection["lastColumn"])
            if any(not low <= column_number(column) <= high for column in [*self.field_map.values(), *self.mapping.values()]):
                raise WorkbookError("Every mapped original field must be inside the explicit selected column range")
        self.issues, self.items = [], []
        self.context = object_value(descriptor.get("context", {}), "workbook.context")
        self._assess()

    def close(self):
        self.book.close()

    def issue(self, code, message, row=None):
        result = {"code": code, "message": str(message)}
        if row is not None:
            result["row"] = row
        self.issues.append(result)
        return result

    def attribution(self, value, label):
        text(value.get("owner"), label + ".owner", 300)
        text(value.get("note"), label + ".note", 8000)
        utc(value.get("at"), label + ".at")

    def cell_value(self, row, column):
        cell = row["cells"].get(column)
        return None if cell is None else cell["value"]

    def validate_evidence(self, value, label, *, allow_workbook=False):
        evidence = object_value(value, label)
        identifier = evidence.get("documentId")
        text(evidence.get("reference"), label + ".reference", 2000)
        if identifier == "$workbook" and allow_workbook and self.role == "custody-inventory":
            return {"documentId": identifier, "path": self.descriptor["path"], "sha256": self.descriptor["sha256"],
                    "bytes": self.descriptor["bytes"], "reference": evidence["reference"]}
        document = self.documents.get(identifier)
        if document is None or document["kind"] not in ("custody-transfer", "custody-receipt", "inventory"):
            raise WorkbookError(label + " must identify retained actual custody/receipt/inventory evidence")
        return {key: copy.deepcopy(document[key]) for key in ("id", "path", "sha256", "bytes", "kind")} | {"reference": evidence["reference"]}

    def custody_summary(self):
        custody = object_value(self.descriptor.get("custody", {}), "workbook.custody")
        acknowledgments = {}
        for side in ("transferring", "receiving"):
            item = custody.get(side)
            if not item:
                acknowledgments[side] = {"status": "not-recorded"}
                continue
            try:
                object_value(item, "custody." + side)
                if item.get("status") != "acknowledged":
                    acknowledgments[side] = {"status": item.get("status", "not-recorded")}
                    continue
                for key in ("department", "name", "title"):
                    text(item.get(key), side + "." + key, 300)
                utc(item.get("at"), side + ".at")
                evidence = self.validate_evidence(item.get("evidence"), side + ".evidence")
                acknowledgments[side] = {"status": "acknowledged", "department": item["department"],
                                        "name": item["name"], "title": item["title"], "at": item["at"], "evidence": evidence}
            except WorkbookError as exc:
                acknowledgments[side] = {"status": "correction-required", "message": str(exc)}
        missing = []
        for field in array(custody.get("requiredFields", []), "custody.requiredFields", 100):
            if not custody.get(text(field, "required custody field", 160)):
                missing.append(field)
        complete = all(row["status"] == "acknowledged" for row in acknowledgments.values()) and not missing
        return {"status": "BOTH_ACKNOWLEDGMENTS_RETAINED" if complete else "REQUEST_OR_INCOMPLETE_ACKNOWLEDGMENT",
                "acknowledgments": acknowledgments, "missingDeclaredFields": missing,
                "interpretation": "These are attributed records of existing acknowledgments. The application does not sign, authorize, schedule or perform a custody transfer."}

    def _assess(self):
        if not self.selection:
            self.issue("RANGE_REQUIRED", "Choose the exact original worksheet and inclusive row/column range")
        if self.role in ("template", "reference"):
            self.issue("REFERENCE_NOT_CUSTODY", "Retained templates/reference documents do not establish inventory admission")
        custody_input = object_value(self.descriptor.get("custody", {}), "workbook.custody")
        require_acknowledgments = custody_input.get("requireBothAcknowledgments", False)
        if not isinstance(require_acknowledgments, bool):
            raise WorkbookError("custody.requireBothAcknowledgments must be an explicit boolean")
        if require_acknowledgments and self.custody["status"] != "BOTH_ACKNOWLEDGMENTS_RETAINED":
            self.issue("DECLARED_CUSTODY_ACKNOWLEDGMENTS_REQUIRED",
                       "This configured transfer requires both actual acknowledgments and its declared request fields")
        for field in array(self.descriptor.get("requiredContext", []), "requiredContext", 100):
            if not self.context.get(text(field, "required context field", 160)):
                self.issue("CONTEXT_REQUIRED", "Supply the declared original context: " + field)
        required_fields = array(self.descriptor.get("requiredFields", []), "requiredFields", 100)
        blank_rule = self.descriptor.get("excludeBlankRows")
        blank_rule_valid = False
        if blank_rule:
            try:
                self.attribution(object_value(blank_rule, "blank-row disposition"), "blank-row disposition")
                if blank_rule.get("selectionSha256") != self.selection_sha:
                    raise WorkbookError("Blank-row disposition belongs to another original workbook/range")
                blank_rule_valid = True
            except WorkbookError as exc:
                self.issue("BLANK_ROW_REVIEW_CHANGED", str(exc))
        seen_rows = {row["row"] for row in self.rows}
        for number in self.decisions:
            if number not in seen_rows:
                self.issue("ROW_OUTSIDE_SELECTION", "A retained row decision is outside the current explicit range", number)
        duplicate_cartons = {}
        for original in self.rows:
            number = original["row"]
            fields = {name: self.cell_value(original, column) for name, column in self.field_map.items()}
            decision = self.decisions.get(number)
            derived_blank = False
            if decision is None and original["blank"] and blank_rule_valid:
                decision = {**copy.deepcopy(blank_rule), "row": number, "status": "exclude",
                            "sourceRowSha256": original["sourceRowSha256"]}
                derived_blank = True
            decision = copy.deepcopy(decision) if decision else {"row": number, "status": "pending"}
            status = decision.get("status", "pending")
            values = {key: self.cell_value(original, column) for key, column in self.mapping.items()}
            values.update(copy.deepcopy(self.constants))
            explicit = object_value(decision.get("values", {}), "row decision values")
            if set(explicit) - set(CARTON_FIELDS):
                raise WorkbookError("Row override is outside the original carton schema")
            values.update(copy.deepcopy(explicit))
            item = {**original, "fields": fields, "decision": decision, "disposition": status,
                    "fromBlankRule": derived_blank, "values": values, "issues": [], "evidence": None}
            try:
                if status not in ("pending", "include", "exclude"):
                    raise WorkbookError("Choose pending, include or exclude for each original row")
                if status == "pending":
                    raise WorkbookError("The original row needs an attributed include/exclude decision")
                self.attribution(decision, "row decision")
                if decision.get("sourceRowSha256") != original["sourceRowSha256"]:
                    raise WorkbookError("The original sheet/cell row changed since this decision")
                if status == "include":
                    if original["blank"]:
                        raise WorkbookError("An entirely blank workbook row is not a custody record")
                    for field in required_fields:
                        if fields.get(field) in (None, ""):
                            raise WorkbookError("The declared original row field is absent: " + str(field))
                    for key, column in self.mapping.items():
                        cell = original["cells"].get(column)
                        if cell and (cell["formula"] is not None or cell["type"] == "e") and key not in explicit:
                            raise WorkbookError("A formula/error cell needs an explicit reviewed custody value: " + key)
                    for original_field, canonical_field, reason in (
                        ("temporary_box", "carton_ref", "A temporary request number is not an authority-assigned permanent carton ID"),
                        ("destroy_date", "terminated_at", "A scheduled destruction date is not an actual destruction event"),
                        ("request_date", "admitted_at", "A request date is not an actual custody admission")):
                        if self.field_map.get(original_field) and self.mapping.get(canonical_field) == self.field_map[original_field] and canonical_field not in explicit:
                            raise WorkbookError(reason)
                    for key in ("carton_ref", "site_ref"):
                        if not ID.fullmatch(str(values.get(key, ""))):
                            raise WorkbookError("Supply the actual original " + key + " within the engine's identifier contract")
                    admitted = utc(values.get("admitted_at"), "actual admitted_at")
                    ended = values.get("terminated_at")
                    kind = values.get("termination_kind")
                    if ended in ("", None):
                        values["terminated_at"] = None
                        if kind not in ("", None):
                            raise WorkbookError("An active carton cannot have a termination kind")
                        values["termination_kind"] = None
                    else:
                        if utc(ended, "actual terminated_at") <= admitted or kind not in ("WITHDRAWN", "DESTROYED"):
                            raise WorkbookError("Closed custody needs a later actual UTC event and WITHDRAWN or DESTROYED")
                    item["evidence"] = self.validate_evidence(decision.get("evidence"), "row custody evidence", allow_workbook=True)
                    carton = values["carton_ref"]
                    if carton in duplicate_cartons:
                        raise WorkbookError("This actual carton is also included from worksheet row " + str(duplicate_cartons[carton]))
                    duplicate_cartons[carton] = number
            except WorkbookError as exc:
                issue = self.issue("ROW_DECISION_REQUIRED" if status == "pending" else "ROW_REVIEW_CORRECTION", str(exc), number)
                item["issues"].append(issue)
            self.items.append(item)
        review = self.descriptor.get("review")
        self.review_current = False
        if review:
            try:
                self.attribution(object_value(review, "mapping review"), "mapping review")
                if review.get("bindingSha256") != self.binding_sha:
                    raise WorkbookError("The reviewed source/mapping/row/document binding has changed")
                self.review_current = True
            except WorkbookError as exc:
                self.issue("MAPPING_REVIEW_CHANGED", str(exc))
        else:
            self.issue("MAPPING_REVIEW_REQUIRED", "Record the named review of this exact source, mapping and row decisions")
        includes = sum(row["disposition"] == "include" for row in self.items)
        if includes == 0 and not (self.role == "custody-inventory" and self.descriptor.get("emptyInventory") is True):
            self.issue("NO_ACTUAL_CUSTODY_ROWS", "No actual custody rows have been selected; the received original remains available")
        if includes > 2500:
            self.issue("CUSTODY_CAPACITY", "The original engine accepts at most 2,500 cartons in one reconciliation")
        self.custody = self.custody_summary()

    def summary(self):
        counts = dict(Counter(row["disposition"] for row in self.items))
        return {"id": self.id, "label": self.descriptor.get("label", self.id), "role": self.role,
                "path": self.descriptor["path"], "bytes": self.descriptor["bytes"], "sha256": self.descriptor["sha256"],
                "selection": self.selection, "selectionSha256": self.selection_sha, "bindingSha256": self.binding_sha,
                "rows": len(self.items), "blankRows": sum(row["blank"] for row in self.items),
                "hiddenRows": sum(row["hidden"] for row in self.items),
                "included": counts.get("include", 0), "excluded": counts.get("exclude", 0), "pending": counts.get("pending", 0),
                "issueCount": len(self.issues), "issues": self.issues[:100], "reviewCurrent": self.review_current,
                "readyForCustodySource": not self.issues and self.review_current,
                "custody": self.custody, "documents": list(self.documents.values()),
                "interpretation": "All rows in the explicit range, including blank/hidden/excluded rows, remain in the retained intake. Only individually reviewed actual custody records can enter the original carton ledger."}

    def source(self):
        if self.issues or not self.review_current:
            return None
        return {"id": self.descriptor.get("sourceId") or "workbook:" + identity(self.id)[:24], "table": "cartons", "format": "xlsx",
                "workbookId": self.id, "workbookBindingSha256": self.binding_sha,
                **{key: self.descriptor[key] for key in ("path", "sha256", "bytes", "capturedAt", "sourceKind")},
                "label": self.descriptor.get("label", self.id),
                "mapping": {key: key for key in (*CARTON_FIELDS, "evidence_ref", "evidence_sha256")},
                "constants": {}, "valueMaps": {}}

    def ledger_rows(self):
        if self.issues or not self.review_current:
            raise WorkbookError("Original workbook intake needs its displayed row/source corrections before custody projection")
        result = []
        for item in self.items:
            if item["disposition"] != "include":
                continue
            source = {"workbookId": self.id, "workbookPath": self.descriptor["path"], "workbookSha256": self.descriptor["sha256"],
                      "sheet": item["sheet"], "row": item["row"], "locator": item["locator"],
                      "sourceRowSha256": item["sourceRowSha256"], "bindingSha256": self.binding_sha,
                      "cells": item["cells"], "fields": item["fields"], "decision": item["decision"], "evidence": item["evidence"]}
            evidence_sha = identity(source)
            result.append({**copy.deepcopy(item["values"]), "evidence_ref": "workbook:" + evidence_sha[:32],
                           "evidence_sha256": evidence_sha, "_workbook": source})
        return result


def workbook_descriptors(edition):
    values = array(edition.get("workbooks", []), "edition.workbooks", 100)
    seen = set()
    for value in values:
        name = text(object_value(value, "workbook").get("id"), "workbook.id", 160)
        if name in seen:
            raise WorkbookError("Duplicate workbook ID in the retained edition")
        seen.add(name)
    return values


def read_workbook_source(source, edition, base):
    if source.get("table") != "cartons":
        raise WorkbookError("This transfer bridge projects only the original custody carton schema")
    descriptor = next((row for row in workbook_descriptors(edition) if row["id"] == source.get("workbookId")), None)
    if descriptor is None:
        raise WorkbookError("The exact workbook intake is absent from this edition")
    intake = Intake(base, descriptor)
    try:
        for key in ("path", "bytes", "sha256"):
            if source.get(key) != descriptor.get(key):
                raise WorkbookError("Custody source differs from its original workbook binding")
        if source.get("workbookBindingSha256") != intake.binding_sha:
            raise WorkbookError("Custody source binds an earlier workbook review; inspect and explicitly refresh its mapping")
        expected = intake.source()
        if expected is None:
            raise WorkbookError("Workbook source review is incomplete; inspect_workbook retains every specific row and input issue")
        if source.get("mapping", {}) != expected["mapping"] or source.get("constants", {}) or source.get("valueMaps", {}):
            raise WorkbookError("Change actual custody values in the workbook row review, then refresh the explicit source binding")
        rows = intake.ledger_rows()
        return rows, [*CARTON_FIELDS, "evidence_ref", "evidence_sha256", "_workbook"], intake.summary()
    finally:
        intake.close()


def inspect_workbook(value=None, *, workspace_path=None):
    options = object_value(value or {}, "workbook input")
    allowed = {"periodId", "editionId", "workbookId", "sheet", "offset", "limit", "query", "row"}
    if set(options) - allowed:
        raise WorkbookError("Unknown workbook inspection input")
    path, raw, config, period, edition = locate(workspace_path, options.get("periodId"), options.get("editionId"))
    descriptors = workbook_descriptors(edition)
    selected = options.get("workbookId")
    if selected is None:
        report = {"workspace": {"title": config.get("title")}, "period": {"id": period["id"], "label": period.get("label")},
                  "edition": {"id": edition["id"], "label": edition.get("label")}, "workbooks": [
                      {key: copy.deepcopy(row.get(key)) for key in ("id", "label", "path", "sha256", "bytes", "role", "selection")}
                      for row in descriptors]}
        return {"schema": "tj.records-workbook-inspection.v1", "report": report, "workbook": None, "assessment": None,
                "page": {"offset": 0, "limit": len(descriptors), "total": len(descriptors), "items": report["workbooks"],
                         "hasMore": False, "nextOffset": None}, "custodySource": None}
    descriptor = next((row for row in descriptors if row["id"] == selected), None)
    if descriptor is None:
        raise WorkbookError("Select an existing retained workbook ID")
    intake = Intake(path.parent, descriptor)
    try:
        offset = integer(options.get("offset", 0), "offset", 0, 1048576)
        limit = integer(options.get("limit", 100), "limit", 1, PAGE_LIMIT)
        requested_sheet = options.get("sheet")
        selected_sheet = requested_sheet or (intake.selection or {}).get("sheet")
        rows = intake.items
        inspection_scope = {"kind": "declared-intake-range", "range": intake.selection, "complete": True}
        if requested_sheet and (not intake.selection or requested_sheet != intake.selection.get("sheet")):
            sheet = intake.book.sheet(requested_sheet)
            bounds = sheet["populatedBounds"]
            if bounds:
                # Inspection never changes the user's saved admission range.
                first_column = column_number(bounds["firstColumn"])
                last_column = min(column_number(bounds["lastColumn"]), first_column + MAX_COLUMNS - 1)
                last_row = min(bounds["lastRow"], bounds["firstRow"] + MAX_ROWS - 1)
                selection = {**bounds, "sheet": requested_sheet, "lastColumn": column_name(last_column), "lastRow": last_row}
                rows = list(intake.book.rows(selection))
                inspection_scope = {"kind": "worksheet-overview", "range": selection, "originalPopulatedBounds": bounds,
                                    "complete": last_row == bounds["lastRow"] and last_column == column_number(bounds["lastColumn"])}
            else:
                rows = []
        if options.get("row") is not None:
            number = integer(options["row"], "row", 1, 1048576)
            rows = [row for row in rows if row["row"] == number]
        query = text(options.get("query", ""), "query", 300, optional=True).casefold()
        if query:
            rows = [row for row in rows if query in canonical(row).casefold()]
        assessment = intake.summary()
        page_rows, size = [], 0
        for row in rows[offset:offset + limit]:
            length = len(canonical(row).encode("utf-8")) + 1
            if size + length > PAGE_BYTES:
                if not page_rows:
                    raise WorkbookError("The original row exceeds native output; use the complete workbook export")
                break
            page_rows.append(row)
            size += length
        after = offset + len(page_rows)
        result = {"schema": "tj.records-workbook-inspection.v1",
                  "report": {"workspace": {"title": config.get("title")}, "period": {"id": period["id"], "label": period.get("label")},
                             "edition": {"id": edition["id"], "label": edition.get("label")}, "workspaceSha256": digest(raw)},
                  "workbook": intake.book.metadata(selected_sheet), "assessment": assessment, "inspectionScope": inspection_scope,
                  "page": {"view": "workbook-rows", "offset": offset, "requestedLimit": limit, "limit": len(page_rows),
                           "total": len(rows), "items": page_rows, "nextOffset": after if after < len(rows) else None,
                           "hasMore": after < len(rows), "byteLimited": len(page_rows) < min(limit, max(0, len(rows) - offset))},
                  "custodySource": intake.source()}
        if len(canonical(result).encode("utf-8")) > 1024 * 1024:
            raise WorkbookError("Original workbook metadata exceeds native output; use the complete same-source workbook export")
        return result
    finally:
        intake.close()


def export_workbook(workspace_path, output_dir, workbook_id, period_id=None, edition_id=None):
    path, workspace_raw, config, period, edition = locate(workspace_path, period_id, edition_id)
    descriptor = next((row for row in workbook_descriptors(edition) if row["id"] == workbook_id), None)
    if descriptor is None:
        raise WorkbookError("Select an original retained workbook ID")
    intake = Intake(path.parent, descriptor)
    destination = Path(output_dir).resolve()
    if destination.exists():
        intake.close()
        raise WorkbookError("Use a new complete workbook handoff directory")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="." + destination.name + ".workbook-", dir=destination.parent))
    files = []

    def write(name, raw, content_type):
        target = temporary / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        files.append({"path": name, "bytes": len(raw), "sha256": digest(raw), "contentType": content_type})

    def write_json(name, value):
        write(name, (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8"), "application/json")

    try:
        write("original.xlsx", intake.raw, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        for index, document in enumerate(intake.documents.values()):
            suffix = Path(document["path"]).suffix
            write("documents/" + str(index + 1) + "-" + document["sha256"] + suffix,
                  retained_bytes(path.parent, document), "application/octet-stream")
        write_json("intake.json", descriptor)
        write_json("workbook.json", intake.book.metadata((intake.selection or {}).get("sheet")))
        write_json("review.json", intake.summary())
        write_json("custody-source.json", intake.source())
        write_json("custody-rows.json", intake.ledger_rows() if intake.source() else [])
        row_path = temporary / "workbook-rows.ndjson"
        row_sha, row_bytes = hashlib.sha256(), 0
        with row_path.open("xb") as handle:
            for row in intake.items:
                raw = (canonical(row) + "\n").encode("utf-8")
                handle.write(raw)
                row_sha.update(raw)
                row_bytes += len(raw)
            handle.flush()
            os.fsync(handle.fileno())
        files.append({"path": "workbook-rows.ndjson", "bytes": row_bytes, "sha256": row_sha.hexdigest(),
                      "contentType": "application/x-ndjson"})
        readme = ("# Original transfer workbook receiving\n\n"
                  "This directory retains the exact supplied workbook, supporting documents, all rows in the explicit selection, "
                  "cell/formula/blank identity and named row/mapping decisions. The workbook is not recalculated or rewritten.\n\n"
                  "A transfer request, temporary box number, scheduled destroy date or unsigned custody form is not an actual custody event. "
                  "Only a current, complete named source review can produce custody-source.json and its original carton records. "
                  "The native Records engine still requires the complete policy, custody, service and invoice authorities; this intake export "
                  "does not create or complete those ledgers.\n\n"
                  "Use the original Records workspace portable export for full revision/history/application receiving. "
                  "Customer handoffs use the original Records customer projection; this intake directory is the operator source package.\n")
        write("README.md", readme.encode("utf-8"), "text/markdown; charset=utf-8")
        manifest = {"schema": "tj.records-workbook-handoff.v1", "workbookId": intake.id, "periodId": period["id"],
                    "editionId": edition["id"], "workspaceSha256": digest(workspace_raw), "workbookSha256": intake.descriptor["sha256"], "bindingSha256": intake.binding_sha,
                    "allSelectedRowsRetained": len(intake.items) == (intake.selection["lastRow"] - intake.selection["firstRow"] + 1) if intake.selection else True,
                    "readyForCustodySource": intake.source() is not None, "rows": len(intake.items), "files": [dict(row) for row in files]}
        write_json("manifest.json", manifest)
        if destination.exists():
            raise WorkbookError("Workbook handoff destination appeared while writing")
        os.rename(temporary, destination)
        fd = os.open(destination.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        return {"directory": str(destination), "manifest": manifest}
    finally:
        intake.close()


def main():
    parser = argparse.ArgumentParser(description="Inspect/export the original retained Records workbook without changing it")
    parser.add_argument("command", choices=("inspect", "export"))
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--workbook")
    parser.add_argument("--period")
    parser.add_argument("--edition")
    parser.add_argument("--sheet")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--out")
    args = parser.parse_args()
    if args.command == "export":
        if not args.workbook or not args.out:
            parser.error("export requires --workbook and --out")
        result = export_workbook(args.workspace, args.out, args.workbook, args.period, args.edition)
    else:
        result = inspect_workbook({key: value for key, value in {
            "workbookId": args.workbook, "periodId": args.period, "editionId": args.edition,
            "sheet": args.sheet, "offset": args.offset, "limit": args.limit}.items() if value is not None},
            workspace_path=args.workspace)
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except (WorkbookError, OSError, zipfile.BadZipFile) as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}), file=sys.stderr)
        raise SystemExit(1)
