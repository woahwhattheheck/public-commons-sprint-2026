#!/usr/bin/env python3
"""MIT. Lab EDD worksheet intake and literal reissue using the maintained XLSX reader.
Standalone JSON control arrives on stdin; unchanged workbook bytes arrive on fd 3.
The original native process broker can use private regular control/source/result files.
The original workbook reader owns ZIP/XML parsing, limits, cell identity and epochs.
"""
import importlib.util
import io
import json
import os
import re
import stat
from pathlib import Path
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET

READER_PATH = Path(__file__).resolve().parents[1] / "dataset-refresh" / "workbook" / "reader.py"
spec = importlib.util.spec_from_file_location("starforge_original_workbook_reader", READER_PATH)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
SCHEMA = "stellar-forge.lab-edd-workbook.v1"
MAX_CONTROL = 128 * 1024 * 1024

def demand(condition, code, message, details=None):
    if not condition:
        reader.fail(code, message, details)

def text(cell):
    value = cell.get("value") if cell is not None else None
    return "" if value is None else str(value)

def source_rows(sheet):
    return sorted({row for (_, row), cell in sheet["cells"].items()
                   if row > 1 and (text(cell) != "" or cell.get("formula") is not None or cell.get("type") == "error")})

def header_keys(headers):
    canonical = [value.strip().lower().removeprefix("#") for value in headers]
    counts = {}
    for value in canonical:
        counts[value] = counts.get(value, 0) + 1
    reserved, keys = set(canonical), []
    for index, value in enumerate(canonical, 1):
        if value and counts[value] == 1:
            keys.append(value)
        else:
            candidate = "column-" + str(index)
            while candidate in reserved: candidate += "-source"
            reserved.add(candidate)
            keys.append(candidate)
    return keys

def column_count(sheet):
    # Column positions stay tied to the original first row and all original cells.
    return max([column for (column, _) in sheet["cells"]] or [0])

def cell_record(workbook, sheet, column, row, field):
    original = sheet["cells"].get((column, row))
    if original is None:
        return None
    value = dict(original)
    value["field"] = field
    value["dateSystem"] = workbook.epoch
    if field.endswith("_D") and value["value"] not in (None, ""):
        try:
            if value["type"] in ("number", "date"):
                iso = reader.date_value(value["value"], value["type"], workbook.epoch, "iso-datetime-ms")
                value["calendar"] = {"iso": iso, "date": iso.split("T", 1)[0]}
        except reader.WorkbookError as error:
            value["calendar"] = {"error": str(error), "code": error.code}
    return value

def decode(workbook, request):
    tables = []
    for index, descriptor in enumerate(workbook.sheets):
        sheet = workbook.sheet(descriptor["name"])
        width = column_count(sheet)
        demand(width > 0, "LAB_EDD_HEADERS_REQUIRED", "The original worksheet needs its first-row field names.")
        row_numbers = source_rows(sheet)
        demand(len(row_numbers) <= 100000, "LAB_EDD_ROW_COUNT", "The complete source exceeds the original file job's 100,000-row allowance.")
        demand(len(row_numbers) * width <= 15000000, "LAB_EDD_CELL_COUNT",
               "The complete worksheet exceeds the file job's 100,000 by 150-cell review capacity.")
        header_cells = [cell_record(workbook, sheet, col, 1, "") for col in range(1, width + 1)]
        headers = [text(cell) for cell in header_cells]
        records = []
        for row_number in row_numbers:
            cells = [cell_record(workbook, sheet, col, row_number, headers[col-1]) for col in range(1, width + 1)]
            records.append({"rowNumber": row_number, "fields": [text(cell) for cell in cells], "cells": cells})
        tables.append({
            "id": "worksheet-" + str(index + 1),
            "filename": request["filename"],
            "headers": headers,
            "keys": header_keys(headers),
            "records": records,
            "origin": {
                "format": "xlsx", "containerSha256": workbook.sha, "containerBytes": workbook.size,
                "containerFilename": request["filename"], "sheetName": descriptor["name"],
                "sheetIndex": index, "sheetCount": len(workbook.sheets), "sheetPart": descriptor["part"],
                "epoch": workbook.epoch, "headerCells": header_cells,
                "mergedRanges": [item["range"] for item in sheet["merged"]],
                "hiddenRows": sorted(sheet["hidden"]), "columnRanges": sheet["metadata"]["columnRanges"],
                "blankRows": sorted({row for (_, row) in sheet["cells"] if row > 1} - set(row_numbers)),
                "calculationProperties": workbook.calculation, "externalRelationships": workbook.external,
                "externalDataParts": [name for name in sorted(workbook.names) if "/externalLinks/" in name or name.endswith("/connections.xml")],
                "parser": reader.PARSER
            }
        })
    return {"schema": SCHEMA, "tables": tables}

def preserved_xml(workbook, part):
    # The maintained reader first applies its XML/ZIP rules. Keep every original
    # namespace declaration at its element scope, including prefixes used only in
    # QName-valued attributes such as mc:Ignorable and mc:Choice/@Requires.
    workbook.xml(part)
    pending, original_prefixes, namespaces = [], {"xml", "xmlns"}, set()
    iterator = ET.iterparse(io.BytesIO(workbook.zip.read(part)), events=("start-ns", "start"))
    for event, item in iterator:
        if event == "start-ns":
            prefix, uri = item
            pending.append((prefix or "", uri))
            original_prefixes.add(prefix or "")
        else:
            for prefix, uri in pending:
                item.set("xmlns" + (":" + prefix if prefix else ""), uri)
            pending.clear()
            for name in [item.tag, *item.attrib]:
                if name.startswith("{"):
                    namespaces.add(name[1:name.index("}")])
    index = 0
    for uri in sorted(namespaces):
        if uri == "http://www.w3.org/XML/1998/namespace": continue
        while "labedd" + str(index) in original_prefixes: index += 1
        ET.register_namespace("labedd" + str(index), uri)
        index += 1
    return iterator.root

def serialized_xml(root):
    # XML character references preserve CR values across a native XML reparse.
    return ET.tostring(root, encoding="utf-8", xml_declaration=True).replace(b"\r", b"&#13;")

def xml_text(value):
    demand(isinstance(value, str), "LAB_EDD_LITERAL_REQUIRED", "Prepared cells must contain exact text values.")
    demand(len(value) <= 32767, "LAB_EDD_EXCEL_CELL_SIZE", "A prepared cell exceeds Excel's 32,767-character text limit.")
    demand(all(ord(c) >= 32 or c in "\t\n\r" for c in value), "LAB_EDD_XML_CONTROL", "A prepared value contains an unsupported XML control character.")
    demand(not any(0xD800 <= ord(c) <= 0xDFFF or ord(c) in (0xFFFE, 0xFFFF) for c in value),
           "LAB_EDD_XML_UNICODE", "A prepared value contains an unsupported Unicode code point.")
    # Literal escape-looking strings must survive the maintained Excel text decoder.
    return value.replace("_x", "_x005F_x").replace("\r", "_x000D_")

def literal_cell(node, namespace, value, declared_type):
    # Numerical DTS fields stay numerical; Value and identifiers retain literal text,
    # including their leading/trailing zeroes. Calendar edits use a stored ISO date
    # when explicitly supplied; unchanged source serials are never converted.
    escaped = xml_text(value)
    q = lambda name: "{" + namespace + "}" + name
    if value and declared_type in ("int16", "int32", "float32", "float64"):
        demand(reader.NUMBER_RE.fullmatch(value) is not None and reader.Decimal(value).is_finite(),
               "DTS8D_LITERAL_NUMBER", "The selected numerical field needs its exact finite numeric value.")
        node.set("t", "n")
        ET.SubElement(node, q("v")).text = value
    elif value and declared_type == "datetime" and re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:T.*)?", value):
        reader.date_value(value, "date", "1900", "iso-datetime-ms")
        node.set("t", "d")
        ET.SubElement(node, q("v")).text = value
    else:
        node.set("t", "inlineStr")
        literal = ET.SubElement(ET.SubElement(node, q("is")), q("t"))
        literal.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        literal.text = escaped

def render(workbook, request):
    demand(len(workbook.sheets) == 1, "DTS8D_ONE_SHEET", "Native DTS8D delivery requires one worksheet.")
    descriptor = workbook.sheets[0]
    demand(request.get("sheetName") == descriptor["name"], "LAB_EDD_SHEET_CHANGED", "The selected worksheet changed.")
    sheet = workbook.sheet(descriptor["name"])
    demand(not sheet["merged"], "DTS8D_MERGED_CELLS", "Choose independent original cells before preparing the DTS8D delivery.")
    demand(workbook.external == 0 and not any("/externalLinks/" in name or name.endswith("/connections.xml") for name in workbook.names),
           "LAB_EDD_EXTERNAL_WORKBOOK", "Use a data-only source workbook for native lab delivery.")
    width = column_count(sheet)
    original_headers = [text(sheet["cells"].get((col,1), reader.blank_cell(col,1))) for col in range(1,width+1)]
    demand(request.get("headers") == original_headers, "LAB_EDD_HEADERS_CHANGED", "Prepared headers must equal the original worksheet headers.")
    field_types = request.get("fieldTypes")
    demand(isinstance(field_types, list) and len(field_types) == width and
           all(kind in ("text", "datetime", "int16", "int32", "float32", "float64") for kind in field_types),
           "LAB_EDD_FIELD_TYPES", "Retain the declared type for every original column.")
    rows = request.get("rows")
    demand(isinstance(rows,list), "LAB_EDD_ROWS_REQUIRED", "Supply every original observation row.")
    by_row = {}
    for row in rows:
        demand(isinstance(row,dict) and type(row.get("rowNumber")) is int and row["rowNumber"] > 1,
               "LAB_EDD_ROW_IDENTITY", "Every prepared row must retain its original worksheet row.")
        demand(row["rowNumber"] not in by_row and isinstance(row.get("fields"),list) and len(row["fields"]) == width,
               "LAB_EDD_ROW_IDENTITY", "Each original row and field must be present once.")
        demand(all(isinstance(value,str) for value in row["fields"]), "LAB_EDD_LITERAL_REQUIRED", "Prepared cells must contain exact strings.")
        literal = row.get("literalColumns", [])
        demand(isinstance(literal,list) and all(type(col) is int and 1 <= col <= width for col in literal),
               "LAB_EDD_LITERAL_COLUMNS", "Literal choices must reference original column positions.")
        by_row[row["rowNumber"]] = row
    demand(sorted(by_row) == source_rows(sheet), "LAB_EDD_ROW_INVENTORY_CHANGED", "The native reissue must retain every original worksheet row.")

    xml = preserved_xml(workbook, descriptor["part"])
    namespace = xml.tag.split("}")[0].lstrip("{")
    q = lambda name: "{" + namespace + "}" + name
    data = reader.child(xml, "sheetData")
    demand(data is not None, "LAB_EDD_DATA_REQUIRED", "The original worksheet data is missing.")
    nodes, next_row = {}, 1
    for row_node in data:
        if reader.local(row_node.tag) != "row": continue
        number = int(row_node.get("r", next_row))
        nodes[number] = row_node
        next_row = number + 1
    changes = []
    for number, row in by_row.items():
        row_node = nodes.get(number)
        demand(row_node is not None, "LAB_EDD_ROW_IDENTITY", "The original worksheet row cannot be located.")
        cell_nodes, node_columns = {}, {}
        next_column = 1
        for cell in row_node:
            if reader.local(cell.tag) != "c": continue
            cell_ref = cell.get("r") or reader.column_label(next_column) + str(number)
            column, cell_row = reader.coordinate(cell_ref)
            cell_nodes[column] = cell
            # Explicit coordinates preserve original identities if a missing cell is inserted.
            if not cell.get("r"): cell.set("r", cell_ref)
            node_columns[cell] = column
            next_column = column + 1
        literals = set(row.get("literalColumns", []))
        for column, value in enumerate(row["fields"], 1):
            old = sheet["cells"].get((column, number), reader.blank_cell(column, number))
            forced = column in literals
            changed = value != text(old) or forced
            demand(old.get("formula") is None or changed, "LAB_EDD_FORMULA_CHOICE",
                   "Choose literal values for all calculated cells before preparing lab delivery.",
                   {"cell": reader.column_label(column) + str(number)})
            demand(old.get("type") != "error" or changed, "LAB_EDD_ERROR_CHOICE",
                   "Choose a literal replacement for each Excel error cell.",
                   {"cell": reader.column_label(column) + str(number)})
            if not changed: continue
            node = cell_nodes.get(column)
            if node is None:
                node = ET.Element(q("c"), {"r": reader.column_label(column) + str(number)})
                insert = next((i for i, child in enumerate(row_node)
                               if reader.local(child.tag) == "c" and node_columns[child] > column), len(row_node))
                row_node.insert(insert, node)
                cell_nodes[column] = node
                node_columns[node] = column
            style = node.get("s")
            node.attrib.clear()
            node.set("r", reader.column_label(column) + str(number))
            if style is not None: node.set("s", style)
            for child in list(node): node.remove(child)
            literal_cell(node, namespace, value, field_types[column-1])
            changes.append({"cell": node.get("r"), "before": text(old), "after": value, "literal": True})
    for column in range(1,width+1):
        header = sheet["cells"].get((column,1), {})
        demand(header.get("formula") is None and header.get("type") != "error", "LAB_EDD_HEADER_LITERAL",
               "The first-row field names must be literal values.")
    if not changes:
        workbook.source.seek(0)
        return workbook.source.read()
    parts = {descriptor["part"]: serialized_xml(xml)}
    # All source formulas have explicit literal replacements at this point. Remove
    # their obsolete calculation chain and its two package declarations.
    chain_ids = {ident for ident, rel in workbook.rels.items() if rel["type"].endswith("/calcChain") and not rel["external"]}
    removed = {workbook.rels[ident]["target"] for ident in chain_ids}
    if chain_ids:
        rel_name = reader.rels_name(workbook.part)
        rel_xml = preserved_xml(workbook, rel_name)
        for rel in list(rel_xml):
            if rel.get("Id") in chain_ids: rel_xml.remove(rel)
        parts[rel_name] = serialized_xml(rel_xml)
        type_xml = preserved_xml(workbook, "[Content_Types].xml")
        for item in list(type_xml):
            if item.get("PartName", "").lstrip("/") in removed: type_xml.remove(item)
        parts["[Content_Types].xml"] = serialized_xml(type_xml)
    output = io.BytesIO()
    with zipfile.ZipFile(output,"w",allowZip64=False) as target:
        target.comment = workbook.zip.comment
        for info in workbook.zip.infolist():
            if info.filename not in removed:
                target.writestr(info, parts[info.filename] if info.filename in parts else workbook.zip.read(info.filename))
    return output.getvalue()

def read_request(incoming):
    raw = incoming.read(MAX_CONTROL + 1)
    demand(len(raw) <= MAX_CONTROL, "LAB_EDD_CONTROL_SIZE", "The complete control document exceeds the original job input capacity.")
    request = json.loads(raw)
    demand(isinstance(request,dict) and request.get("schema") == SCHEMA and request.get("operation") in ("decode","render"),
           "LAB_EDD_WORKBOOK_REQUEST", "Select the original workbook decode or render operation.")
    expected = request.get("source")
    demand(isinstance(expected,dict) and type(expected.get("bytes")) is int and 0 < expected["bytes"] <= reader.LIMITS["sourceBytes"],
           "LAB_EDD_WORKBOOK_SOURCE", "Supply the exact original workbook size and SHA-256.")
    return request

def regular_input(filename):
    descriptor = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        demand(stat.S_ISREG(os.fstat(descriptor).st_mode), "LAB_EDD_WORKBOOK_SOURCE",
               "Use the original regular source or control file in the job's private directory.")
        incoming = os.fdopen(descriptor, "rb")
    except BaseException:
        os.close(descriptor)
        raise
    return incoming

def native_result(source, request):
    workbook = reader.Workbook(source, request["source"])
    try:
        if request["operation"] == "decode":
            result = json.dumps(decode(workbook,request),ensure_ascii=False,separators=(",",":")).encode("utf-8")
        else:
            result = render(workbook,request)
        allowance = (512 if request["operation"] == "decode" else 128) * 1024 * 1024
        demand(0 < len(result) <= allowance, "LAB_EDD_WORKBOOK_OUTPUT_SIZE",
               "The complete native result exceeds the file job output capacity.")
        return result
    finally:
        workbook.zip.close()

def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if args:
        demand(len(args) == 4 and args[0] == "--files", "LAB_EDD_WORKBOOK_REQUEST",
               "Use the native job control, original source and result paths.")
        with regular_input(args[1]) as control:
            request = read_request(control)
        with regular_input(args[2]) as source:
            result = native_result(source, request)
        # These files are in the original broker's private scratch. Creation is
        # exclusive; an existing result is never replaced or followed through a link.
        descriptor = os.open(args[3], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        with os.fdopen(descriptor, "wb") as outgoing:
            outgoing.write(result)
            outgoing.flush()
        return
    request = read_request(sys.stdin.buffer)
    expected = request["source"]
    with tempfile.TemporaryFile(mode="w+b") as source:
        with os.fdopen(3,"rb",closefd=False) as incoming:
            received = 0
            while True:
                block = incoming.read(1024*1024)
                if not block: break
                received += len(block)
                demand(received <= expected["bytes"], "LAB_EDD_WORKBOOK_SOURCE", "The source workbook grew during transfer.")
                source.write(block)
        demand(received == expected["bytes"], "LAB_EDD_WORKBOOK_SOURCE", "The source workbook transfer is incomplete.")
        source.flush(); source.seek(0)
        sys.stdout.buffer.write(native_result(source, request))
        sys.stdout.buffer.flush()

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stderr.write(json.dumps({"error":getattr(error,"code","LAB_EDD_WORKBOOK_FAILED"),
                                    "message":str(error),"details":getattr(error,"details",None)},ensure_ascii=False)+"\n")
        raise SystemExit(1)
