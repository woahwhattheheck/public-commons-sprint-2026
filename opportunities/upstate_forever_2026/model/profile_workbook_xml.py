"""Source-preserving XLSX/XLSM cell returns for saved scientific profiles.

TokenJunkieLabs. Uses the maintained workbook package helpers. It never evaluates
formulas/macros/links. Only explicitly selected cell XML and the declared native
calculation-request tag may differ; every other original member stays exact.
"""
from __future__ import annotations
from copy import copy
from decimal import Decimal, InvalidOperation
import importlib.util
import io
from pathlib import Path
import re
import zipfile
from xml.parsers import expat

_HELPER = Path(__file__).resolve().parents[1] / "measurement_workspace" / "engine" / "source_workbook_append.py"
_spec = importlib.util.spec_from_file_location("_upstate_original_workbook_append", _HELPER)
if _spec is None or _spec.loader is None:
    raise ImportError("Install the complete original workbook helper")
h = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(h)

MAX_ORIGINAL = 128 * 1024 * 1024
MAX_CELLS = 2_000_000
CELL = re.compile(r"^([A-Z]{1,3})([1-9][0-9]{0,6})$")
NUMBER = re.compile(r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?$")
MAIN = h.NS_MAIN
need = h.need


def coordinates(value):
    need(isinstance(value, str) and CELL.fullmatch(value), "Use an original A1 cell address.")
    match = CELL.fullmatch(value)
    col = 0
    for char in match[1]:
        col = col * 26 + ord(char) - 64
    row = int(match[2])
    need(col <= 16384 and row <= 1048576, "Cell is outside Excel worksheet capacity.")
    return row, col


def literal(value):
    # Decode OOXML's literal escape exactly once. _x005F_x0041_ is the literal
    # text _x0041_, not A. This reader does not interpret a second escape pass.
    decoded = re.sub(r"_x([0-9A-Fa-f]{4})_", lambda m: chr(int(m[1], 16)), value)
    return decoded.encode("utf-16-le", errors="surrogatepass").decode("utf-16-le", errors="replace")


def text_content(node):
    return "".join(n.data for n in node.childNodes if n.nodeType in (n.TEXT_NODE, n.CDATA_SECTION_NODE))


def rich_text(node, main):
    output = []
    for child in node.childNodes:
        if child.nodeType != child.ELEMENT_NODE:
            continue
        if child.namespaceURI == main and child.localName == "t":
            output.append(text_content(child))
        elif child.namespaceURI == main and child.localName == "r":
            output.extend(text_content(t) for t in h.children(child, "t", main))
    return literal("".join(output))


def token_end(raw, start):
    quote = None
    for index in range(start, len(raw)):
        char = raw[index]
        if quote is not None:
            if char == quote:
                quote = None
        elif char in (34, 39):
            quote = char
        elif char == 62:
            return index + 1
    raise h.WorkbookError("An original XML token is incomplete.")


def spans(raw, main, selected=("c", "calcPr")):
    """Expat byte offsets select complete elements without reserializing neighbors."""
    need(raw.startswith(b"<") or raw.startswith(b"\xef\xbb\xbf<"),
         "Only UTF-8 XML parts support source-preserving cell replacement.")
    declaration = re.match(br'(?:\xef\xbb\xbf)?<\?xml[^?]*\?>', raw)
    if declaration:
        encoding = re.search(br'encoding\s*=\s*["\']([^"\']+)', declaration[0], re.I)
        need(not encoding or encoding[1].lower() in (b"utf-8", b"utf8"),
             "Keep this original XML encoding; provide a UTF-8 workbook edition for cell returns.")
    h.xml_document(raw, "Original worksheet")
    parser = expat.ParserCreate(namespace_separator="|")
    stack, result = [], []
    def start(name, attrs):
        index = parser.CurrentByteIndex
        end = token_end(raw, index)
        stack.append((name, attrs, index, end, raw[index:end].rstrip().endswith(b"/>")))
    def finish(name):
        original, attrs, start_at, opening_end, empty = stack.pop()
        need(original == name, "Original XML nesting changed.")
        if name.startswith(main + "|") and name.split("|")[-1] in selected:
            end = opening_end if empty else token_end(raw, parser.CurrentByteIndex)
            result.append({"kind": name.split("|")[-1], "attrs": attrs,
                           "start": start_at, "open_end": opening_end, "end": end})
    parser.StartElementHandler = start
    parser.EndElementHandler = finish
    parser.ExternalEntityRefHandler = lambda *args: 0
    parser.Parse(raw, True)
    return result



def xml_bool(node, name, default=False):
    if not node.hasAttribute(name):
        return default
    value = node.getAttribute(name)
    need(value in ("true", "false", "1", "0"), "Original XML boolean is invalid.")
    return value in ("true", "1")


def _styles(originals, rels, bookpath, main):
    targets = [r for r in rels if r.getAttribute("Type").endswith("/styles")]
    need(len(targets) <= 1, "Original workbook has multiple style tables.")
    if not targets:
        return [True]
    rel = targets[0]
    need(rel.getAttribute("TargetMode") != "External", "Original cell styles must be internal.")
    name = h.target_path(bookpath, rel.getAttribute("Target"))
    need(name in originals, "Original styles are missing.")
    doc = h.xml_document(originals[name], "Original styles")
    bases = h.children(doc.documentElement, "cellStyleXfs", main)
    cells = h.children(doc.documentElement, "cellXfs", main)
    need(len(bases) <= 1 and len(cells) <= 1, "Original styles repeat their format table.")
    base_xfs = h.children(bases[0], "xf", main) if bases else []
    cell_xfs = h.children(cells[0], "xf", main) if cells else []
    def locked(node, fallback):
        choices = h.children(node, "protection", main)
        need(len(choices) <= 1, "Original cell format repeats protection.")
        if node.hasAttribute("applyProtection") and not xml_bool(node, "applyProtection"):
            return fallback
        if choices:
            return xml_bool(choices[0], "locked", True)
        return fallback
    result = []
    for node in cell_xfs:
        base = True
        if node.hasAttribute("xfId"):
            index = node.getAttribute("xfId")
            need(index.isdigit() and int(index) < len(base_xfs), "Original base style index is invalid.")
            base = locked(base_xfs[int(index)], True)
        result.append(locked(node, base))
    return result or [True]


def without_attributes(tag, names):
    # Scan complete lexical attributes so a quoted value containing ' t=' is
    # never mistaken for the cell type attribute.
    expression = br"\s+([A-Za-z_:][A-Za-z0-9_.:\-]*)\s*=\s*(?:\"[^\"]*\"|'[^']*')"
    ranges = [(m.start(), m.end()) for m in re.finditer(expression, tag) if m[1] in names]
    for start, end in reversed(ranges):
        tag = tag[:start] + tag[end:]
    return tag


def _parts(original):
    need(isinstance(original, bytes) and len(original) <= MAX_ORIGINAL,
         "Select a complete original XLSX/XLSM no larger than 128 MiB.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(original))
    except (zipfile.BadZipFile, OSError) as exc:
        raise h.WorkbookError("Select an unencrypted complete XLSX/XLSM workbook.") from exc
    with archive:
        infos, originals, total = archive.infolist(), {}, 0
        need(len(infos) <= 65535, "Original package has too many members.")
        for info in infos:
            h.member_path(info.filename.rstrip("/") if info.is_dir() else info.filename)
            need(info.filename not in originals and not info.flag_bits & 1,
                 "Original package has a duplicate or encrypted member.")
            need(info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                 "Use original stored/DEFLATE package members.")
            mode = info.external_attr >> 16
            need(mode & 0o170000 != 0o120000, "Workbook members must not be symbolic links.")
            total += info.file_size
            need(total <= h.MAX_EXPANDED, "Original expanded workbook exceeds 512 MiB.")
            originals[info.filename] = archive.read(info)
        comment = archive.comment
    need("[Content_Types].xml" in originals and "_rels/.rels" in originals,
         "Original package catalogs are missing.")
    roots = h.xml_document(originals["_rels/.rels"], "Original package relationships")
    need(roots.documentElement.namespaceURI == h.NS_PACKAGE, "Unknown package relationship namespace.")
    relations = h.children(roots.documentElement, "Relationship", h.NS_PACKAGE)
    office = [x for x in relations if x.getAttribute("Type") in {n + "/officeDocument" for n in h.NS_REL}]
    need(len(office) == 1 and office[0].getAttribute("TargetMode") != "External",
         "Select one original internal workbook.")
    bookpath = h.target_path("", office[0].getAttribute("Target"))
    need(bookpath in originals, "Original workbook part is missing.")
    directory = str(Path(bookpath).parent).replace("\\", "/")
    relpath = (directory + "/" if directory != "." else "") + "_rels/" + Path(bookpath).name + ".rels"
    need(relpath in originals, "Original workbook relationships are missing.")
    book = h.xml_document(originals[bookpath], "Original workbook")
    main = book.documentElement.namespaceURI
    need(main in MAIN, "Unsupported original workbook namespace.")
    relationships = h.xml_document(originals[relpath], "Workbook relationships")
    rels = h.children(relationships.documentElement, "Relationship", h.NS_PACKAGE)
    by_id = {x.getAttribute("Id"): x for x in rels}
    need(len(by_id) == len(rels), "Original workbook has duplicate relationship IDs.")
    types = h.xml_document(originals["[Content_Types].xml"], "Content types")
    need(types.documentElement.namespaceURI == h.NS_TYPES, "Unknown original content types.")
    type_rows = h.children(types.documentElement, "Override", h.NS_TYPES)
    kinds = [x.getAttribute("ContentType") for x in type_rows if h.unquote(x.getAttribute("PartName")).lstrip("/") == bookpath]
    need(len(kinds) == 1 and kinds[0] in h.MAIN_TYPES, "Use an original XLSX or XLSM workbook.")
    signed = (any(n.lower().startswith("_xmlsignatures/") for n in originals) or
              any("/digital-signature/" in r.getAttribute("Type") for r in relations) or
              any("digital-signature" in r.getAttribute("ContentType") for r in type_rows))
    locked = any(x.getAttribute("lockStructure").lower() in ("1", "true") for x in
                 h.children(book.documentElement, "workbookProtection", main))
    sheets_nodes = h.children(book.documentElement, "sheets", main)
    need(len(sheets_nodes) == 1, "Original worksheet catalog is incomplete.")
    sheets = []
    used = set()
    for node in h.children(sheets_nodes[0], "sheet", main):
        name = node.getAttribute("name")
        need(name and name.casefold() not in used, "Original worksheet names are not distinct.")
        used.add(name.casefold())
        rid = next((node.getAttributeNS(ns, "id") for ns in h.NS_REL if node.hasAttributeNS(ns, "id")), "")
        rel = by_id.get(rid)
        need(rel is not None, "Original worksheet relationship is missing.")
        if not rel.getAttribute("Type").endswith("/worksheet"):
            continue
        need(rel.getAttribute("TargetMode") != "External", "Original worksheet must be internal.")
        path = h.target_path(bookpath, rel.getAttribute("Target"))
        need(path in originals, "Original worksheet member is missing.")
        need(not any(x["part"] == path for x in sheets), "Original worksheets share an ambiguous XML part.")
        sheets.append({"name": name, "part": path, "state": node.getAttribute("state") or "visible"})
    shared = []
    for rel in rels:
        if rel.getAttribute("Type").endswith("/sharedStrings"):
            need(rel.getAttribute("TargetMode") != "External", "Original shared strings must be internal.")
            path = h.target_path(bookpath, rel.getAttribute("Target"))
            need(path in originals, "Original shared strings are missing.")
            doc = h.xml_document(originals[path], "Shared strings")
            shared = [rich_text(x, main) for x in h.children(doc.documentElement, "si", main)]
    return {"originals": originals, "infos": infos, "comment": comment, "bookpath": bookpath,
            "main": main, "sheets": sheets, "shared": shared, "extension": h.MAIN_TYPES[kinds[0]],
            "signed": signed, "structure_protected": locked, "styles_locked": _styles(originals, rels, bookpath, main),
            "sha256": h.sha(original), "bytes": len(original)}


def _sheet(package, sheet):
    source = next((x for x in package["sheets"] if x["name"] == sheet), None)
    need(source is not None, "Choose an actual original worksheet.")
    raw, main = package["originals"][source["part"]], package["main"]
    doc = h.xml_document(raw, "Original worksheet")
    need(doc.documentElement.namespaceURI == main and doc.documentElement.localName == "worksheet",
         "Original worksheet namespace changed.")
    protections = h.children(doc.documentElement, "sheetProtection", main)
    need(len(protections) <= 1, "Original worksheet repeats protection.")
    sheet_protected = bool(protections and xml_bool(protections[0], "sheet", False))
    columns = [x for holder in h.children(doc.documentElement, "cols", main) for x in h.children(holder, "col", main)]
    ranges = []
    for holder in h.children(doc.documentElement, "mergeCells", main):
        for item in h.children(holder, "mergeCell", main):
            pieces = item.getAttribute("ref").split(":")
            need(len(pieces) in (1, 2), "Original merged-cell range is malformed.")
            start = coordinates(pieces[0]); end = coordinates(pieces[-1])
            need(start[0] <= end[0] and start[1] <= end[1], "Original merged-cell range is reversed.")
            ranges.append((start, end))
    cell_spans = [x for x in spans(raw, main) if x["kind"] == "c"]
    need(len(cell_spans) <= MAX_CELLS, "Original worksheet exceeds the complete cell reader capacity.")
    records, by_cell = [], {}
    formula_ranges = []
    for formula in doc.getElementsByTagNameNS(main, "f"):
        if formula.hasAttribute("ref") and formula.getAttribute("t") in ("array", "dataTable"):
            bound = formula.getAttribute("ref").split(":")
            need(len(bound) in (1, 2), "Original formula range is unsupported.")
            formula_ranges.append((coordinates(bound[0]), coordinates(bound[-1])))
    elements = {x.getAttribute("r"): x for x in doc.getElementsByTagNameNS(main, "c")}
    need(len(elements) == len(cell_spans), "Original worksheet repeats a physical cell address.")
    for item in cell_spans:
        address = item["attrs"].get("r")
        row, col = coordinates(address)
        need(address not in by_cell, "Original worksheet repeats a physical cell address.")
        # Wrap only for namespace context; original lexical cell bytes remain retained.
        fragment = raw[item["start"]:item["end"]]
        # A full DOM cell uses the original document namespace context.
        element = elements.get(address)
        need(element is not None, "Original cell XML and lexical positions differ.")
        formula_nodes = h.children(element, "f", main)
        value_nodes = h.children(element, "v", main)
        inline_nodes = h.children(element, "is", main)
        need(len(formula_nodes) <= 1 and len(value_nodes) <= 1 and len(inline_nodes) <= 1,
             "Original cell has repeated value/formula elements.")
        token = text_content(value_nodes[0]) if value_nodes else None
        kind = element.getAttribute("t") or "n"
        if kind == "s" and token is not None:
            need(token.isdigit() and int(token) < len(package["shared"]), "Original shared-string index is invalid.")
            value = package["shared"][int(token)]
        elif kind == "inlineStr":
            value = rich_text(inline_nodes[0], main) if inline_nodes else ""
        else:
            value = literal(token) if token is not None else None
        formula = text_content(formula_nodes[0]) if formula_nodes else None
        formula_range = any(a[0] <= row <= b[0] and a[1] <= col <= b[1] for a, b in formula_ranges)
        parent = element.parentNode
        need(parent.localName == "row" and parent.namespaceURI == main and parent.parentNode.localName == "sheetData",
             "Original cell is outside its worksheet row data.")
        style = element.getAttribute("s")
        style_origin = "cell"
        if not style and xml_bool(parent, "customFormat", False):
            style = parent.getAttribute("s"); style_origin = "row"
        if not style:
            matching = [x for x in columns if x.hasAttribute("style") and int(x.getAttribute("min")) <= col <= int(x.getAttribute("max"))]
            need(len(matching) <= 1, "Original column style is ambiguous.")
            if matching: style = matching[0].getAttribute("style"); style_origin = "column"
        style = style or "0"
        need(style.isdigit() and int(style) < len(package["styles_locked"]), "Original cell style index is invalid.")
        locked = package["styles_locked"][int(style)]
        protected = sheet_protected and locked
        merged = any(a[0] <= row <= b[0] and a[1] <= col <= b[1] for a, b in ranges)
        issues = []
        if package["signed"]: issues.append("SIGNED_WORKBOOK")
        if protected: issues.append("SHEET_PROTECTED")
        if formula_nodes or formula_range: issues.append("FORMULA_CELL")
        if element.hasAttribute("cm") or element.hasAttribute("vm"): issues.append("EXTENDED_CELL_METADATA")
        if merged: issues.append("MERGED_CELL")
        if any(x.nodeType == x.ELEMENT_NODE and (x.namespaceURI != main or x.localName not in {"v", "is", "f"})
               for x in element.childNodes): issues.append("EXTENDED_CELL_CONTENT")
        record = {"sheet": sheet, "cell": address, "row": row, "column": col, "value": value,
                  "type": kind, "formula": formula, "formula_attributes": h.attributes(formula_nodes[0]) if formula_nodes else {},
                  "style": element.getAttribute("s") or None, "effective_style": style, "style_origin": style_origin,
                  "sheet_protected": sheet_protected, "locked": locked, "protected": protected, "merged": merged,
                  "selectable": not issues, "issues": issues, "original_cell_sha256": h.sha(fragment)}
        records.append(record); by_cell[address] = (record, item)
    records.sort(key=lambda x: (x["row"], x["column"]))
    return source, records, by_cell


def inspect(original, *, sheet=None, offset=0, limit=100):
    need(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 500,
         "Choose a valid original-cell page.")
    package = _parts(original)
    roster = []
    selected_rows = []
    for item in package["sheets"]:
        if sheet is None or item["name"] == sheet:
            _, rows, _ = _sheet(package, item["name"])
            roster.append({**item, "cell_count": len(rows)})
            if item["name"] == sheet: selected_rows = rows
        else:
            roster.append(dict(item))
    if sheet is not None:
        need(any(s["name"] == sheet for s in roster), "Choose an original worksheet.")
    return {"sha256": package["sha256"], "bytes": package["bytes"], "extension": package["extension"],
            "signed": package["signed"], "structure_protected": package["structure_protected"],
            "sheets": roster, "sheet": sheet, "cells": selected_rows[offset:offset+limit],
            "total": len(selected_rows), "offset": offset, "limit": limit,
            "next_offset": offset+limit if offset+limit < len(selected_rows) else None,
            "formulas_evaluated": False, "external_links_evaluated": False}


def cell_records(original, targets):
    package = _parts(original)
    result = {}
    for sheet in dict.fromkeys(item["sheet"] for item in targets):
        _, _, by_cell = _sheet(package, sheet)
        for target in [x for x in targets if x["sheet"] == sheet]:
            address = target["cell"]
            coordinates(address)
            need(address in by_cell, "Select an existing original physical cell: " + sheet + "!" + address)
            result[(sheet, address)] = by_cell[address][0]
    return result


def _opening(raw, kind):
    end = token_end(raw, 0)
    opening = raw[:end]
    opening = without_attributes(opening, {b"t"})
    opening = re.sub(br'\s*/?>$', b"", opening) + b' t="' + kind.encode("ascii") + b'">'
    name = re.match(br'<([^\s/>]+)', opening)[1]
    return opening, name


def render(original, changes, *, existing=None):
    package = _parts(original)
    need(changes and not package["signed"],
         "Select changed cells in an unsigned original workbook.")
    seen, replacements = set(), {}
    for sheet in dict.fromkeys(row["sheet"] for row in changes):
        source, _, by_cell = _sheet(package, sheet)
        raw = package["originals"][source["part"]]
        edits = []
        for change in [x for x in changes if x["sheet"] == sheet]:
            key = (sheet, change["cell"])
            need(key not in seen, "A destination cell may be assigned only once.")
            seen.add(key)
            need(change["cell"] in by_cell, "Mapped original cell is absent.")
            record, position = by_cell[change["cell"]]
            need(record["selectable"] and record["original_cell_sha256"] == change["original_cell_sha256"],
                 "Mapped original formula/protection/cell bytes changed.")
            value = change["value"]
            need(isinstance(value, str), "Retain the complete saved profile value as text.")
            numeric = change.get("cell_type") == "number"
            need(change.get("cell_type") in ("number", "text", "blank", "boolean"), "Retain the native field type.")
            if numeric: need(bool(NUMBER.fullmatch(value)), "Saved numeric value is not a complete numeric token.")
            if numeric:
                try: numeric = Decimal(value).is_finite()
                except InvalidOperation: numeric = False
            fragment = raw[position["start"]:position["end"]]
            opening, name = _opening(fragment, "n" if numeric else "b" if change["cell_type"] == "boolean" else "inlineStr")
            prefix = name.rsplit(b":", 1)[0] + b":" if b":" in name else b""
            if numeric or change["cell_type"] == "boolean":
                if change["cell_type"] == "boolean":
                    need(value in ("true", "false"), "Retain the native boolean value.")
                    value = "1" if value == "true" else "0"
                body = b"<" + prefix + b"v>" + value.encode("ascii") + b"</" + prefix + b"v>"
            else:
                body = (b"<" + prefix + b'is><' + prefix + b't xml:space="preserve">' +
                        h.sheet_text(value).encode("utf-8") + b"</" + prefix + b"t></" + prefix + b"is>")
            replacement = opening + body + b"</" + name + b">"
            if change["cell_type"] == "blank":
                replacement = re.sub(br"\s*/?>$", b"", without_attributes(fragment[:token_end(fragment, 0)], {b"t"})) + b"/>"
            edits.append((position["start"], position["end"], replacement))
        for start, end, replacement in sorted(edits, reverse=True):
            raw = raw[:start] + replacement + raw[end:]
        replacements[source["part"]] = raw
    # Request recipient spreadsheet recalculation; never claim it occurred here.
    bookraw = package["originals"][package["bookpath"]]
    nodes = [x for x in spans(bookraw, package["main"], ("calcPr",)) if x["kind"] == "calcPr"]
    need(len(nodes) <= 1, "Original workbook repeats its calculation settings.")
    if nodes:
        node = nodes[0]; tag = bookraw[node["start"]:node["end"]]
        opening_end = token_end(tag, 0)
        opening = without_attributes(tag[:opening_end], {b"fullCalcOnLoad", b"forceFullCalc"})
        ending = b"/>" if opening.rstrip().endswith(b"/>") else b">"
        opening = re.sub(br"\s*/?>$", b"", opening) + b' fullCalcOnLoad="1" forceFullCalc="1"' + ending
        tag = opening + tag[opening_end:]
        replacements[package["bookpath"]] = bookraw[:node["start"]] + tag + bookraw[node["end"]:]
    # If no calcPr was declared, do not invent element ordering in a custom
    # workbook. The report explicitly requires recipient recalculation.
    if existing is None:
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as dst:
            for info in package["infos"]:
                retained = copy(info); retained.compress_type = zipfile.ZIP_DEFLATED; retained.extra = b""
                dst.writestr(retained, replacements.get(info.filename, package["originals"][info.filename]))
            dst.comment = package["comment"]
        result = output.getvalue()
    else:
        need(isinstance(existing, bytes) and len(existing) <= h.MAX_EXPANDED,
             "The first completed derived workbook exceeds its retained capacity.")
        result = existing
    with zipfile.ZipFile(io.BytesIO(result)) as verify:
        need(verify.comment == package["comment"], "The first derived workbook package comment differs.")
        need(verify.namelist() == [x.filename for x in package["infos"]], "Derived workbook member order changed.")
        for info in verify.infolist():
            need(not info.flag_bits & 1 and info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                 "The first derived workbook uses an unsupported member encoding.")
            expected = replacements.get(info.filename, package["originals"][info.filename])
            need(info.file_size == len(expected), "A derived workbook member has the wrong full size.")
        for name, original_part in package["originals"].items():
            need(verify.read(name) == replacements.get(name, original_part), "Derived package member differs: " + name)
    changed = [{"path": name, "before_sha256": h.sha(package["originals"][name]),
                "after_sha256": h.sha(raw), "before_bytes": len(package["originals"][name]), "after_bytes": len(raw)}
               for name, raw in replacements.items() if raw != package["originals"][name]]
    # A second semantic read confirms every selected value and all original
    # formulas remain. Other cell bytes survive lexical replacement unchanged.
    after = cell_records(result, changes)
    for change in changes:
        row = after[(change["sheet"], change["cell"])]
        expected = (None if change["cell_type"] == "blank" else
                    ("1" if change["value"] == "true" else "0") if change["cell_type"] == "boolean" else change["value"])
        expected_type = {"number": "n", "text": "inlineStr", "boolean": "b", "blank": "n"}[change["cell_type"]]
        need(row["value"] == expected and row["type"] == expected_type,
             "Derived original-cell readback differs from the saved typed profile value.")
    return result, {"extension": package["extension"], "original_sha256": package["sha256"],
                    "sha256": h.sha(result), "bytes": len(result), "changed_parts": changed,
                    "unchanged_part_count": len(package["originals"]) - len(changed),
                    "formulas_evaluated": False, "external_links_evaluated": False,
                    "recipient_recalculation_required": True, "calculation_request_updated": bool(nodes)}
