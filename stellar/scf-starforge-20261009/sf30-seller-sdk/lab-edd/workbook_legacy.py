#!/usr/bin/env python3
"""MIT. Source-bound BIFF8 intake and DTS8D XLSX reissue.

The pinned, unmodified xlrd source owns legacy Excel/Compound File parsing.
This adapter retains physical BIFF cell records, cached formula state, styles,
epochs and the original container. The existing Lab process host owns its lifetime.
Prepared DTS data is an explicitly named XLSX; the original XLS remains unchanged.
"""
import base64
import hashlib
import importlib.util
import io
import math
from pathlib import Path
import struct
import sys
import zipfile
import xml.etree.ElementTree as ET

UPSTREAM = "https://github.com/python-excel/xlrd/tree/d8302dc39b16c03d643ef1eee89605c2e007ed2b"
PARSER = "stellar-forge.xls-biff8-reader.v1+xlrd-2.0.2-d8302dc3"
ACKNOWLEDGEMENT = "This product includes software developed by David Giffin <david@giffin.org>."
_CELL_RECORDS = {0x0006, 0x0206, 0x0406, 0x0201, 0x0203, 0x0204, 0x0205, 0x027E, 0x00FD, 0x00D6}
_FORMULAS = {0x0006, 0x0206, 0x0406}
_BIFF_NAMES = {0x0006:"FORMULA", 0x0206:"FORMULA", 0x0406:"FORMULA", 0x0201:"BLANK",
               0x0203:"NUMBER", 0x0204:"LABEL", 0x0205:"BOOLERR", 0x027E:"RK",
               0x00FD:"LABELSST", 0x00D6:"RSTRING", 0x00BD:"MULRK", 0x00BE:"MULBLANK"}
_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

def dependency():
    name = "starforge_lab_xlrd_2_0_2"
    if name not in sys.modules:
        directory = Path(__file__).resolve().parent / "vendor" / "xlrd"
        spec = importlib.util.spec_from_file_location(name, directory / "__init__.py",
                                                       submodule_search_locations=[str(directory)])
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        try:
            spec.loader.exec_module(module)
        except BaseException:
            sys.modules.pop(name, None)
            raise
    return sys.modules[name]

class LegacyWorkbook:
    format = "xls"
    parser = PARSER

    def __init__(self, source, expected, reader):
        self.reader = reader
        self.source = source
        self.book = None
        self._sheets = {}
        self._cell_count = 0
        source.seek(0)
        self.raw = source.read(reader.LIMITS["sourceBytes"] + 1)
        self.size = len(self.raw)
        self.sha = hashlib.sha256(self.raw).hexdigest()
        self.demand(0 < self.size <= reader.LIMITS["sourceBytes"] and
                    expected.get("bytes") == self.size and expected.get("sha256") == self.sha,
                    "LAB_EDD_WORKBOOK_CHANGED", "Use the complete unchanged legacy workbook.")
        self.demand(self.raw[:8] == bytes.fromhex("d0cf11e0a1b11ae1"),
                    "DTS8D_LEGACY_CONTAINER", "Use an original Excel 97–2003 BIFF8 XLS compound file.")
        self.xlrd = dependency()
        self.diagnostics = io.StringIO()
        try:
            self.book = self.xlrd.open_workbook(file_contents=self.raw, formatting_info=True,
                on_demand=True, ragged_rows=True, logfile=self.diagnostics,
                ignore_workbook_corruption=False)
            self.demand(self.book.biff_version == 80, "DTS8D_LEGACY_BIFF_VERSION",
                        "This legacy intake supports Excel 97–2003 BIFF8.",
                        {"biffVersion": self.book.biff_version})
            self.demand(0 < self.book.nsheets <= reader.LIMITS["sheets"], "LAB_EDD_SHEET_COUNT",
                        "The complete original workbook exceeds the worksheet allowance.")
            self.epoch = "1904" if self.book.datemode == 1 else "1900"
            self.stream = bytes(self.book.mem[self.book.base:self.book.base+self.book.stream_len])
            self.stream_sha256 = hashlib.sha256(self.stream).hexdigest()
            compound = self.xlrd.compdoc.CompDoc(self.raw, logfile=self.diagnostics,
                                                ignore_workbook_corruption=False)
            self.compound_entries = []
            for entry in compound.dirlist:
                if entry.etype == 0:
                    continue
                parts, cursor, seen = [], entry, set()
                while cursor is not None and cursor.DID not in seen:
                    seen.add(cursor.DID)
                    if cursor.DID != 0: parts.append(cursor.name)
                    parent = cursor.parent
                    cursor = compound.dirlist[parent] if parent is not None and parent >= 0 else None
                self.compound_entries.append({"path": "/".join(reversed(parts)),
                    "name": entry.name, "type": entry.etype, "bytes": entry.tot_size})
            self.names = {entry["path"] for entry in self.compound_entries}
            streams = [entry for entry in self.compound_entries if entry["type"] == 2 and
                       "/" not in entry["path"] and entry["name"].lower() in ("workbook", "book")]
            self.demand(len(streams) == 1, "LAB_EDD_BIFF_WORKBOOK_STREAM",
                        "Select a legacy source with one unambiguous original workbook stream.")
            self.stream_name = streams[0]["name"]
            self.sheet_inventory = []
            self.calculation = {"sourceFormat": "BIFF8", "records": []}
            for code, payload, offset in self.records(0):
                if code == 0x0085:
                    self.demand(len(payload) >= 8, "LAB_EDD_BIFF_RECORD", "An original sheet descriptor is incomplete.")
                    position, visibility, sheet_type = struct.unpack_from("<IBB", payload)
                    name = self.xlrd.biffh.unpack_unicode(payload, 6, lenlen=1)
                    self.sheet_inventory.append({"name": name, "index": len(self.sheet_inventory),
                        "offset": position, "visibility": visibility, "type": sheet_type})
                elif code in (0x000C, 0x000D, 0x000E, 0x000F, 0x0010, 0x0011, 0x005F, 0x01C1):
                    self.calculation["records"].append({"code": code, "offset": offset,
                        "bytes": len(payload), "data": payload.hex()})
            self.demand(len(self.sheet_inventory) == self.book._all_sheets_count,
                        "LAB_EDD_BIFF_SHEETS", "The physical sheet inventory does not match the original decoder.")
            self.sheet_count = len(self.sheet_inventory)
            self.demand(self.sheet_count <= reader.LIMITS["sheets"], "LAB_EDD_SHEET_COUNT",
                        "The complete original sheet inventory exceeds its allowance.")
            self.sheets = [{**item, "part": self.stream_name + "@" + str(item["offset"])}
                           for item in self.sheet_inventory if item["type"] == 0]
            self.demand([item["name"] for item in self.sheets] == self.book.sheet_names(),
                        "LAB_EDD_BIFF_SHEETS", "Every original worksheet must retain its native identity.")
            self.external_types = [value for value in self.book._supbook_types
                                   if value != self.xlrd.book.SUPBOOK_INTERNAL]
            self.active_parts = [entry["path"] for entry in self.compound_entries
                                 if any(part.lower() in ("_vba_project_cur", "_vba_project", "vba", "objectpool")
                                        for part in entry["path"].split("/"))]
            self.external = len(self.external_types) + len(self.active_parts)
            self.external_data_parts = self.active_parts
            self.legacy = {"format": "BIFF8", "version": 80, "upstream": UPSTREAM, "parser": PARSER,
                "workbookStreamName": self.stream_name, "workbookStreamSha256": self.stream_sha256, "workbookStreamBytes": len(self.stream),
                "codepage": self.book.codepage, "encoding": self.book.encoding,
                "sheetInventory": self.sheet_inventory, "compoundEntries": self.compound_entries,
                "externalBookTypes": self.external_types, "activeParts": self.active_parts,
                "nativeReissue": "XLSX with the original XLS retained separately",
                "acknowledgement": ACKNOWLEDGEMENT}
        except BaseException:
            self.close()
            raise

    def demand(self, condition, code, message, details=None):
        if not condition:
            self.reader.fail(code, message, details)

    def close(self):
        if self.book is not None:
            self.book.release_resources()
            self.book = None

    def records(self, start):
        position, depth, started, count = start, 0, False, 0
        self.demand(type(start) is int and 0 <= start < len(self.stream),
                    "LAB_EDD_BIFF_OFFSET", "The original BIFF substream is outside the workbook.")
        while position < len(self.stream):
            self.demand(position + 4 <= len(self.stream), "LAB_EDD_BIFF_RECORD",
                        "An original BIFF record header is incomplete.", {"offset": position})
            code, size = struct.unpack_from("<HH", self.stream, position)
            end = position + 4 + size
            self.demand(end <= len(self.stream), "LAB_EDD_BIFF_RECORD",
                        "An original BIFF record body is incomplete.", {"offset": position, "code": code})
            payload, offset = self.stream[position+4:end], position
            position = end
            count += 1
            self.demand(count <= 2000000, "LAB_EDD_BIFF_RECORD_COUNT",
                        "The original BIFF stream exceeds the record allowance.")
            if code == 0x0809:
                depth += 1
                started = True
            self.demand(started and depth >= 1, "LAB_EDD_BIFF_SUBSTREAM",
                        "The original BIFF substream must begin with BOF.", {"offset": offset})
            if depth == 1:
                yield code, payload, offset
            if code == 0x000A:
                depth -= 1
                if depth == 0:
                    return
        self.reader.fail("LAB_EDD_BIFF_SUBSTREAM", "The original BIFF substream is missing its final EOF.")

    def cell_sources(self, descriptor):
        sources = {}
        def retain(row, column, code, payload, offset, packed_index=None):
            self.demand(0 <= row <= 65535 and 0 <= column <= 255, "LAB_EDD_BIFF_CELL",
                        "An original BIFF8 cell is outside its worksheet.")
            key = (column+1, row+1)
            self.demand(key not in sources, "LAB_EDD_BIFF_DUPLICATE_CELL",
                        "Multiple native records claim the same physical cell.",
                        {"cell": self.reader.column_label(column+1)+str(row+1),
                         "firstOffset": sources.get(key, {}).get("offset"), "offset": offset})
            raw = struct.pack("<HH", code, len(payload)) + payload
            item = {"record": _BIFF_NAMES[code], "code": code, "offset": offset,
                    "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
            if packed_index is not None:
                item["packedCellIndex"] = packed_index
            if code in _FORMULAS:
                self.demand(len(payload) >= 22, "LAB_EDD_BIFF_FORMULA",
                            "The original formula record is incomplete.", {"offset": offset})
                length = struct.unpack_from("<H", payload, 20)[0]
                self.demand(22+length <= len(payload), "LAB_EDD_BIFF_FORMULA",
                            "The original formula token array is incomplete.", {"offset": offset})
                tokens = payload[22:22+length]
                item["formula"] = {"tokens": tokens.hex(), "tokenBytes": length,
                    "cachedResult": payload[6:14].hex(), "flags": struct.unpack_from("<H", payload, 14)[0],
                    "recordBase64": base64.b64encode(raw).decode("ascii")}
                # The exact token bytes remain authoritative, including ptgExp
                # shared/array followers. This text is never evaluated.
                try:
                    item["formula"]["expression"] = self.xlrd.formula.decompile_formula(
                        self.book, tokens, length, self.xlrd.formula.FMLA_TYPE_CELL,
                        browx=row, bcolx=column, blah=0)
                except Exception as error:
                    item["formula"]["expressionUnavailable"] = type(error).__name__
            sources[key] = item
            self.demand(self._cell_count + len(sources) <= self.reader.LIMITS["cells"], "WORKBOOK_CELL_COUNT",
                        "The original workbook exceeds the maintained reader's cell allowance.")
        for code, payload, offset in self.records(descriptor["offset"]):
            if code in _CELL_RECORDS:
                self.demand(len(payload) >= 6, "LAB_EDD_BIFF_CELL",
                            "An original cell record is incomplete.", {"offset": offset, "code": code})
                row, column = struct.unpack_from("<HH", payload)
                retain(row, column, code, payload, offset)
            elif code in (0x00BD, 0x00BE):
                self.demand(len(payload) >= 6, "LAB_EDD_BIFF_CELL", "A packed original cell record is incomplete.")
                row, first = struct.unpack_from("<HH", payload)
                last = struct.unpack_from("<H", payload, len(payload)-2)[0]
                stride = 6 if code == 0x00BD else 2
                self.demand(last >= first and len(payload) == 6 + (last-first+1)*stride,
                            "LAB_EDD_BIFF_CELL", "A packed original cell range is inconsistent.",
                            {"offset": offset, "firstColumn": first+1, "lastColumn": last+1})
                for index, column in enumerate(range(first, last+1)):
                    retain(row, column, code, payload, offset, index)
        return sources

    def sheet(self, name):
        if name in self._sheets:
            return self._sheets[name]
        descriptor = next((item for item in self.sheets if item["name"] == name), None)
        self.demand(descriptor is not None, "LAB_EDD_SHEET_CHANGED", "Select an original worksheet.")
        sources = self.cell_sources(descriptor)
        self._cell_count += len(sources)
        sheet = self.book.sheet_by_name(name)
        hidden = {row+1 for row, info in sheet.rowinfo_map.items() if info.hidden}
        cells = {}
        for (column, row), native in sources.items():
            original = sheet.cell(row-1, column-1)
            ctype, value, xf = original.ctype, original.value, original.xf_index
            format_record = self.book.format_map.get(self.book.xf_list[xf].format_key) if xf >= 0 else None
            number_format = format_record.format_str if format_record is not None else None
            formula = native.get("formula")
            if ctype in (self.xlrd.XL_CELL_NUMBER, self.xlrd.XL_CELL_DATE):
                self.demand(math.isfinite(value), "LAB_EDD_BIFF_NUMBER", "An original numeric cell is not finite.",
                            {"cell": self.reader.column_label(column)+str(row)})
                raw, kind = repr(value), "number"
                native = {**native, "ieee754": struct.pack("<d", value).hex()}
            elif ctype == self.xlrd.XL_CELL_BOOLEAN:
                raw, kind = ("true" if value else "false"), "boolean"
            elif ctype == self.xlrd.XL_CELL_ERROR:
                raw, kind = self.xlrd.error_text_from_code.get(value, "#ERROR("+str(value)+")"), "error"
            elif ctype in (self.xlrd.XL_CELL_EMPTY, self.xlrd.XL_CELL_BLANK):
                raw, kind = None, "blank"
            else:
                self.demand(isinstance(value, str), "LAB_EDD_BIFF_CELL_TYPE", "The original cell type is unsupported.")
                raw, kind = value, "string"
            self.demand(raw is None or len(raw) <= self.reader.LIMITS["cellChars"],
                        "WORKBOOK_CELL_SIZE", "An original cell exceeds the maintained text allowance.")
            cell = {"cell": self.reader.column_label(column)+str(row), "column": self.reader.column_label(column), "row": row, "present": True,
                "type": kind, "value": raw, "raw": raw,
                "formula": (formula.get("expression") or "BIFF8:"+formula["tokens"]) if formula is not None else None,
                "cachedPresent": ctype not in (self.xlrd.XL_CELL_EMPTY, self.xlrd.XL_CELL_BLANK),
                "styleId": xf, "numberFormat": number_format, "dateStyle": ctype == self.xlrd.XL_CELL_DATE,
                "hiddenRow": row in hidden, "biff": native}
            note = sheet.cell_note_map.get((row-1, column-1))
            if note is not None:
                cell["note"] = {"author": note.author, "text": note.text}
            link = sheet.hyperlink_map.get((row-1, column-1))
            if link is not None:
                cell["hyperlink"] = {}
                for key in ("type", "url_or_path", "textmark", "desc", "target", "quicktip"):
                    value = getattr(link, key, None)
                    cell["hyperlink"][key] = ({"encoding":"base64", "bytes":len(value),
                        "content":base64.b64encode(value).decode("ascii")} if isinstance(value, bytes) else value)
            cells[(column,row)] = cell
        # xlrd's final cells and the complete physical BIFF catalogue must agree.
        observed = {(column+1,row+1) for row in range(sheet.nrows)
                    for column, ctype in enumerate(sheet.row_types(row))
                    if ctype not in (self.xlrd.XL_CELL_EMPTY, self.xlrd.XL_CELL_BLANK)}
        self.demand(observed <= set(sources), "LAB_EDD_BIFF_CELL_INVENTORY",
                    "The decoder returned a populated cell without an original physical record.")
        merged = [{"range": self.reader.column_label(c0+1)+str(r0+1)+":"+
                            self.reader.column_label(c1)+str(r1),
                   "bounds": [c0+1,r0+1,c1,r1]}
                  for r0,r1,c0,c1 in sheet.merged_cells]
        columns = [{"min": first+1, "max": first+1, "width": info.width/256,
                    "hidden": bool(info.hidden), "outlineLevel": info.outline_level, "styleId": info.xf_index}
                   for first, info in sorted(sheet.colinfo_map.items())]
        result = {"cells": cells, "hidden": hidden, "merged": merged,
                  "rowInfo": sheet.rowinfo_map,
                  "metadata": {"columnRanges": columns, "rowNumbers": sorted(row+1 for row in sheet.rowinfo_map)}}
        self.legacy["parserDiagnostics"] = self.diagnostics.getvalue()
        self._sheets[name] = result
        return result

def render_legacy(workbook, request, helpers):
    """Write the source-bound data reissue through the existing literal writer."""
    reader, demand = workbook.reader, workbook.demand
    demand(workbook.sheet_count == 1 and len(workbook.sheets) == 1, "DTS8D_ONE_SHEET",
           "Native DTS8D delivery requires the first and only worksheet.")
    descriptor = workbook.sheets[0]
    demand(request.get("sheetName") == descriptor["name"], "LAB_EDD_SHEET_CHANGED", "The original worksheet changed.")
    sheet = workbook.sheet(descriptor["name"])
    demand(not sheet["merged"], "DTS8D_MERGED_CELLS", "Choose independent original cells before native delivery.")
    demand(workbook.external == 0, "LAB_EDD_EXTERNAL_WORKBOOK",
           "Use a data-only legacy workbook for native delivery.",
           {"externalBookTypes": workbook.external_types, "activeParts": workbook.active_parts})
    width = helpers["column_count"](sheet)
    headers = [helpers["text"](sheet["cells"].get((column,1))) for column in range(1,width+1)]
    demand(request.get("headers") == headers, "LAB_EDD_HEADERS_CHANGED", "Retain all exact original field names.")
    types = request.get("fieldTypes")
    demand(isinstance(types,list) and len(types) == width and
           all(value in ("text","datetime","int16","int32","float32","float64") for value in types),
           "LAB_EDD_FIELD_TYPES", "Retain every declared native field type.")
    rows, by_row = request.get("rows"), {}
    demand(isinstance(rows,list), "LAB_EDD_ROWS_REQUIRED", "Supply every original observation row.")
    for row in rows:
        demand(isinstance(row,dict) and type(row.get("rowNumber")) is int and row["rowNumber"] > 1 and
               row["rowNumber"] not in by_row and isinstance(row.get("fields"),list) and
               len(row["fields"]) == width and all(isinstance(value,str) for value in row["fields"]),
               "LAB_EDD_ROW_IDENTITY", "Each original row and field must be retained once.")
        literal = row.get("literalColumns",[])
        demand(isinstance(literal,list) and all(type(col) is int and 1 <= col <= width for col in literal),
               "LAB_EDD_LITERAL_COLUMNS", "Literal choices must reference original physical columns.")
        by_row[row["rowNumber"]] = row
    demand(sorted(by_row) == helpers["source_rows"](sheet), "LAB_EDD_ROW_INVENTORY_CHANGED",
           "The prepared delivery must retain every original observation row.")
    for column in range(1,width+1):
        cell = sheet["cells"].get((column,1),{})
        demand(cell.get("formula") is None and cell.get("type") != "error", "LAB_EDD_HEADER_LITERAL",
               "All original field names must be literal values.")

    q = lambda name: "{"+_NS+"}"+name
    styles = ET.Element(q("styleSheet"))
    formats = ET.SubElement(styles,q("numFmts"),{"count":str(len(workbook.book.xf_list))})
    for index, xf in enumerate(workbook.book.xf_list):
        original_format = workbook.book.format_map.get(xf.format_key)
        code = original_format.format_str if original_format is not None and original_format.format_str else "General"
        ET.SubElement(formats,q("numFmt"),{"numFmtId":str(164+index),"formatCode":code})
    fonts = ET.SubElement(styles,q("fonts"),{"count":"1"})
    font = ET.SubElement(fonts,q("font"))
    ET.SubElement(font,q("sz"),{"val":"11"}); ET.SubElement(font,q("name"),{"val":"Calibri"})
    fills = ET.SubElement(styles,q("fills"),{"count":"2"})
    for pattern in ("none","gray125"):
        ET.SubElement(ET.SubElement(fills,q("fill")),q("patternFill"),{"patternType":pattern})
    borders = ET.SubElement(styles,q("borders"),{"count":"1"})
    ET.SubElement(borders,q("border"))
    style_xfs = ET.SubElement(styles,q("cellStyleXfs"),{"count":"1"})
    ET.SubElement(style_xfs,q("xf"),{"numFmtId":"0","fontId":"0","fillId":"0","borderId":"0"})
    xfs = ET.SubElement(styles,q("cellXfs"),{"count":str(len(workbook.book.xf_list))})
    for index in range(len(workbook.book.xf_list)):
        ET.SubElement(xfs,q("xf"),{"numFmtId":str(164+index),"fontId":"0","fillId":"0","borderId":"0",
                                 "xfId":"0","applyNumberFormat":"1"})
    worksheet = ET.Element(q("worksheet"))
    if sheet["metadata"]["columnRanges"]:
        cols = ET.SubElement(worksheet,q("cols"))
        for column in sheet["metadata"]["columnRanges"]:
            values = {"min":str(column["min"]),"max":str(column["max"]),
                      "width":str(column["width"]),"customWidth":"1","hidden":"1" if column["hidden"] else "0"}
            ET.SubElement(cols,q("col"),values)
    data = ET.SubElement(worksheet,q("sheetData"))
    columns_by_row = {}
    for column, row in sheet["cells"]:
        columns_by_row.setdefault(row, set()).add(column)
    original_rows = set(columns_by_row) | set(sheet["metadata"]["rowNumbers"])
    for number in sorted(original_rows):
        info = sheet["rowInfo"].get(number-1)
        attrs = {"r":str(number)}
        if number in sheet["hidden"]: attrs["hidden"] = "1"
        if info is not None and info.height is not None:
            attrs["ht"],attrs["customHeight"] = str(info.height/20),"1"
        row_node = ET.SubElement(data,q("row"),attrs)
        reviewed = by_row.get(number)
        forced = set(reviewed.get("literalColumns",[])) if reviewed else set()
        original_columns = set(columns_by_row.get(number, ()))
        if not original_columns: original_columns.add(1)  # Explicit blank cell retains a ROW-only source row on native reopen.
        if reviewed:
            original_columns |= {column for column,value in enumerate(reviewed["fields"],1)
                                 if value != "" or column in forced}
        for column in sorted(original_columns):
            old = sheet["cells"].get((column,number),reader.blank_cell(column,number))
            value = reviewed["fields"][column-1] if reviewed and column <= width else helpers["text"](old)
            changed = value != helpers["text"](old) or column in forced
            demand(old.get("formula") is None or changed, "LAB_EDD_FORMULA_CHOICE",
                   "Choose a literal value for every calculated legacy cell.", {"cell":old["cell"]})
            demand(old.get("type") != "error" or changed, "LAB_EDD_ERROR_CHOICE",
                   "Choose a literal value for every Excel error cell.", {"cell":old["cell"]})
            attributes = {"r":reader.column_label(column)+str(number)}
            if old.get("styleId") is not None and old["styleId"] >= 0:
                attributes["s"] = str(old["styleId"])
            cell = ET.SubElement(row_node,q("c"),attributes)
            if changed:
                helpers["literal_cell"](cell,_NS,value,types[column-1])
            elif old["type"] == "blank":
                continue
            elif old["type"] == "number":
                cell.set("t","n"); ET.SubElement(cell,q("v")).text = old["raw"]
            elif old["type"] == "boolean":
                cell.set("t","b"); ET.SubElement(cell,q("v")).text = "1" if old["value"] == "true" else "0"
            else:
                helpers["literal_cell"](cell,_NS,value,"text")

    book = ET.Element(q("workbook"))
    ET.SubElement(book,q("workbookPr"),{"date1904":"1" if workbook.epoch == "1904" else "0"})
    sheets = ET.SubElement(book,q("sheets"))
    attrs = {"name":descriptor["name"],"sheetId":"1","{"+_REL+"}id":"rId1"}
    if descriptor["visibility"]: attrs["state"] = "veryHidden" if descriptor["visibility"] == 2 else "hidden"
    ET.SubElement(sheets,q("sheet"),attrs)
    rel_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
    relationships = ET.Element("{"+rel_ns+"}Relationships")
    ET.SubElement(relationships,"{"+rel_ns+"}Relationship",{"Id":"rId1","Type":_REL+"/worksheet","Target":"worksheets/sheet1.xml"})
    ET.SubElement(relationships,"{"+rel_ns+"}Relationship",{"Id":"rId2","Type":_REL+"/styles","Target":"styles.xml"})
    root_rels = ET.Element("{"+rel_ns+"}Relationships")
    ET.SubElement(root_rels,"{"+rel_ns+"}Relationship",{"Id":"rId1","Type":_REL+"/officeDocument","Target":"xl/workbook.xml"})
    content_ns = "http://schemas.openxmlformats.org/package/2006/content-types"
    content = ET.Element("{"+content_ns+"}Types")
    for extension, kind in (("rels","application/vnd.openxmlformats-package.relationships+xml"),("xml","application/xml")):
        ET.SubElement(content,"{"+content_ns+"}Default",{"Extension":extension,"ContentType":kind})
    for name,kind in (("/xl/workbook.xml","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"),
                      ("/xl/styles.xml","application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"),
                      ("/xl/worksheets/sheet1.xml","application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")):
        ET.SubElement(content,"{"+content_ns+"}Override",{"PartName":name,"ContentType":kind})
    parts = {"[Content_Types].xml":content,"_rels/.rels":root_rels,"xl/workbook.xml":book,
             "xl/_rels/workbook.xml.rels":relationships,"xl/styles.xml":styles,"xl/worksheets/sheet1.xml":worksheet}
    output = io.BytesIO()
    with zipfile.ZipFile(output,"w",compression=zipfile.ZIP_DEFLATED,allowZip64=False) as archive:
        for name,root in parts.items():
            info = zipfile.ZipInfo(name,(1980,1,1,0,0,0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info,helpers["serialized_xml"](root))
    return output.getvalue()
