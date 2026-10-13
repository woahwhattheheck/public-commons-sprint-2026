"""Typed original-workbook exchange for the retained questionnaire workspace.

The original ZIP stays immutable. Successor XLSX files copy every ZIP member and
splice only explicitly selected cells into the original worksheet XML. Calculation
and disclosure use the existing questionnaire/producer workflows.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import math
import zipfile
import xml.etree.ElementTree as ET
import xml.parsers.expat as expat
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

from workbooks import read_xlsx, cell_parts as native_cell_parts, col_letters, range_cells

S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
N = {"s": S}
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
CELL = re.compile(r"^[A-Z]{1,3}[1-9][0-9]{0,6}$")
NUMBER = re.compile(r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?$")
EDIT_KINDS = {"text", "number", "boolean", "date", "blank", "absent"}
EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class ExchangeError(ValueError):
    def __init__(self, code, message, detail=None):
        super().__init__(message)
        self.code, self.detail = code, detail


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def cell_xy(address):
    row, column = native_cell_parts(address)
    return column, row


def cell_address(value):
    if not isinstance(value, str) or not CELL.fullmatch(value):
        raise ExchangeError("CELL_ADDRESS", "Use an uppercase Excel cell address")
    column, row = cell_xy(value)
    if column > 16384 or row > 1048576:
        raise ExchangeError("CELL_ADDRESS", "Cell is outside the XLSX worksheet")
    return value


def visible_text(node):
    if node is None:
        return None
    direct = node.find("s:t", N)
    if direct is not None:
        return direct.text or ""
    return "".join((part.text or "") for run in node.findall("s:r", N)
                   for part in run.findall("s:t", N))


def tree_record(node):
    return {"tag": node.tag, "attributes": dict(node.attrib), "text": node.text,
            "children": [tree_record(child) for child in node]}


def semantic_cell(node, shared):
    if node is None:
        result = {"present": False, "state": "absent", "value": None, "raw": None,
                  "value_node_present": False, "formula": None, "cached": None,
                  "excel_type": None, "attributes": {}, "style": None}
        result["identity"] = sha256(canonical(result).encode())
        return result
    kind = node.get("t", "n")
    value_node = node.find("s:v", N)
    raw = None if value_node is None else value_node.text or ""
    formula = node.find("s:f", N)
    inline = node.find("s:is", N)
    if kind == "s" and raw not in (None, ""):
        try:
            if not raw.isdigit():
                raise ValueError()
            value = visible_text(shared[int(raw)])
        except (IndexError, ValueError):
            raise ExchangeError("SHARED_STRING", "Original shared-string reference is invalid")
        value_kind = "text"
    elif kind == "inlineStr":
        value, value_kind = visible_text(inline), "text"
    elif kind == "str":
        value, value_kind = raw, "text"
    elif kind == "b":
        value, value_kind = (raw == "1" if raw in {"0", "1"} else raw), "boolean"
    elif kind == "e":
        value, value_kind = raw, "error"
    elif kind == "d":
        value, value_kind = raw, "date"
    elif kind == "n":
        value, value_kind = raw, "number"
    else:
        value, value_kind = raw, "unknown"
    state = ("formula" if formula is not None else
             "blank" if value_node is None and inline is None else
             "blank" if value_kind == "number" and raw == "" else value_kind)
    result = {"present": True, "state": state, "value": value, "raw": raw,
              "value_node_present": value_node is not None,
              "excel_type": kind, "attributes": dict(node.attrib),
              "style": node.get("s"), "formula": None, "cached": None}
    if formula is not None:
        result["formula"] = {"text": formula.text or "", "attributes": dict(formula.attrib)}
        result["cached"] = {"present": value_node is not None, "kind": value_kind,
                            "raw": raw, "value": value}
    if inline is not None:
        result["inline_string"] = tree_record(inline)
    if kind == "s" and raw not in (None, ""):
        result["shared_string"] = tree_record(shared[int(raw)])
    result["identity"] = sha256(canonical(result).encode())
    return result


def semantic_workbook(data, selection=None):
    """Read source semantics without converting decimals, dates or formula caches."""
    native = read_xlsx(data)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        shared = (ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", N)
                  if "xl/sharedStrings.xml" in archive.namelist() else [])
        book_root = ET.fromstring(archive.read("xl/workbook.xml"))
        result = {"schema": "atssc.workbook-semantics.v1", "sha256": sha256(data),
                  "bytes": len(data), "date1904": native["date1904"],
                  "defined_names": [tree_record(x) for x in book_root.findall("s:definedNames/s:definedName", N)],
                  "workbook_properties": [tree_record(x) for x in book_root if x.tag not in {"{"+S+"}sheets", "{"+S+"}definedNames"}],
                  "styles": (tree_record(ET.fromstring(archive.read("xl/styles.xml")))
                             if "xl/styles.xml" in archive.namelist() else None),
                  "sheets": [], "members": [], "counts": {"cells": 0, "formulas": 0, "errors": 0, "hidden_sheets": 0}}
        for info in archive.infolist():
            raw = archive.read(info.filename)
            result["members"].append({"path": info.filename, "bytes": len(raw), "sha256": sha256(raw)})
        for original in native["sheets"]:
            root = ET.fromstring(archive.read(original["member"]))
            all_cells = {cell.get("r"): cell for row in root.findall("s:sheetData/s:row", N) for cell in row.findall("s:c", N)}
            if len(all_cells) != len(original["cells"]):
                raise ExchangeError("CELL_IDENTITY", "Original worksheet cell identity is ambiguous")
            rows = {row.get("r"): dict(row.attrib) for row in root.findall("s:sheetData/s:row", N)}
            chosen = list(all_cells) if selection is None else selection.get(original["name"], [])
            cells = {cell_address(address): semantic_cell(all_cells.get(address), shared) for address in chosen}
            counts = {"cells": len(all_cells),
                      "formulas": sum(c.find("s:f", N) is not None for c in all_cells.values()),
                      "errors": sum(c.get("t") == "e" for c in all_cells.values())}
            result["sheets"].append({"name": original["name"], "state": original["state"],
                "member": original["member"], "dimension": original["dimension"],
                "cells": cells, "rows": rows, "counts": counts,
                "structure": [tree_record(x) for x in root if x.tag != "{"+S+"}sheetData"],
                "attributes": dict(root.attrib)})
            for name, number in counts.items():
                result["counts"][name] += number
            result["counts"]["hidden_sheets"] += int(original["state"] != "visible")
        return result


def _token_end(raw, start):
    quote = None
    for index in range(start, len(raw)):
        byte = raw[index]
        if quote is not None:
            if byte == quote:
                quote = None
        elif byte in (34, 39):
            quote = byte
        elif byte == 62:
            return index + 1
    raise ExchangeError("XML", "Original XML tag is incomplete")


def _xml_index(raw):
    parser = expat.ParserCreate(namespace_separator="|")
    stack, rows, cells, singleton = [], {}, {}, {}
    def begin(name, attributes):
        local = name.rsplit("|", 1)[-1]
        start = parser.CurrentByteIndex
        end = _token_end(raw, start)
        token = raw[start:end]
        record = {"local": local, "name": name, "attributes": attributes, "start": start,
                  "open_end": end, "empty": token.rstrip().endswith(b"/>"),
                  "qname": re.match(br"<([^\s/>]+)", token).group(1).decode(),
                  "children": []}
        if stack and stack[-1]["local"] == "c":
            stack[-1]["children"].append(record)
        stack.append(record)
        if name == S+"|row":
            number = int(attributes["r"])
            if number in rows: raise ExchangeError("ROW_IDENTITY", "Duplicate original worksheet row")
            rows[number] = record
        elif name == S+"|c":
            address = cell_address(attributes.get("r"))
            if address in cells: raise ExchangeError("CELL_IDENTITY", "Duplicate original worksheet cell")
            cells[address] = record
        elif name in {S+"|sheetData", S+"|dimension", S+"|worksheet"}:
            singleton[local] = record
    def end(name):
        record = stack.pop()
        record["close_start"] = record["open_end"] if record["empty"] else parser.CurrentByteIndex
        record["end"] = record["open_end"] if record["empty"] else _token_end(raw, parser.CurrentByteIndex)
    parser.StartElementHandler, parser.EndElementHandler = begin, end
    parser.Parse(raw, True)
    if "sheetData" not in singleton:
        raise ExchangeError("SHEET_DATA", "Original worksheet has no cell container")
    return rows, cells, singleton


def _set_attribute(token, name, value):
    pattern = rb"\s+" + name.encode() + rb"""\s*=\s*(?:"[^"]*"|'[^']*')"""
    token = re.sub(pattern, b"", token)
    if value is None:
        return token
    ending = b"/>" if token.rstrip().endswith(b"/>") else b">"
    position = token.rfind(ending)
    return token[:position].rstrip() + b" " + name.encode() + b"=" + quoteattr(value).encode() + token[position:]


def _xml_text(value):
    if not isinstance(value, str) or len(value) > 32767:
        raise ExchangeError("TEXT", "Excel cell text must contain at most 32,767 characters")
    if any(not (ord(c) in {9, 10, 13} or 32 <= ord(c) <= 0xD7FF or 0xE000 <= ord(c) <= 0xFFFD or 0x10000 <= ord(c) <= 0x10FFFF) for c in value):
        raise ExchangeError("TEXT", "Excel cell text contains an unsupported XML character")
    return escape(value)


def _typed_payload(change, prefix):
    kind, value = change.get("kind"), change.get("value")
    if kind not in EDIT_KINDS:
        raise ExchangeError("CELL_TYPE", "Choose text, number, boolean, date, blank or absent")
    def tag(name, value, attributes=""):
        return ("<"+prefix+name+attributes+">"+value+"</"+prefix+name+">").encode()
    if kind in {"blank", "absent"}:
        if value is not None:
            raise ExchangeError("BLANK_VALUE", "Blank and absent cells have no value")
        return None, tag("v", "") if kind == "blank" and change.get("value_node_present") is True else b""
    if kind == "text":
        return "inlineStr", tag("is", tag("t", _xml_text(value), ' xml:space="preserve"').decode())
    if kind == "boolean":
        if type(value) is not bool: raise ExchangeError("BOOLEAN", "Use a JSON true or false value")
        return "b", tag("v", "1" if value else "0")
    if kind == "date":
        if not isinstance(value, str): raise ExchangeError("DATE", "Use an ISO calendar date or datetime")
        try:
            date.fromisoformat(value) if "T" not in value else datetime.fromisoformat(value)
        except ValueError:
            raise ExchangeError("DATE", "Use an ISO calendar date or datetime")
        return "d", tag("v", escape(value))
    if type(value) not in {str, int}:
        raise ExchangeError("NUMBER", "Use an exact decimal string or integer")
    raw = str(value)
    if len(raw) > 120 or not NUMBER.fullmatch(raw):
        raise ExchangeError("NUMBER", "Use a finite exact decimal value")
    try: finite = Decimal(raw).is_finite()
    except InvalidOperation: finite = False
    if not finite: raise ExchangeError("NUMBER", "Use a finite exact decimal value")
    return None, tag("v", raw)


def _cell_xml(raw, node, address, change, prefix):
    kind = change["kind"]
    if kind == "absent":
        return b""
    if node:
        header = raw[node["start"]:node["open_end"]]
        qname = node["qname"]
        prefix = qname.rsplit(":", 1)[0]+":" if ":" in qname else ""
        extra = b"".join(raw[c["start"]:c["end"]] for c in node["children"]
                         if c["name"] not in {S+"|f", S+"|v", S+"|is"})
    else:
        qname, extra = prefix+"c", b""
        header = ("<"+qname+" r="+quoteattr(address)+">").encode()
    type_code, payload = _typed_payload(change, prefix)
    header = _set_attribute(header, "t", type_code)
    if header.rstrip().endswith(b"/>"):
        header = header[:header.rfind(b"/>")]+b">"
    return header + payload + extra + ("</"+qname+">").encode()


def _splice(raw, edits):
    out, cursor = [], 0
    for start, end, replacement in sorted(edits, key=lambda x: (x[0], x[1])):
        if start < cursor: raise ExchangeError("XML_EDITS", "Selected worksheet edits overlap")
        out.extend((raw[cursor:start], replacement))
        cursor = end
    out.append(raw[cursor:])
    return b"".join(out)


def _rewrite_sheet(raw, changes):
    rows, cells, nodes = _xml_index(raw)
    data = nodes["sheetData"]
    root_prefix = data["qname"].rsplit(":", 1)[0]+":" if ":" in data["qname"] else ""
    by_row = {}
    for address, change in changes.items():
        _, row = cell_xy(address)
        by_row.setdefault(row, {})[address] = change
    edits, new_rows = [], {}
    indexed_cells = {}
    for address, node in cells.items():
        column, row_number = cell_xy(address)
        indexed_cells.setdefault(row_number, []).append((column, address, node))
    for values in indexed_cells.values():
        values.sort()
    for number, row_changes in sorted(by_row.items()):
        row = rows.get(number)
        if row:
            prefix = row["qname"].rsplit(":", 1)[0]+":" if ":" in row["qname"] else ""
            existing = indexed_cells.get(number, [])
            local_edits, additions = [], {}
            for address, change in sorted(row_changes.items(), key=lambda x: cell_xy(x[0])[0]):
                node = cells.get(address)
                replacement = _cell_xml(raw, node, address, change, prefix)
                if node:
                    local_edits.append((node["start"], node["end"], replacement))
                elif replacement:
                    column, _ = cell_xy(address)
                    following = next((n for c, a, n in existing if c > column), None)
                    offset = following["start"] if following else row["close_start"]
                    additions.setdefault(offset, []).append(replacement)
            if row["empty"]:
                payload = b"".join(piece for values in additions.values() for piece in values)
                if payload:
                    header = raw[row["start"]:row["open_end"]]
                    header = header[:header.rfind(b"/>")]+b">"
                    edits.append((row["start"], row["end"], header+payload+("</"+row["qname"]+">").encode()))
            else:
                edits.extend(local_edits)
                edits.extend((position, position, b"".join(pieces)) for position, pieces in additions.items())
        else:
            pieces = [_cell_xml(raw, None, address, change, root_prefix)
                      for address, change in sorted(row_changes.items(), key=lambda x: cell_xy(x[0])[0])]
            payload = b"".join(pieces)
            if payload:
                following = next((rows[n] for n in sorted(rows) if n > number), None)
                position = following["start"] if following else data["close_start"]
                new_rows.setdefault(position, []).append(("<"+root_prefix+"row r="+quoteattr(str(number))+">").encode()+payload+("</"+root_prefix+"row>").encode())
    if data["empty"]:
        payload = b"".join(piece for values in new_rows.values() for piece in values)
        if payload:
            header = raw[data["start"]:data["open_end"]]
            edits.append((data["start"], data["end"], header[:header.rfind(b"/>")]+b">"+payload+("</"+data["qname"]+">").encode()))
    else:
        edits.extend((position, position, b"".join(pieces)) for position, pieces in new_rows.items())
    dimension = nodes.get("dimension")
    if dimension:
        addresses = (set(cells)-{a for a, c in changes.items() if c["kind"] == "absent"}) | {a for a, c in changes.items() if c["kind"] != "absent"}
        bounds = [cell_xy(a) for a in addresses]
        old_ref = dimension["attributes"].get("ref")
        if old_ref:
            bounds.extend(cell_xy(a) for a in old_ref.split(":"))
        if bounds:
            first = col_letters(min(c for c, r in bounds))+str(min(r for c, r in bounds))
            last = col_letters(max(c for c, r in bounds))+str(max(r for c, r in bounds))
            ref = first if first == last else first+":"+last
            if ref != old_ref:
                header = _set_attribute(raw[dimension["start"]:dimension["open_end"]], "ref", ref)
                edits.append((dimension["start"], dimension["open_end"], header))
    return _splice(raw, edits)


def export_successor(data, changes, expected_sha256):
    """Return an original-format input edition and a source-linked change manifest."""
    if sha256(data) != expected_sha256:
        raise ExchangeError("SOURCE_HASH", "The selected original workbook edition changed")
    if not isinstance(changes, list) or len(changes) > 100000:
        raise ExchangeError("CHANGES", "Provide a list of at most 100,000 explicit cell changes")
    selection, selected = {}, {}
    for item in changes:
        if not isinstance(item, dict) or not isinstance(item.get("sheet"), str):
            raise ExchangeError("CHANGES", "Each cell change needs an original worksheet")
        address = cell_address(item.get("cell"))
        if item.get("kind") not in EDIT_KINDS:
            raise ExchangeError("CELL_TYPE", "Choose an explicit supported cell type")
        key = (item["sheet"], address)
        if key in selected: raise ExchangeError("DUPLICATE_CHANGE", "A cell occurs twice in the selected changes")
        selected[key] = item
        selection.setdefault(item["sheet"], []).append(address)
    before = semantic_workbook(data, selection)
    sheets = {s["name"]: s for s in before["sheets"]}
    if set(selection)-set(sheets):
        raise ExchangeError("WORKSHEET", "A change names an absent original worksheet")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        writes = {}
        for name, addresses in selection.items():
            sheet = sheets[name]
            for address in addresses:
                original, item = sheet["cells"][address], selected[(name, address)]
                if item.get("expected_cell_identity") and item["expected_cell_identity"] != original.get("identity"):
                    raise ExchangeError("CELL_CHANGED", "Selected source cell differs from the reviewed cell", {"sheet": name, "cell": address})
                if original["formula"] is not None:
                    raise ExchangeError("FORMULA_CELL", "Choose an answer cell; the calculation workflow owns formula cells", {"sheet": name, "cell": address})
                _typed_payload(item, "")
            root = ET.fromstring(archive.read(sheet["member"]))
            for merge in root.findall("s:mergeCells/s:mergeCell", N):
                reference = merge.get("ref")
                if reference:
                    overlap = (set(range_cells(reference)) - {reference.split(":")[0]}) & set(addresses)
                    if overlap:
                        raise ExchangeError("MERGED_CELL", "Use the first cell of the original merged answer range", {"sheet": name, "cells": sorted(overlap), "anchor": reference.split(":")[0]})
            for formula in root.findall("s:sheetData/s:row/s:c/s:f", N):
                if formula.get("t") in {"array", "dataTable"} and formula.get("ref"):
                    covered = set(range_cells(formula.get("ref")))
                    overlap = covered & set(addresses)
                    if overlap:
                        raise ExchangeError("ARRAY_FORMULA", "Choose answer cells outside the original array or data-table formula", {"sheet": name, "cells": sorted(overlap)})
            writes[sheet["member"]] = _rewrite_sheet(archive.read(sheet["member"]), {a: selected[(name, a)] for a in addresses})
        if not changes:
            return data, {"schema": "atssc.workbook-exchange.v1", "source_sha256": expected_sha256,
                          "sha256": expected_sha256, "bytes": len(data), "changes": [],
                          "unchanged_members": before["members"], "calculation": "original_edition"}
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as target:
            target.comment = archive.comment
            for info in archive.infolist():
                target.writestr(info, writes.get(info.filename, archive.read(info.filename)))
    raw = output.getvalue()
    after = semantic_workbook(raw, selection)
    after_sheets = {s["name"]: s for s in after["sheets"]}
    new_members = {m["path"]: m for m in after["members"]}
    unchanged = [m for m in before["members"] if m["path"] not in writes]
    if any(new_members.get(m["path"]) != m for m in unchanged):
        raise ExchangeError("MEMBER_IDENTITY", "An unselected workbook part changed during exchange")
    records = []
    for (name, address), item in selected.items():
        records.append({"sheet": name, "cell": address, "requested": item,
                        "before": sheets[name]["cells"][address], "after": after_sheets[name]["cells"][address]})
    return raw, {"schema": "atssc.workbook-exchange.v1", "source_sha256": expected_sha256,
                 "sha256": sha256(raw), "bytes": len(raw), "changes": records,
                 "unchanged_members": unchanged, "changed_members": [new_members[p] for p in writes],
                 "calculation": "input_edition_ready_for_calculation",
                 "original_formula_count": before["counts"]["formulas"],
                 "retained_formula_count": after["counts"]["formulas"]}


def file_result(name, raw, metadata=None, mime=EXCEL_MIME):
    return {"name": name, "mime_type": mime, "bytes": len(raw), "sha256": sha256(raw),
            "data_base64": base64.b64encode(raw).decode("ascii"), "metadata": metadata}


def present_source_register(raw, tables):
    """Keep the maintained writer's records readable and preserve typed metadata."""
    namespace = "{"+S+"}"
    ET.register_namespace("", S)
    styles = ('<styleSheet xmlns="'+S+'"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts>'
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E5E5"/><bgColor indexed="64"/></patternFill></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="4"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
        '<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf></cellXfs>'
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>').encode()
    with zipfile.ZipFile(io.BytesIO(raw)) as source:
        members={name:source.read(name) for name in source.namelist()}
    widths = {
        'Extraction':[38,110],
        'Question mapping':[42,96,14,36,28,12,22,16,42,18,18,18,14,14],
        'Source cells':[42,96,18,16,36,36,36,28,12,20,12,42,42,18,72,42,16,18,42,14,18,18,14,36],
        'Validation':[42,20,18,16,34,90,28,12,20],
    }
    for index,(name,table) in enumerate(tables.items(),1):
        path='xl/worksheets/sheet'+str(index)+'.xml';sheet=ET.fromstring(members[path])
        columns=ET.Element(namespace+'cols')
        for position,width in enumerate(widths[name],1):
            ET.SubElement(columns,namespace+'col',min=str(position),max=str(position),width=str(width),customWidth='1')
        data=sheet.find(namespace+'sheetData');sheet.insert(list(sheet).index(data),columns)
        view=sheet.find(namespace+'sheetViews/'+namespace+'sheetView');view.set('showGridLines','0')
        pane=view.find(namespace+'pane')
        if name!='Extraction':pane.set('xSplit','1');pane.set('topLeftCell','B2');pane.set('activePane','bottomRight')
        values=[table['headers'],*table['rows']]
        for row,value_row in zip(data,values):
            lines=max([1,*[sum(max(1,math.ceil(len(part)/max(1,widths[name][column]-3))) for part in (canonical(value) if isinstance(value,(dict,list)) else '' if value is None else str(value)).split('\n')) for column,value in enumerate(value_row)]])
            row.set('ht',str(max(26 if row.get('r')=='1' else 20,lines*13+6)));row.set('customHeight','1')
            for cell,value in zip(row,value_row):
                cell.set('s','1' if row.get('r')=='1' else '0')
                if row.get('r')!='1' and type(value) in {int,bool}:
                    for child in list(cell):cell.remove(child)
                    cell.set('t','b' if type(value) is bool else 'n');cell.set('s','3' if type(value) is bool else '2')
                    ET.SubElement(cell,namespace+'v').text=('1' if value else '0') if type(value) is bool else str(value)
        members[path]=ET.tostring(sheet,encoding='utf-8',xml_declaration=True)
    members['xl/styles.xml']=styles
    content=members['[Content_Types].xml'].decode().replace('</Types>','<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>')
    members['[Content_Types].xml']=content.encode()
    relations=members['xl/_rels/workbook.xml.rels'].decode().replace('</Relationships>','<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    members['xl/_rels/workbook.xml.rels']=relations.encode()
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as target:
        for name,body in sorted(members.items()):
            info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;target.writestr(info,body)
    return output.getvalue()


class WorkbookExchange:
    """Operation implementation bound to the maintained extension router."""

    def __init__(self, workspace):
        self.workspace = workspace

    def __getattr__(self, name):
        return getattr(self.workspace, name)

    def _exchange_original(self, sha):
        with self.connection() as db:
            row = db.execute("SELECT name,bytes,source_url FROM workbooks WHERE sha=?", (sha,)).fetchone()
        if row is None: raise ExchangeError("NOT_FOUND", "Retain the complete workbook before exchanging it")
        raw = bytes(row["bytes"])
        if sha256(raw) != sha: raise ExchangeError("SOURCE_HASH", "The retained workbook bytes differ from their source identity")
        return row["name"], raw, row["source_url"]

    def op_exchange_inspect(self, p):
        _, raw, _ = self._exchange_original(p["sha256"])
        selection = None
        if p.get("sheet"):
            addresses = p.get("cells")
            if addresses is None:
                addresses = range_cells(p.get("range", "A1:H40"))
            if not isinstance(addresses, list) or len(addresses) > 10000:
                raise ExchangeError("RANGE", "Inspect at most 10,000 explicitly selected cells")
            selection = {p["sheet"]: addresses}
        else:
            selection = {}
        result = semantic_workbook(raw, selection)
        if p.get("sheet") and p["sheet"] not in {s["name"] for s in result["sheets"]}:
            raise ExchangeError("WORKSHEET", "The original worksheet was not found")
        if p.get("sheet"):
            result["sheets"] = [s for s in result["sheets"] if s["name"] == p["sheet"]]
        return result

    def op_exchange_download_original(self, p):
        name, raw, source_url = self._exchange_original(p["sha256"])
        return file_result(name, raw, {"source_url": source_url, "edition": "retained_original"})

    def _exchange_definition(self, p):
        def display(definition):
            project = getattr(self.workspace, "_display_definition", None)
            return project(definition) if callable(project) else definition
        if p.get("respondent_id"):
            record = self.op_get_respondent({"respondent_id": p["respondent_id"]})
            return record.get("display_definition") or display(record["definition"]), record["publication"]
        if p.get("publication_id"):
            with self.connection() as db:
                publication, definition = self._definition(db, p["publication_id"])
            return display(definition), publication
        record = self.op_get_definition({"questionnaire_id": p["questionnaire_id"],
                                         **({"version": p["version"]} if p.get("version") is not None else {})})
        return display(record["definition"]), {"questionnaire_id": record["questionnaire_id"], "definition_version": record["version"]}

    def op_exchange_mapping(self, p):
        from questionnaire_workspace import is_calculated, table_rows
        definition, publication = self._exchange_definition(p)
        rows, conflicts, locations = [], [], {}
        for question in definition["questions"]:
            binding = question.get("source")
            row = {"question_id": question["id"], "label": question["label"], "kind": question["kind"],
                   "disclosure": question.get("disclosure", "protected"), "binding": binding,
                   "calculated": is_calculated(question), "source_readonly": bool(question.get("source_readonly")),
                   "workbook_scale": question.get("workbook_scale", "1")}
            for key in ("unit", "original_question_text", "original_row_label", "section", "original_question_heading", "original_french_text", "original_row_french_label", "original_context", "original_period_context", "original_answer_option", "original_choice_labels", "original_choice_french_labels"):
                if key in question:
                    row[key] = question[key]
            if binding and question["kind"] == "table":
                row["columns"] = [{"id": c["id"], "label": c["label"], "kind": c["kind"],
                                   "source_column": c.get("source_column"),
                                   "source_readonly": bool(c.get("source_readonly")),
                                   "workbook_scale": c.get("workbook_scale", "1"),
                                   "disclosure": c.get("disclosure", question.get("disclosure", "protected"))}
                                  for c in question["columns"]]
                row["source_rows"] = table_rows(binding)
                row["source_row_count"] = len(row["source_rows"])
            elif binding:
                key = (binding["workbook_sha256"], binding["sheet"], binding["cell"])
                if key in locations:
                    conflicts.append({"questions": [locations[key], question["id"]], "source": binding})
                locations[key] = question["id"]
            rows.append(row)
        return {"schema": "atssc.questionnaire-source-mapping.v1", "publication": publication,
                "title": definition.get("title"), "source_workbooks": definition.get("source_workbooks", []),
                "questions": rows, "overlapping_scalar_bindings": conflicts}

    def op_exchange_extract(self, p):
        """Keep full cell semantics beside the original native answer projection."""
        from questionnaire_workspace import is_calculated, table_rows, validate_answers
        from workbook_calculation import project_answers
        definition, publication = self._exchange_definition(p)
        template = p.get("template_sha256")
        sources = definition.get("source_workbooks", [])
        if template is None and len(sources) == 1:
            template = sources[0]
        if template not in sources:
            raise ExchangeError("TEMPLATE", "Select the published definition's original workbook identity")
        if p.get("formula_values") not in {None, "preserve", "cached"}:
            raise ExchangeError("FORMULA_VALUE_SELECTION", "Select retained formula caches explicitly")
        name, raw, source_url = self._exchange_original(p["sha256"])
        fields = [q for q in definition["questions"] if q.get("source", {}).get("workbook_sha256") == template]
        selection = {}
        for question in fields:
            binding = question["source"]
            if question["kind"] == "table":
                selected = [c["source_column"]+str(r) for r in table_rows(binding) for c in question["columns"]]
            else:
                selected = [binding["cell"]]
            selection.setdefault(binding["sheet"], []).extend(selected)
        if sum(len(v) for v in selection.values()) > 100000:
            raise ExchangeError("MAPPING_SIZE", "Select a definition with at most 100,000 mapped workbook cells")
        book = semantic_workbook(raw, selection)
        sheets = {s["name"]: s for s in book["sheets"]}
        native_book = self.workbook(p["sha256"])
        native_sheets = {s["name"]: s for s in native_book["sheets"]}
        answers, computed, records, issues, formula_issues, source_rows = {}, {}, [], [], [], {}
        blocked = set()

        def source_issues(question, findings):
            (formula_issues if is_calculated(question) else issues).extend(findings)

        def record_cell(question, column, address, number=None):
            binding = question["source"]
            sheet_name = binding["sheet"]
            state = sheets.get(sheet_name, {}).get("cells", {}).get(address, semantic_cell(None, []))
            spec = column or question
            record = {"question_id": question["id"], "label": question["label"],
                      "column_id": column.get("id") if column else None,
                      "source_row": number, "source_readonly": bool(spec.get("source_readonly")),
                      "calculated": is_calculated(question), "workbook_scale": spec.get("workbook_scale", "1"),
                      "source": {"workbook_sha256": p["sha256"], "template_sha256": template,
                                 "sheet": sheet_name, "cell": address}, "cell": state}
            records.append(record)
            error = None
            if sheet_name not in sheets:
                error = "WORKBOOK_BINDING"
            elif state["state"] == "error":
                error = "SOURCE_CELL_ERROR"
            elif state["formula"] is not None and p.get("formula_values") != "cached":
                error = "FORMULA_VALUE_SELECTION"
            elif state["formula"] is not None and (not state["cached"]["present"] or state["cached"]["kind"] == "error"):
                error = "SOURCE_FORMULA_CACHE"
            if error:
                source_issues(question, [{"field": question["id"], "column": record["column_id"], "source_row": number,
                               "code": error, "message": "Review this source cell in the original calculation workflow",
                               "source": record["source"], "cell": state}])
                blocked.add((sheet_name, address))
                # This is only the in-memory projection. The retained workbook bytes
                # and the complete original semantic record above remain unchanged.
                cell = native_sheets.get(sheet_name, {}).get("cells", {}).get(address)
                if cell is not None:
                    cell["value"] = None
            return record

        for question in fields:
            binding = question["source"]
            if question["kind"] == "table":
                for number in table_rows(binding):
                    for column in question["columns"]:
                        record_cell(question, column, column["source_column"]+str(number), number)
            else:
                record_cell(question, None, binding["cell"])

        for question in fields:
            binding = question["source"]
            if "calculation" in question:
                continue
            target = computed if question.get("source_calculated") else answers
            if question["kind"] != "table":
                projection = project_answers({"questions": [question]}, native_book, template)
                source_issues(question, projection["issues"])
                if not question.get("source_calculated") or (
                    p.get("formula_values") == "cached" and (
                        (binding["sheet"], binding["cell"]) not in blocked or
                        sheets.get(binding["sheet"], {}).get("cells", {}).get(binding["cell"], {}).get("cached", {}).get("present")
                    )
                ):
                    target.update(projection["answers"])
                continue
            rows, row_ids = [], []
            for number in table_rows(binding):
                one = {**question, "source": {**binding, "start_row": number, "end_row": number, "rows": [number]}}
                projection = project_answers({"questions": [one]}, native_book, template)
                source_issues(question, projection["issues"])
                projected = projection["answers"].get(question["id"], [])
                position = None
                if projected or binding.get("rows"):
                    # Explicit original rows retain their positions even when a
                    # respondent clears every editable cell in that row.
                    values = projected[0] if projected else {
                        c["id"]: "" if native_sheets.get(binding["sheet"], {}).get("cells", {}).get(
                            c["source_column"]+str(number), {}).get("value") == "" else None
                        for c in question["columns"]
                    }
                    position = len(rows)
                    rows.append(values)
                row_ids.append({"answer_row": position, "source_row": number,
                                "identity": sha256(canonical([template, binding["sheet"], number, question["id"]]).encode())})
            target[question["id"]] = rows
            source_rows[question["id"]] = row_ids
        row_maps = {key: {item["source_row"]: item for item in items} for key, items in source_rows.items()}
        for record in records:
            identity = row_maps.get(record["question_id"], {}).get(record["source_row"], {})
            record["answer_row"] = identity.get("answer_row")
            record["source_row_identity"] = identity.get("identity")
        if p.get("respondent_id"):
            respondent = self.op_get_respondent({"respondent_id": p["respondent_id"]})
            current = respondent["draft"] or (respondent["revisions"][-1] if respondent["revisions"] else None)
            if current is not None:
                answers = {**current["answers"], **answers}
        validation = validate_answers(definition, answers, computed_values=computed, formula_issues=formula_issues,
                                      source_values=self.source_values(definition))
        validation["issues"].extend(issues)
        validation["valid"] = not validation["issues"]
        return {"schema": "atssc.workbook-extraction.v1", "publication": publication,
                "respondent_id": p.get("respondent_id"), "workbook_sha256": p["sha256"],
                "template_sha256": template, "name": name, "source_url": source_url,
                "answers": answers, "computed_values": computed, "validation": validation, "cells": records,
                "source_issues": issues + formula_issues,
                "source_rows": source_rows, "mapping": self.op_exchange_mapping(p)}

    def op_exchange_export(self, p, _operation_name="exchange_export"):
        if p.get("retain", True):
            cached = self._cached_mutation(_operation_name)
            if cached is not None:
                return cached
        name, raw, _ = self._exchange_original(p["sha256"])
        successor, manifest = export_successor(raw, p.get("changes", []), p["sha256"])
        if not p.get("retain", True):
            return file_result(Path(name).stem+"-edition.xlsx", successor, manifest)
        from questionnaire_workspace import encoded, now
        book = read_xlsx(successor)
        edition_name = Path(name).stem+"-edition.xlsx"
        imported = {key: book[key] for key in ("sha256", "bytes", "sheetCount", "cellCount", "formulaCount", "externalLinks", "macroMembers")}
        def action(db):
            db.execute("INSERT OR IGNORE INTO workbooks VALUES(?,?,?,?,?,?)",
                       (book["sha256"], edition_name, None, now(), encoded(book), successor))
            return file_result(edition_name, successor, {**manifest, "retained": imported})
        return self._write(_operation_name, book["sha256"], manifest, action)

    def op_exchange_extract_file(self, p):
        extraction = self.op_exchange_extract(p)
        raw = (json.dumps(extraction, ensure_ascii=False, indent=2)+"\n").encode()
        return file_result("workbook-source-extraction.json", raw, {
            "workbook_sha256": extraction["workbook_sha256"], "cells": len(extraction["cells"])},
            "application/json; charset=utf-8")

    def op_exchange_extract_package(self, p):
        """Create the full internal Excel extraction with its exact editable JSON."""
        from respondent_operations import make_xlsx
        extraction = self.op_exchange_extract(p)
        mapping = extraction["mapping"]
        tables = {
            "Extraction": {"headers": ["Field", "Value"], "rows": [
                ["Workbook", extraction["name"]],
                ["Workbook SHA256", extraction["workbook_sha256"]],
                ["Original template SHA256", extraction["template_sha256"]],
                ["Source URL", extraction["source_url"]],
                ["Questionnaire", mapping["title"]],
                ["Publication", extraction["publication"]],
                ["Source cell count", len(extraction["cells"])],
                ["Answer validation issue count", len(extraction["validation"]["issues"])],
                ["Original formula review issue count", len(extraction["validation"]["formula_issues"])],
            ]},
            "Question mapping": {"headers": ["Question ID", "Label", "Kind", "Original workbook", "Worksheet", "Cell",
                "Physical rows", "Column ID", "Column label", "Source column", "Workbook scale", "Source readonly",
                "Calculated", "Disclosure"], "rows": []},
            "Source cells": {"headers": ["Question ID", "Label", "Column ID", "Physical row", "Stable row identity",
                "Workbook SHA256", "Original template SHA256", "Worksheet", "Cell", "State", "Present",
                "Exact value", "Original raw value", "Value node present", "Formula text", "Formula attributes",
                "Cache present", "Cache kind", "Cache raw value", "Cell style", "Workbook scale", "Source readonly",
                "Calculated", "Cell identity"], "rows": []},
            "Validation": {"headers": ["Question ID", "Rule", "Column", "Physical row", "Code", "Message",
                "Worksheet", "Cell", "Issue kind"], "rows": []},
        }
        for question in mapping["questions"]:
            binding = question.get("binding") or {}
            for column in question.get("columns") or [None]:
                field = column or question
                tables["Question mapping"]["rows"].append([
                    question["question_id"], question["label"], question["kind"],
                    binding.get("workbook_sha256"), binding.get("sheet"), binding.get("cell"),
                    question.get("source_rows"), None if column is None else column["id"],
                    None if column is None else column["label"], field.get("source_column"),
                    field.get("workbook_scale", "1"), field.get("source_readonly", False),
                    question["calculated"], field.get("disclosure", question.get("disclosure")),
                ])
        for record in extraction["cells"]:
            cell, source = record["cell"], record["source"]
            formula, cached = cell.get("formula") or {}, cell.get("cached") or {}
            tables["Source cells"]["rows"].append([
                record["question_id"], record["label"], record["column_id"], record["source_row"],
                record["source_row_identity"], source["workbook_sha256"], source["template_sha256"],
                source["sheet"], source["cell"], cell["state"], cell["present"], cell["value"], cell.get("raw"),
                cell.get("value_node_present"), formula.get("text"), formula.get("attributes"),
                cached.get("present"), cached.get("kind"), cached.get("raw"), cell.get("attributes", {}).get("s"),
                record["workbook_scale"], record["source_readonly"], record["calculated"], cell["identity"],
            ])
        findings = [(issue, "answer") for issue in extraction["validation"]["issues"]]
        findings.extend((issue, "original_formula") for issue in extraction["validation"]["formula_issues"])
        for issue, issue_kind in findings:
            source = issue.get("source", {})
            tables["Validation"]["rows"].append([
                issue.get("field"), issue.get("rule"), issue.get("column"), issue.get("source_row", issue.get("row")),
                issue.get("code"), issue.get("message", issue.get("reason")), source.get("sheet", issue.get("sheet")),
                source.get("cell", issue.get("cell")), issue_kind,
            ])
        workbook = present_source_register(make_xlsx(tables), tables)
        document = (json.dumps(extraction, ensure_ascii=False, indent=2)+"\n").encode()
        manifest = {"schema": "atssc.internal-source-extraction.v1",
                    "workbook_sha256": extraction["workbook_sha256"], "template_sha256": extraction["template_sha256"],
                    "files": [{"path": "Source_Extraction.xlsx", "bytes": len(workbook), "sha256": sha256(workbook)},
                              {"path": "Source_Extraction.json", "bytes": len(document), "sha256": sha256(document)}],
                    "source_cells": len(extraction["cells"]), "publication": extraction["publication"]}
        package = io.BytesIO()
        with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, raw in [("Source_Extraction.xlsx", workbook), ("Source_Extraction.json", document),
                              ("manifest.json", (json.dumps(manifest, ensure_ascii=False, indent=2)+"\n").encode())]:
                info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, raw)
        return file_result("Workbook_Source_Extraction.zip", package.getvalue(), manifest, "application/zip")

    def op_exchange_export_answers(self, p):
        if p.get("retain", True):
            cached = self._cached_mutation("exchange_export_answers")
            if cached is not None:
                return cached
        from questionnaire_workspace import is_calculated, scalar, table_rows
        from workbook_calculation import _answer_record
        definition, _ = self._exchange_definition(p)
        template = p.get("template_sha256")
        sources = definition.get("source_workbooks", [])
        if template is None and len(sources) == 1:
            template = sources[0]
        if template not in sources:
            raise ExchangeError("TEMPLATE", "Select the original workbook bound to this definition")
        answers = p.get("answers")
        if not isinstance(answers, dict):
            raise ExchangeError("ANSWERS", "Provide answers keyed by original question identifier")
        known = {q["id"]: q for q in definition["questions"]}
        if set(answers)-set(known):
            raise ExchangeError("ANSWERS", "An answer has no question in this selected definition")
        original = self.workbook(template)
        original_sheets = {s["name"]: s for s in original["sheets"]}
        fixed = self.source_values(definition)
        changes = []

        def change(field, binding, address, value, retained=None):
            converted = scalar(field, value)
            if field.get("source_readonly"):
                if converted != scalar(field, retained):
                    raise ExchangeError("SOURCE_READONLY", "This value is fixed by the retained original worksheet")
                return
            source_cell = original_sheets.get(binding["sheet"], {}).get("cells", {}).get(address)
            if source_cell is None or source_cell["formula"] is not None:
                raise ExchangeError("WORKBOOK_BINDING", "A bound answer must use an existing original input cell")
            record = _answer_record(converted, field, original)
            if value == "" and field["kind"] not in {"number", "integer", "date", "boolean"}:
                kind, output = "text", ""
            elif record["raw"] is None:
                kind, output = "blank", None
            elif record["kind"] == "n":
                kind, output = "number", record["raw"]
            elif record["kind"] == "b":
                kind, output = "boolean", record["value"]
            else:
                kind, output = "text", record["value"]
            changes.append({"sheet": binding["sheet"], "cell": address, "kind": kind, "value": output})

        for key, value in answers.items():
            question, binding = known[key], known[key].get("source")
            if is_calculated(question):
                raise ExchangeError("CALCULATED_FIELD", "Calculated answers use the original calculation workflow")
            if not binding or binding.get("workbook_sha256") != template:
                raise ExchangeError("WORKBOOK_BINDING", "This answer belongs to another source workbook")
            if question["kind"] != "table":
                change(question, binding, binding["cell"], value, fixed.get(key))
                continue
            if not isinstance(value, list):
                raise ExchangeError("TABLE", "Provide table rows with explicit original row numbers")
            selected_rows = table_rows(binding)
            row_positions = {number: index for index, number in enumerate(selected_rows)}
            occupied = set()
            columns = {c["id"]: c for c in question["columns"]}
            for row in value:
                number = row.get("source_row") if isinstance(row, dict) else None
                values = row.get("values") if isinstance(row, dict) else None
                if type(number) is not int or number not in row_positions or number in occupied:
                    raise ExchangeError("SOURCE_ROW", "Use each selected original worksheet row at most once")
                if not isinstance(values, dict) or set(values)-set(columns):
                    raise ExchangeError("TABLE_COLUMN", "Use the original table column identifiers")
                identity = sha256(canonical([template, binding["sheet"], number, key]).encode())
                if row.get("source_row_identity") not in {None, identity}:
                    raise ExchangeError("SOURCE_ROW", "This row identity belongs to another original worksheet binding")
                occupied.add(number)
                original_rows = fixed.get(key, [])
                context = original_rows[row_positions[number]] if row_positions[number] < len(original_rows) else {}
                for column, entered in values.items():
                    spec = columns[column]
                    change(spec, binding, spec["source_column"]+str(number), entered, context.get(column))
        return self.op_exchange_export({"sha256": p.get("sha256", template), "changes": changes,
                                        "retain": p.get("retain", True)}, _operation_name="exchange_export_answers")

# The existing Native-Trade loader supplies the workspace and owns all commits.
def _operation(method):
    def invoke(workspace, params):
        return getattr(WorkbookExchange(workspace), "op_"+method)(params)
    return invoke


OPERATIONS = {method: _operation(method) for method in (
    "exchange_inspect", "exchange_download_original", "exchange_mapping",
    "exchange_extract", "exchange_export", "exchange_extract_file",
    "exchange_export_answers", "exchange_extract_package",
)}
