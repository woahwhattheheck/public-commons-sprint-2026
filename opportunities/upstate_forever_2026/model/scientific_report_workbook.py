"""Editable, source-bound scientific report tables in an ordinary XLSX file.

The original renderer supplies exact report-data bytes. All values remain literal
display strings; this formatter never infers numbers, evaluates formulas or
recomputes scientific results. Only Python's standard library is required.
"""
from __future__ import annotations

from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re
from xml.sax.saxutils import escape, quoteattr
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from .common import atomic_bytes, describe_file

VERSION = "upstate.scientific-report-workbook/v1"
_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
_MAX_ROWS = 1048576
_MAX_COLUMNS = 16384
_TABLE_START = 6
_LONG_UNITS = 30000
_LONG_LINES = 240


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)


def _text(value):
    # Escape literal OOXML escape sequences before encoding XML-prohibited code
    # points. XML entity CR preserves an original carriage return on XML parsing.
    value = re.sub(r"(?i)_x[0-9a-f]{4}_", lambda m: "_x005F_" + m.group(0)[1:], value)
    value = "".join(
        "_x%04X_" % ord(c)
        if (ord(c) < 32 and c not in "\t\n\r") or 0xD800 <= ord(c) <= 0xDFFF
        or ord(c) in (0xFFFE, 0xFFFF) else c for c in value)
    return escape(value).replace("\r", "&#13;")


def _chunks(value):
    result, current, units, lines = [], [], 0, 0
    for char in value:
        size = 2 if ord(char) > 0xFFFF else 1
        line = 1 if char == "\n" else 0
        if current and (units + size > _LONG_UNITS or lines + line > _LONG_LINES):
            result.append("".join(current))
            current, units, lines = [], 0, 0
        current.append(char)
        units += size
        lines += line
    if current or not result:
        result.append("".join(current))
    return result


def _column(index):
    value = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        value = chr(65 + remainder) + value
    return value


def _zip_member(archive, name, body):
    info = ZipInfo(name, (1980, 1, 1, 0, 0, 0))
    info.compress_type = ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o644 << 16
    archive.writestr(info, body if isinstance(body, bytes) else body.encode("utf-8"))


_STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/><color rgb="FF202020"/></font><font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF202020"/></font><font><b/><sz val="15"/><name val="Calibri"/><color rgb="FF202020"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8E8E8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="hair"><color rgb="FFAAAAAA"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>"""


class _Book:
    def __init__(self, cell):
        self.cell = cell
        self.sheets = []
        self.links = []
        self.long_text = []
        self.tables = []

    def add_sheet(self, name, rows, *, header=1, freeze=1, widths=None,
                  filter_rows=False, locations=None, styles=None):
        if not name or len(name) > 31 or re.search(r"[\[\]:*?/\\]", name):
            raise ValueError("Invalid scientific workbook sheet name")
        if any(sheet["name"].lower() == name.lower() for sheet in self.sheets):
            raise ValueError("Scientific workbook sheet names must remain unique")
        if len(rows) > _MAX_ROWS or any(len(row) > _MAX_COLUMNS for row in rows):
            raise ValueError("Scientific workbook sheet exceeds the XLSX grid")
        sheet = {"name": name, "rows": [], "header": header, "freeze": freeze,
                 "widths": widths, "filter": filter_rows,
                 "locations": locations or {}, "styles": styles or {}}
        self.sheets.append(sheet)
        for row_number, row in enumerate(rows, 1):
            output = []
            for col_number, value in enumerate(row, 1):
                normalized = self.cell(value)
                href = normalized.get("href") if isinstance(normalized, dict) else None
                literal = normalized["label"] if isinstance(normalized, dict) else normalized
                address = _column(col_number) + str(row_number)
                if not isinstance(literal, str):
                    raise ValueError("Scientific report display cells must be strings")
                if href:
                    self.links.append((name, address, literal, href))
                parts = _chunks(literal)
                if len(parts) > 1:
                    ident = "LT%06d" % (len(self.long_text) + 1)
                    self.long_text.append({
                        "id": ident, "sheet": name, "cell": address,
                        "parts": parts, "sha256_utf8": sha256(literal.encode("utf-8",
                                                                     errors="surrogatepass")).hexdigest(),
                    })
                    literal = (ident + ": complete original text is retained in Long text "
                               "(" + str(len(parts)) + " consecutive parts). "
                               "The exact original also remains in source/report-data.json.")
                output.append({"text": literal, "href": href})
            sheet["rows"].append(output)
        return sheet

    def tabular(self, prefix, headings, rows, *, locations=None):
        # Split only at the spreadsheet's real row boundary. No data subset is
        # selected or discarded to make the workbook fit.
        count = max(1, (len(rows) + _MAX_ROWS - 2) // (_MAX_ROWS - 1))
        for page in range(count):
            first = page * (_MAX_ROWS - 1)
            name = prefix if count == 1 else prefix + " " + str(page + 1)
            local = {}
            for index, target in (locations or {}).items():
                if first <= index < first + _MAX_ROWS - 1:
                    local["A" + str(index - first + 2)] = target
            self.add_sheet(name, [headings] + rows[first:first + _MAX_ROWS - 1],
                           filter_rows=True, locations=local)

    def xml(self, sheet):
        rows = sheet["rows"]
        columns = max([len(row) for row in rows] + [1])
        last = _column(columns) + str(max(1, len(rows)))
        yield ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
               '<worksheet xmlns="' + _NS + '" xmlns:r="' + _REL + '">'
               '<dimension ref="A1:' + last + '"/><sheetViews><sheetView workbookViewId="0">')
        frozen = sheet["freeze"]
        if frozen:
            yield ('<pane ySplit="' + str(frozen) + '" topLeftCell="A' + str(frozen + 1) +
                   '" activePane="bottomLeft" state="frozen"/>'
                   '<selection pane="bottomLeft" activeCell="A' + str(frozen + 1) +
                   '" sqref="A' + str(frozen + 1) + '"/>')
        yield '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>'
        for col in range(columns):
            width = (sheet["widths"][col] if sheet["widths"] and col < len(sheet["widths"])
                     else 24 if columns > 5 else 38)
            yield '<col min="' + str(col + 1) + '" max="' + str(col + 1) + '" width="' + str(width) + '" customWidth="1"/>'
        yield '</cols><sheetData>'
        external = []
        for row_number, row in enumerate(rows, 1):
            longest = max([len(cell["text"]) for cell in row] + [0])
            line_count = max([cell["text"].count("\n") + 1 for cell in row] + [1])
            height = min(90, max(20, line_count * 15, (min(longest, 180) // 45 + 1) * 15))
            yield '<row r="' + str(row_number) + '" ht="' + str(height) + '" customHeight="1">'
            for col_number, cell in enumerate(row, 1):
                address = _column(col_number) + str(row_number)
                style = sheet["styles"].get(row_number, 1 if row_number == sheet["header"] else 3)
                yield ('<c r="' + address + '" s="' + str(style) +
                       '" t="inlineStr"><is><t xml:space="preserve">' +
                       _text(cell["text"]) + '</t></is></c>')
                if cell["href"]:
                    external.append((address, cell["href"]))
            yield '</row>'
        yield '</sheetData>'
        if sheet["filter"] and rows:
            yield '<autoFilter ref="A' + str(sheet["header"]) + ':' + last + '"/>'
        if external or sheet["locations"]:
            yield '<hyperlinks>'
            for index, (address, href) in enumerate(external, 1):
                yield '<hyperlink ref="' + address + '" r:id="h' + str(index) + '"/>'
            for address, location in sheet["locations"].items():
                yield '<hyperlink ref="' + address + '" location=' + quoteattr(location) + '/>'
            yield '</hyperlinks>'
        yield ('<printOptions horizontalCentered="0"/><pageMargins left="0.3" right="0.3" '
               'top="0.5" bottom="0.5" header="0.2" footer="0.2"/>'
               '<pageSetup paperSize="9" orientation="' + ("landscape" if columns > 4 else "portrait") +
               '" fitToWidth="1" fitToHeight="0"/></worksheet>')

    def write_sheet(self, archive, sheet, index):
        name = "xl/worksheets/sheet" + str(index) + ".xml"
        info = ZipInfo(name, (1980, 1, 1, 0, 0, 0))
        info.compress_type, info.create_system, info.external_attr = ZIP_DEFLATED, 3, 0o644 << 16
        with archive.open(info, "w") as target:
            for part in self.xml(sheet):
                target.write(part.encode("utf-8"))
        external = [cell["href"] for row in sheet["rows"] for cell in row if cell["href"]]
        if external:
            # OPC TargetMode External resolves a relative URI against the XLSX
            # package location, not against xl/worksheets. Keep the original
            # report-relative target. Microsoft PackageRelationship.TargetMode:
            # https://learn.microsoft.com/en-us/dotnet/api/system.io.packaging.packagerelationship.targetmode
            relations = ['<Relationships xmlns="' + _PACKAGE_REL + '">']
            for number, href in enumerate(external, 1):
                relations.append('<Relationship Id="h' + str(number) + '" Type="' + _REL +
                                 '/hyperlink" Target=' + quoteattr(href) + ' TargetMode="External"/>')
            relations.append('</Relationships>')
            _zip_member(archive, "xl/worksheets/_rels/sheet" + str(index) + ".xml.rels",
                        "".join(relations))


def workbook_bytes(report_data_bytes):
    """Return one deterministic XLSX containing every original report block."""
    if not isinstance(report_data_bytes, bytes) or not report_data_bytes:
        raise ValueError("Scientific workbook requires the exact nonempty report-data bytes")
    def duplicate_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate field in scientific report-data: " + key)
            result[key] = value
        return result
    def invalid_number(value):
        raise ValueError("Nonfinite value in original scientific report-data: " + value)
    data = json.loads(report_data_bytes.decode("utf-8"), object_pairs_hook=duplicate_pairs,
                      parse_constant=invalid_number)
    if (not isinstance(data, dict) or not isinstance(data.get("title"), str)
            or not isinstance(data.get("sections"), list)
            or not isinstance(data.get("source_records"), list)
            or not isinstance(data.get("contact"), dict)
            or not isinstance(data.get("binding"), dict)):
        raise ValueError("Scientific workbook requires the complete current report-data shape")
    # Deferred import avoids a cycle while the original renderer writes its
    # exact structured companion then calls this formatter.
    from .scientific_report import _cell, _source_block, _figure
    digest = sha256(report_data_bytes).hexdigest()
    book = _Book(_cell)
    title = data["title"]
    intro = [
        ["Scientific report workbook", title],
        ["Report-data SHA256", digest],
        ["Original source bytes", str(len(report_data_bytes))],
        ["Workbook format", VERSION],
        ["Original report format", str(data.get("schema", ""))],
        ["How to use", "Use Contents to open each complete table. Filter, annotate and save a separate "
         "working copy. Table entries remain literal report display text, including scientific "
         "notation, signs, units, identifiers and unknown values."],
        ["Precision", str(data.get("display_precision", "Original report display values are retained."))],
        ["Scientific source", "The complete original report-data.json is embedded unchanged at "
         "source/report-data.json. Use the original project and native outputs for full-precision "
         "calculations. Editing this spreadsheet does not change the saved Study or its results."],
        ["Long values", "When Excel's cell limits require continuation, the cell identifies all parts "
         "on Long text. Concatenate parts in order without separators to recover the literal value. "
         "Expand row heights or use the formula bar to inspect wrapped entries."],
        ["Links and figures", "Links retains every table reference. Narrative retains all other report "
         "blocks and original figure metadata. Relative links use files beside this workbook in "
         "the complete report archive; retain that folder structure."],
        ["Archive receiving", "Receive and reopen the complete original report ZIP/Study through the "
         "maintained application. A personally edited spreadsheet is a separate working copy."],
    ]
    book.add_sheet("Read me", intro, header=1, freeze=1, widths=[28, 100], styles={1: 2})
    contents, contents_locations, narrative = [], {}, []
    sections = []
    for section_index, section in enumerate(data["sections"], 1):
        if (not isinstance(section, dict) or not isinstance(section.get("heading"), str)
                or not isinstance(section.get("blocks"), list)):
            raise ValueError("Scientific report section must retain its heading and all blocks")
        sections.append((section_index, section["heading"], section["blocks"]))
    sections.append((len(sections) + 1, "Source editions", [_source_block(data["source_records"])]))
    table_number = 0
    for section_index, heading, blocks in sections:
        narrative.append([str(section_index), heading, "", "section", heading, ""])
        for block_index, block in enumerate(blocks, 1):
            if not isinstance(block, dict) or block.get("kind") != "table":
                kind = block.get("kind", "structured") if isinstance(block, dict) else "paragraph"
                if kind == "figure":
                    _figure(block)
                literal = _json(block) if isinstance(block, (dict, list)) else str(block)
                narrative.append([str(section_index), heading, str(block_index), kind, literal,
                                  "Original report block; full source/report-data.json is retained."])
                continue
            columns, rows = block.get("columns"), block.get("rows")
            if (not isinstance(columns, list)
                    or not isinstance(rows, list)
                    or any(not isinstance(row, list) or len(row) != len(columns) for row in rows)):
                raise ValueError("Scientific workbook table must retain rectangular original rows")
            table_number += 1
            if not columns:
                name = "T%04d" % table_number
                caption = str(block.get("caption") or heading)
                book.add_sheet(name, [
                    [caption],
                    ["Section %d / block %d: %s" % (section_index, block_index, heading)],
                    ["The original table has zero columns and %d zero-width rows. "
                     "It contains no data cells. Its exact empty rows remain in report-data.json." % len(rows)],
                    ["Report-data SHA256 " + digest],
                ], header=1, freeze=1, widths=[100], styles={1: 2})
                contents_locations[len(contents)] = "'" + name + "'!A1"
                contents.append([name, str(section_index), heading, str(block_index), caption,
                                 str(len(rows)), "0", "0–" + str(len(rows)), "0–0"])
                book.tables.append({"sheet": name, "section": section_index, "block": block_index,
                                    "source_row_start": 0, "source_row_end": len(rows),
                                    "source_column_start": 0, "source_column_end": 0})
                continue
            row_capacity = _MAX_ROWS - _TABLE_START + 1
            row_parts = max(1, (len(rows) + row_capacity - 1) // row_capacity)
            col_parts = (len(columns) + _MAX_COLUMNS - 1) // _MAX_COLUMNS
            for row_part in range(row_parts):
                first_row = row_part * row_capacity
                chosen_rows = rows[first_row:first_row + row_capacity]
                for col_part in range(col_parts):
                    first_col = col_part * _MAX_COLUMNS
                    last_col = min(len(columns), first_col + _MAX_COLUMNS)
                    name = "T%04d" % table_number
                    if row_parts > 1 or col_parts > 1:
                        name += "-R%dC%d" % (row_part + 1, col_part + 1)
                    caption = str(block.get("caption") or heading)
                    sheet_rows = [
                        [caption],
                        ["Section %d / block %d: %s" % (section_index, block_index, heading)],
                        ["Literal report display values; original units, signs and unknown states remain unchanged."],
                        ["Original rows %d–%d of %d; columns %d–%d of %d; report-data SHA256 %s" %
                         (first_row + 1 if rows else 0, first_row + len(chosen_rows), len(rows),
                          first_col + 1, last_col, len(columns), digest)],
                        columns[first_col:last_col],
                    ] + [row[first_col:last_col] for row in chosen_rows]
                    book.add_sheet(name, sheet_rows, header=5, freeze=5, filter_rows=True,
                                   styles={1: 2, 2: 0, 3: 0, 4: 0})
                    contents_locations[len(contents)] = "'" + name + "'!A1"
                    contents.append([name, str(section_index), heading, str(block_index), caption,
                                     str(len(rows)), str(len(columns)),
                                     "%d–%d" % (first_row + 1 if rows else 0, first_row + len(chosen_rows)),
                                     "%d–%d" % (first_col + 1, last_col)])
                    book.tables.append({"sheet": name, "section": section_index, "block": block_index,
                                        "source_row_start": first_row, "source_row_end": first_row + len(chosen_rows),
                                        "source_column_start": first_col, "source_column_end": last_col})
    book.tabular("Contents", ["Sheet", "Section", "Section heading", "Block", "Caption",
                            "Complete table rows", "Complete table columns", "Rows on sheet",
                            "Columns on sheet"], contents, locations=contents_locations)
    book.tabular("Narrative", ["Section", "Section heading", "Block", "Kind", "Original text / structure",
                              "Context"], narrative)
    sources = []
    for number, source in enumerate(data["source_records"], 1):
        if not isinstance(source, dict):
            raise ValueError("Scientific source records must remain complete objects")
        for key, value in source.items():
            sources.append([str(number), str(key), value if isinstance(value, str) else _json(value)])
    book.tabular("Sources", ["Original source ordinal", "Original field", "Complete original value"], sources)
    metadata = []
    for name in ("title", "schema", "display_precision", "presentation", "contact", "binding"):
        value = data.get(name)
        metadata.append([name, value if isinstance(value, str) else _json(value)])
    book.tabular("Report binding", ["Original report field", "Complete original value"], metadata)
    book.tabular("Links", ["Sheet", "Cell", "Original label", "Original target"],
                 [list(row) for row in list(book.links)])
    # All ordinary cells have been captured before laying out continuations.
    # Each chunk already obeys the actual cell limits, so this cannot recurse.
    long_rows = []
    for value in book.long_text:
        for number, part in enumerate(value["parts"], 1):
            long_rows.append([value["id"], value["sheet"], value["cell"], str(number),
                              str(len(value["parts"])), part])
    book.tabular("Long text", ["Text ID", "Original sheet", "Original cell", "Part", "Total parts",
                              "Complete consecutive text"], long_rows)
    # Put the practical navigation first; every scientific table remains in its
    # original order after the explanatory and provenance sheets.
    order = {"Read me": 0, "Contents": 1, "Narrative": 2, "Sources": 3,
             "Report binding": 4, "Links": 5, "Long text": 6}
    book.sheets.sort(key=lambda s: next((rank for prefix, rank in order.items()
                                       if s["name"] == prefix or s["name"].startswith(prefix + " ")), 7))
    manifest = {"schema": VERSION, "report_data_sha256": digest,
                "report_data_bytes": len(report_data_bytes),
                "source_member": "source/report-data.json",
                "cells": "Literal original report display strings; no formulas or numeric inference",
                "tables": book.tables,
                "long_text": [{k: v for k, v in item.items() if k != "parts"} |
                              {"parts": len(item["parts"])} for item in book.long_text]}
    buffer = BytesIO()
    with ZipFile(buffer, "w", compression=ZIP_DEFLATED, compresslevel=9, allowZip64=True) as archive:
        types = ['<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
                 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
                 '<Default Extension="xml" ContentType="application/xml"/>',
                 '<Default Extension="json" ContentType="application/json"/>',
                 '<Default Extension="txt" ContentType="text/plain"/>',
                 '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
                 '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>']
        for index in range(1, len(book.sheets) + 1):
            types.append('<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % index)
        types.append("</Types>")
        _zip_member(archive, "[Content_Types].xml", "".join(types))
        _zip_member(archive, "_rels/.rels", '<Relationships xmlns="' + _PACKAGE_REL +
                    '"><Relationship Id="office" Type="' + _REL +
                    '/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        workbook = ['<workbook xmlns="' + _NS + '" xmlns:r="' + _REL +
                    '"><bookViews><workbookView activeTab="0"/></bookViews><sheets>']
        relations = ['<Relationships xmlns="' + _PACKAGE_REL + '">']
        for index, sheet in enumerate(book.sheets, 1):
            workbook.append('<sheet name=' + quoteattr(sheet["name"]) + ' sheetId="' + str(index) +
                            '" r:id="s' + str(index) + '"/>')
            relations.append('<Relationship Id="s' + str(index) + '" Type="' + _REL +
                             '/worksheet" Target="worksheets/sheet' + str(index) + '.xml"/>')
            book.write_sheet(archive, sheet, index)
        workbook.append('</sheets><definedNames>')
        for index, sheet in enumerate(book.sheets):
            if sheet["freeze"]:
                workbook.append('<definedName name="_xlnm.Print_Titles" localSheetId="' + str(index) +
                                '">' + escape("'" + sheet["name"].replace("'", "''") + "'!$1:$" +
                                              str(sheet["freeze"])) + '</definedName>')
        workbook.append('</definedNames><calcPr calcId="0" fullCalcOnLoad="0"/></workbook>')
        relations.append('<Relationship Id="styles" Type="' + _REL + '/styles" Target="styles.xml"/>')
        relations.append('<Relationship Id="original-report" Type="https://tokenjunkielabs.com/relationships/scientific-report-source" Target="../source/report-data.json"/>')
        relations.append('<Relationship Id="table-index" Type="https://tokenjunkielabs.com/relationships/scientific-report-workbook-index" Target="../source/workbook-index.json"/></Relationships>')
        _zip_member(archive, "xl/workbook.xml", "".join(workbook))
        _zip_member(archive, "xl/_rels/workbook.xml.rels", "".join(relations))
        _zip_member(archive, "xl/styles.xml", _STYLES)
        _zip_member(archive, "source/report-data.json", report_data_bytes)
        _zip_member(archive, "source/workbook-index.json", _json(manifest) + "\n")
        _zip_member(archive, "source/README.txt",
                    "Scientific report workbook\n\nThe unchanged original report-data.json accompanies the "
                    "editable display tables. Its exact SHA256 is " + digest + ".\n"
                    "workbook-index.json maps every table sheet to the original section/block and zero-based "
                    "half-open row/column ranges. Long text is split without separators; concatenate its "
                    "consecutive parts to recover the original literal cell.\n"
                    "Spreadsheet edits do not replace the original Study, report edition or native results. "
                    "Keep the complete delivered report folder for original relative source/figure links.\n")
    result = buffer.getvalue()
    with ZipFile(BytesIO(result), "r") as check:
        if check.read("source/report-data.json") != report_data_bytes or check.testzip() is not None:
            raise ValueError("Complete scientific workbook archive failed its source readback")
    return result


def write_workbook(directory, report_data_bytes):
    """Write report-tables.xlsx through the original atomic report file helper."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    data_path = directory / "report-data.json"
    if not data_path.is_file() or data_path.read_bytes() != report_data_bytes:
        raise ValueError("Scientific workbook must use the same saved report-data.json bytes")
    target = directory / "report-tables.xlsx"
    atomic_bytes(target, workbook_bytes(report_data_bytes))
    return describe_file(directory, target)
