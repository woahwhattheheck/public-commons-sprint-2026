"""Exact original OOXML workbook inspection and reviewed input population.

Pure standard library. No Excel engine, network access, macro execution, formula
evaluation, protection removal or assumed official workbook coordinates.
"""
from __future__ import annotations
import copy
import hashlib
import io
import json
import posixpath
import re
import zipfile
from decimal import Decimal, InvalidOperation
from xml.etree import ElementTree as ET
from xml.parsers import expat
from xml.sax.saxutils import escape
from migration_store import MigrationError

SCHEMA = "commons.crf-workbook/v1"
BINDINGS_SCHEMA = "commons.crf-workbook-bindings/v1"
MAX_RAW = 64 * 1024 * 1024
MAX_EXPANDED = 256 * 1024 * 1024
MAX_PART = 64 * 1024 * 1024
MAX_MEMBERS = 10000
MAX_CELLS = 1000000
MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
STRICT = "http://purl.oclc.org/ooxml/spreadsheetml/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CELL = re.compile(r"([A-Z]{1,3})([1-9][0-9]{0,6})\Z")
NUMBER = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?\Z")
HASH = re.compile(r"[a-f0-9]{64}\Z")


class WorkbookError(MigrationError):
    def __init__(self, code, message):
        super().__init__("CRF_" + code if code.startswith("WORKBOOK_") else code, message)


def require(ok, code, message):
    if not ok:
        raise WorkbookError(code, message)


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def _local(name):
    return name.rsplit("}", 1)[-1]


def _shape(value, allowed, required=()):
    require(isinstance(value, dict), "WORKBOOK_SHAPE", "Expected an explicit object.")
    require(set(value) <= set(allowed) and set(required) <= set(value),
            "WORKBOOK_SHAPE", "Unexpected or missing workbook contract members.")


def _text(value, label, maximum=2000):
    require(isinstance(value, str) and bool(value.strip()) and len(value) <= maximum,
            "WORKBOOK_TEXT", label + " must be a nonempty bounded string.")
    return value


def _boolean(value, default=False):
    if value is None:
        return default
    require(value in ("0", "1", "true", "false"), "WORKBOOK_BOOLEAN", "Invalid OOXML boolean.")
    return value in ("1", "true")


def _xml(raw, label):
    require(isinstance(raw, bytes) and len(raw) <= MAX_PART, "WORKBOOK_PART_SIZE", label)
    require(b"<!DOCTYPE" not in raw.upper() and b"<!ENTITY" not in raw.upper(),
            "WORKBOOK_XML_DECLARATION", "DTD and entity declarations are not supported.")
    try:
        return ET.fromstring(raw)
    except ET.ParseError as error:
        raise WorkbookError("WORKBOOK_XML", label + ": " + str(error)) from error


def _cell_position(ref):
    match = CELL.fullmatch(ref or "")
    require(match is not None, "WORKBOOK_CELL", "Use an explicit A1 cell address without a range.")
    col = 0
    for char in match[1]:
        col = col * 26 + ord(char) - 64
    row = int(match[2])
    require(col <= 16384 and row <= 1048576, "WORKBOOK_CELL", "Cell exceeds worksheet limits.")
    return row, col


def _range(value):
    bits = value.replace("$", "").split(":")
    require(len(bits) in (1, 2), "WORKBOOK_RANGE", "Unsupported cell range.")
    first = _cell_position(bits[0])
    last = _cell_position(bits[-1])
    require(first[0] <= last[0] and first[1] <= last[1], "WORKBOOK_RANGE", "Reversed cell range.")
    return first, last


def _contains(area, ref):
    first, last = _range(area)
    row, col = _cell_position(ref)
    return first[0] <= row <= last[0] and first[1] <= col <= last[1]



class _AreaIndex:
    """Balanced bounding boxes for original merge/formula ranges.

    Query returns every actual rectangle containing a point. Bounds prune
    disjoint rows and columns without rescanning/parsing every original range
    for every cell. Overlapping ranges remain explicit results.
    """
    def __init__(self, areas):
        items = []
        for area in areas:
            first, last = _range(area)
            items.append((first[0], first[1], last[0], last[1], area))
        self.root = self._build(items)

    @classmethod
    def _build(cls, items):
        if not items:
            return None
        bounds = (min(x[0] for x in items), min(x[1] for x in items),
                  max(x[2] for x in items), max(x[3] for x in items))
        if len(items) <= 8:
            return (bounds, items, None, None)
        row_span = max(x[0] + x[2] for x in items) - min(x[0] + x[2] for x in items)
        col_span = max(x[1] + x[3] for x in items) - min(x[1] + x[3] for x in items)
        axis = 0 if row_span >= col_span else 1
        items.sort(key=lambda x: x[axis] + x[axis + 2])
        middle = len(items) // 2
        return (bounds, None, cls._build(items[:middle]), cls._build(items[middle:]))

    def query(self, row, col):
        result, pending = [], [self.root]
        while pending:
            node = pending.pop()
            if node is None:
                continue
            bounds, items, left, right = node
            if not (bounds[0] <= row <= bounds[2] and bounds[1] <= col <= bounds[3]):
                continue
            if items is None:
                pending.extend((left, right))
            else:
                result.extend(item[4] for item in items
                              if item[0] <= row <= item[2] and item[1] <= col <= item[3])
        return sorted(result)

def _semantic(element):
    """Prefix-independent complete XML subtree, with meaningful text preserved."""
    if element is None:
        return None
    return {"tag": element.tag, "attributes": dict(sorted(element.attrib.items())),
            "text": element.text if element.text and element.text.strip() else None,
            "children": [_semantic(child) for child in element]}


def _tag_end(raw, start):
    quote = None
    for i in range(start, len(raw)):
        char = raw[i]
        if quote is not None:
            if char == quote:
                quote = None
        elif char in (34, 39):
            quote = char
        elif char == 62:
            return i + 1
    raise WorkbookError("WORKBOOK_XML_SPAN", "Unterminated original XML tag.")


def _cell_spans(raw, namespace):
    """Expat byte offsets avoid replacing text that merely resembles XML tags."""
    require(not raw.startswith((b"\xff\xfe", b"\xfe\xff")),
            "WORKBOOK_ENCODING", "Population supports original UTF-8 worksheet XML only.")
    declaration = re.match(br"\s*<\?xml[^>]*encoding=['\"]([^'\"]+)['\"]", raw)
    require(declaration is None or declaration[1].lower() in (b"utf-8", b"utf8"),
            "WORKBOOK_ENCODING", "Population supports original UTF-8 worksheet XML only.")
    parser = expat.ParserCreate(namespace_separator="}")
    stack, active, spans = [], [], {}
    def start(name, attrs):
        parent = stack[-1] if stack else None
        stack.append(name)
        if name == namespace + "}c" and parent == namespace + "}row":
            begin = parser.CurrentByteIndex
            opening_end = _tag_end(raw, begin)
            ref = attrs.get("r")
            _cell_position(ref)
            require(ref not in spans and not active, "WORKBOOK_CELL_DUPLICATE", "Ambiguous original cell.")
            active.append((ref, begin, opening_end, raw[begin:opening_end].rstrip().endswith(b"/>")))
    def end(name):
        if name == namespace + "}c" and active:
            ref, begin, opening_end, closed = active.pop()
            finish = opening_end if closed else _tag_end(raw, parser.CurrentByteIndex)
            spans[ref] = (begin, finish)
        stack.pop()
    parser.StartElementHandler = start
    parser.EndElementHandler = end
    try:
        parser.Parse(raw, True)
    except expat.ExpatError as error:
        raise WorkbookError("WORKBOOK_XML_SPAN", str(error)) from error
    return spans


def _xstring_decode(value):
    # One pass is essential: _x005F_x000D_ means the literal "_x000D_".
    value = re.sub(r"_x([0-9A-Fa-f]{4})_", lambda m: chr(int(m[1], 16)), value)
    try:
        return value.encode("utf-16-le", "surrogatepass").decode("utf-16-le")
    except UnicodeDecodeError as error:
        raise WorkbookError("WORKBOOK_STRING", "Unpaired UTF-16 string escape.") from error


def _xstring_encode(value):
    value = re.sub(r"_(?=x[0-9A-Fa-f]{4}_)", "_x005F_", value)
    return value.replace("\r", "_x000D_")


def _string_value(element, namespace):
    # Phonetic annotations are not the cell's displayed text.
    text = []
    for child in element:
        if child.tag == "{" + namespace + "}t":
            text.append(child.text or "")
        elif child.tag == "{" + namespace + "}r":
            text.extend(item.text or "" for item in child if item.tag == "{" + namespace + "}t")
    return _xstring_decode("".join(text))


class _Package:
    def __init__(self, raw):
        require(isinstance(raw, bytes) and 0 < len(raw) <= MAX_RAW,
                "WORKBOOK_SIZE", "Retain one complete original workbook, at most 64 MiB.")
        self.raw = raw
        try:
            self.archive = zipfile.ZipFile(io.BytesIO(raw))
            self.infos = self.archive.infolist()
        except (zipfile.BadZipFile, OSError) as error:
            raise WorkbookError("WORKBOOK_ZIP", "Use an unencrypted OOXML workbook, not XLS or OLE.") from error
        require(len(self.infos) <= MAX_MEMBERS, "WORKBOOK_MEMBERS", "Too many original package members.")
        names = [x.filename for x in self.infos]
        require(len(names) == len(set(names)), "WORKBOOK_DUPLICATE_PART", "Duplicate package member.")
        total = 0
        self.parts = {}
        for info in self.infos:
            name = info.filename
            require(not info.flag_bits & 1, "WORKBOOK_ENCRYPTED", "Encrypted ZIP members are unsupported.")
            require(not name.startswith("/") and "\\" not in name and "\x00" not in name
                    and all(x not in ("", ".", "..") for x in name.rstrip("/").split("/")),
                    "WORKBOOK_PART_PATH", "Unsafe or ambiguous package path.")
            require(info.file_size <= MAX_PART, "WORKBOOK_PART_SIZE", "Original part exceeds 64 MiB.")
            total += info.file_size
            require(total <= MAX_EXPANDED, "WORKBOOK_EXPANDED_SIZE", "Original package exceeds 256 MiB expanded.")
            try:
                self.parts[name] = self.archive.read(info)
            except (zipfile.BadZipFile, RuntimeError, OSError) as error:
                raise WorkbookError("WORKBOOK_ZIP_MEMBER", name + ": " + str(error)) from error
        require("[Content_Types].xml" in self.parts and "_rels/.rels" in self.parts,
                "WORKBOOK_PACKAGE", "Original Office package relationships are missing.")
        self.types = _xml(self.parts["[Content_Types].xml"], "content types")
        main = [x for x in self.relationships("") if x["type"].endswith("/officeDocument")
                and x["mode"] != "External"]
        require(len(main) == 1, "WORKBOOK_MAIN", "Require one original workbook relationship.")
        self.workbook_path = main[0]["part"]
        self.workbook = self.tree(self.workbook_path)
        self.namespace = self.workbook.tag.split("}")[0].lstrip("{")
        require(self.namespace in (MAIN, STRICT) and _local(self.workbook.tag) == "workbook",
                "WORKBOOK_FORMAT", "Only SpreadsheetML workbooks are supported.")
        main_type = next((x.attrib.get("ContentType") for x in self.types
                          if x.attrib.get("PartName") == "/" + self.workbook_path), "")
        formats = {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml": "xlsx",
            "application/vnd.ms-excel.sheet.macroEnabled.main+xml": "xlsm",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml": "xltx",
            "application/vnd.ms-excel.template.macroEnabled.main+xml": "xltm",
        }
        require(main_type in formats, "WORKBOOK_FORMAT", "Unsupported workbook content type.")
        self.format = formats[main_type]
        self.rels = self.relationships(self.workbook_path)
        by_id = {x["id"]: x for x in self.rels}
        require(len(by_id) == len(self.rels), "WORKBOOK_RELATIONSHIP", "Duplicate workbook relationship ID.")
        self.all_relationships = []
        for path in self.parts:
            if path.endswith(".rels") and not path.endswith("/"):
                if path == "_rels/.rels":
                    source = ""
                else:
                    directory, leaf = posixpath.split(path)
                    require(posixpath.basename(directory) == "_rels", "WORKBOOK_RELATIONSHIP", "Invalid relationship part path.")
                    source = posixpath.join(posixpath.dirname(directory), leaf[:-5])
                self.all_relationships.extend(self.relationships(source))
        self.external = [x for x in self.all_relationships if x["mode"] == "External"]
        self.macros = [p for p in self.parts if p.lower().endswith("vbaproject.bin")
                       or "/macrosheets/" in p.lower()]
        self.signatures = [p for p in self.parts if p.lower().startswith("_xmlsignatures/")]
        self.active = [p for p in self.parts if "/activex/" in p.lower() or "/embeddings/" in p.lower()]
        styles = [x for x in self.rels if x["type"].endswith("/styles") and x["mode"] != "External"]
        require(len(styles) <= 1, "WORKBOOK_STYLES", "Ambiguous style relationship.")
        self.styles = self.tree(styles[0]["part"]) if styles else None
        self.cell_xfs = list(self.styles.find(self.q("cellXfs"))) if self.styles is not None and self.styles.find(self.q("cellXfs")) is not None else []
        self.style_xfs = list(self.styles.find(self.q("cellStyleXfs"))) if self.styles is not None and self.styles.find(self.q("cellStyleXfs")) is not None else []
        strings = [x for x in self.rels if x["type"].endswith("/sharedStrings") and x["mode"] != "External"]
        require(len(strings) <= 1, "WORKBOOK_STRINGS", "Ambiguous shared strings.")
        self.strings = []
        if strings:
            for entry in self.tree(strings[0]["part"]):
                self.strings.append(_string_value(entry, self.namespace))
        self.sheets = []
        self.cells = {}
        sheet_parent = self.workbook.find(self.q("sheets"))
        require(sheet_parent is not None, "WORKBOOK_SHEETS", "Original workbook lacks sheets.")
        for sheet in sheet_parent:
            name = sheet.attrib.get("name")
            _text(name, "Sheet name", 31)
            relation_id = next((v for k, v in sheet.attrib.items() if _local(k) == "id"), None)
            relation = by_id.get(relation_id)
            require(relation is not None and relation["mode"] != "External", "WORKBOOK_SHEET", "Missing original sheet part.")
            require(not any(s["name"] == name for s in self.sheets), "WORKBOOK_SHEET", "Duplicate sheet name.")
            if not relation["type"].endswith("/worksheet"):
                self.sheets.append({"name": name, "part": relation["part"], "kind": relation["type"].rsplit("/", 1)[-1],
                                    "state": sheet.attrib.get("state", "visible"), "cells": [], "editable": False})
                continue
            self._sheet(name, relation["part"], sheet.attrib.get("state", "visible"))
        self.manifest = [{"path": p, "bytes": len(b), "sha256": sha256(b)} for p, b in sorted(self.parts.items())]

    def q(self, name):
        return "{" + self.namespace + "}" + name

    def tree(self, path):
        require(path in self.parts, "WORKBOOK_MISSING_PART", "Missing original part: " + str(path))
        return _xml(self.parts[path], path)

    def relationships(self, source):
        path = "_rels/.rels" if not source else posixpath.join(posixpath.dirname(source), "_rels", posixpath.basename(source) + ".rels")
        if path not in self.parts:
            return []
        rows = []
        seen = set()
        for relation in self.tree(path):
            require(_local(relation.tag) == "Relationship", "WORKBOOK_RELATIONSHIP", "Invalid relationship member.")
            rid = relation.attrib.get("Id")
            require(rid and rid not in seen, "WORKBOOK_RELATIONSHIP", "Ambiguous relationship ID.")
            seen.add(rid)
            target, mode = relation.attrib.get("Target", ""), relation.attrib.get("TargetMode", "Internal")
            require(mode in ("Internal", "External"), "WORKBOOK_RELATIONSHIP", "Unknown relationship mode.")
            part = None
            if mode != "External":
                require(target and "\\" not in target and "?" not in target and "#" not in target and "%" not in target,
                        "WORKBOOK_RELATIONSHIP", "Unsupported internal relationship target.")
                part = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join(posixpath.dirname(source), target))
                require(not part.startswith("../") and part != "..", "WORKBOOK_RELATIONSHIP", "Relationship escapes package.")
                require(part in self.parts, "WORKBOOK_MISSING_PART", "Missing relationship target: " + part)
            rows.append({"source": source, "id": rid, "type": relation.attrib.get("Type", ""),
                         "target": target, "mode": mode, "part": part})
        return rows

    def protection(self, style):
        if not self.cell_xfs:
            require(style == 0, "WORKBOOK_STYLE", "Invalid original style index.")
            return {"locked": True, "hidden": False}
        require(0 <= style < len(self.cell_xfs), "WORKBOOK_STYLE", "Invalid original cell style.")
        xf = self.cell_xfs[style]
        inherited = {"locked": True, "hidden": False}
        parent = int(xf.attrib.get("xfId", "0"))
        if self.style_xfs:
            require(0 <= parent < len(self.style_xfs), "WORKBOOK_STYLE", "Invalid parent style.")
            protection = self.style_xfs[parent].find(self.q("protection"))
            if protection is not None:
                inherited = {"locked": _boolean(protection.attrib.get("locked"), True),
                             "hidden": _boolean(protection.attrib.get("hidden"), False)}
        protection = xf.find(self.q("protection"))
        if protection is not None and _boolean(xf.attrib.get("applyProtection"), True):
            return {"locked": _boolean(protection.attrib.get("locked"), True),
                    "hidden": _boolean(protection.attrib.get("hidden"), False)}
        return inherited

    def value(self, cell):
        kind = cell.attrib.get("t", "n")
        value = cell.find(self.q("v"))
        text = value.text if value is not None and value.text is not None else None
        if kind == "inlineStr":
            node = cell.find(self.q("is"))
            return {"type": "text", "value": _string_value(node, self.namespace)} if node is not None else {"type": "blank"}
        if text is None:
            return {"type": "blank"}
        if kind == "s":
            require(re.fullmatch(r"[0-9]+", text) and int(text) < len(self.strings),
                    "WORKBOOK_STRING_INDEX", "Invalid shared-string reference.")
            return {"type": "text", "value": self.strings[int(text)]}
        if kind == "b":
            return {"type": "boolean", "value": _boolean(text)}
        if kind in ("str", "d", "e"):
            return {"type": {"str": "text", "d": "date", "e": "error"}[kind], "value": _xstring_decode(text) if kind == "str" else text}
        require(kind == "n", "WORKBOOK_VALUE_TYPE", "Unknown cell value type.")
        try:
            require(Decimal(text).is_finite(), "WORKBOOK_NUMBER", "Nonfinite native number.")
        except InvalidOperation as error:
            raise WorkbookError("WORKBOOK_NUMBER", "Invalid original number.") from error
        return {"type": "number", "value": text}

    def _sheet(self, name, path, state):
        raw, root = self.parts[path], self.tree(path)
        spans = _cell_spans(raw, self.namespace)
        protection_node = root.find(self.q("sheetProtection"))
        protected = protection_node is not None and _boolean(protection_node.attrib.get("sheet"), False)
        cols = []
        column_parent = root.find(self.q("cols"))
        if column_parent is not None:
            for column in column_parent:
                if "style" in column.attrib:
                    cols.append((int(column.attrib["min"]), int(column.attrib["max"]), int(column.attrib["style"])))
        merges = [x.attrib["ref"] for x in root.findall(self.q("mergeCells") + "/" + self.q("mergeCell"))]
        data = root.find(self.q("sheetData"))
        require(data is not None, "WORKBOOK_SHEET_DATA", "Missing worksheet data.")
        formula_ranges = [(cell.attrib.get("r"), formula.attrib["ref"])
                          for row in data for cell in row if cell.tag == self.q("c")
                          for formula in [cell.find(self.q("f"))]
                          if formula is not None and "ref" in formula.attrib]
        merge_index = _AreaIndex(merges)
        formula_index = _AreaIndex(area for _, area in formula_ranges)
        entries, seen = [], set()
        for row in data:
            for cell in row:
                if cell.tag != self.q("c"):
                    continue
                ref = cell.attrib.get("r")
                cell_row, col = _cell_position(ref)
                require(ref not in seen and ref in spans, "WORKBOOK_CELL_DUPLICATE", "Ambiguous worksheet cell.")
                seen.add(ref)
                column_styles = {style for lo, hi, style in cols if lo <= col <= hi}
                require(len(column_styles) <= 1, "WORKBOOK_STYLE", "Ambiguous overlapping column styles.")
                style = int(cell.attrib["s"]) if "s" in cell.attrib else int(row.attrib["s"]) if "s" in row.attrib and _boolean(row.attrib.get("customFormat")) else next(iter(column_styles), 0)
                guard = self.protection(style)
                formula = cell.find(self.q("f"))
                formula_area = formula_index.query(cell_row, col)
                areas = merge_index.query(cell_row, col)
                require(len(areas) <= 1, "WORKBOOK_MERGE", "Ambiguous merged cell.")
                merged_anchor = not areas or ref == areas[0].split(":")[0].replace("$", "")
                begin, end = spans[ref]
                value = self.value(cell)
                record = {"sheet": name, "cell": ref, "sha256": sha256(raw[begin:end]),
                          "value": value, "formula": _semantic(formula), "style": style,
                          "locked": guard["locked"], "hidden_formula": guard["hidden"],
                          "sheet_protected": protected, "effective_locked": protected and guard["locked"],
                          "merged_range": areas[0] if areas else None, "merged_anchor": merged_anchor,
                          "formula_ranges": formula_area,
                          "editable": formula is None and not formula_area and not (protected and guard["locked"]) and merged_anchor}
                self.cells[(name, ref)] = {"record": record, "element": cell, "span": (begin, end), "part": path}
                entries.append(record)
                require(len(self.cells) <= MAX_CELLS, "WORKBOOK_CELL_LIMIT", "Workbook exceeds explicit cell bound.")
        require(set(spans) == seen, "WORKBOOK_CELL_SCOPE", "Unexpected cell outside the original sheet data.")
        self.sheets.append({"name": name, "part": path, "kind": "worksheet", "state": state,
                            "editable": True, "sheet_protected": protected, "protection": _semantic(protection_node),
                            "protected_ranges": _semantic(root.find(self.q("protectedRanges"))),
                            "validation": _semantic(root.find(self.q("dataValidations"))),
                            "extensions": _semantic(root.find(self.q("extLst"))),
                            "merges": merges, "cells": entries})

    def inspection(self):
        return {"schema": SCHEMA, "sha256": sha256(self.raw), "bytes": len(self.raw), "format": self.format,
                "workbook_part": self.workbook_path,
                "sheets": [{k: v for k, v in sheet.items() if k != "cells"} for sheet in self.sheets],
                "cells": [entry["record"] for entry in self.cells.values()], "member_manifest": self.manifest,
                "macro_parts": self.macros, "embedded_active_parts": self.active,
                "signature_parts": self.signatures, "external_relationships": self.external,
                "workbook_protection": _semantic(self.workbook.find(self.q("workbookProtection"))),
                "defined_names": _semantic(self.workbook.find(self.q("definedNames"))),
                "calculation_properties": _semantic(self.workbook.find(self.q("calcPr"))),
                "calculation_executed": False, "native_recalculation_verified": False,
                "protection_meaning": "effective_locked means the original locked style on a protected worksheet; no protection is removed.",
                "limitations": ["Formula caches are retained observations, not proof of fresh calculation.",
                                "Validation definitions are preserved, not evaluated.",
                                "No macro, external link, embedded object or workbook code is executed."]}


def inspect_template(raw):
    return _Package(raw).inspection()


def _typed(value):
    _shape(value, ("type", "value"), ("type",))
    kind = value["type"]
    require(kind in ("number", "text", "boolean", "blank"), "WORKBOOK_INPUT_TYPE", "Unsupported input type.")
    require(("value" in value) == (kind != "blank"), "WORKBOOK_INPUT_TYPE", "Blank has no value; other types require one.")
    if kind == "number":
        require(isinstance(value["value"], str) and len(value["value"]) <= 1000
                and NUMBER.fullmatch(value["value"]), "WORKBOOK_INPUT_NUMBER", "Use exact plain decimal text.")
    elif kind == "text":
        text = value["value"]
        require(isinstance(text, str) and len(text) <= 32767, "WORKBOOK_INPUT_TEXT", "Excel text is limited to 32,767 characters.")
        require(all(char in "\t\n\r" or ord(char) >= 32 for char in text)
                and not any(0xD800 <= ord(char) <= 0xDFFF or ord(char) in (0xFFFE, 0xFFFF) for char in text),
                "WORKBOOK_INPUT_TEXT", "Input includes invalid XML text.")
    elif kind == "boolean":
        require(type(value["value"]) is bool, "WORKBOOK_INPUT_BOOLEAN", "Use an actual boolean.")
    return value


def validate_bindings(raw, bindings):
    package = _Package(raw)
    _shape(bindings, ("schema", "template_sha256", "format", "authority_reference", "macro_policy",
                     "external_links_policy", "inputs", "checks"),
           ("schema", "template_sha256", "format", "authority_reference", "macro_policy",
            "external_links_policy", "inputs", "checks"))
    require(bindings["schema"] == BINDINGS_SCHEMA and bindings["template_sha256"] == sha256(raw),
            "WORKBOOK_TEMPLATE_BINDING", "Binding must select the exact whole original workbook bytes.")
    require(bindings["format"] == package.format and package.format in ("xlsx", "xlsm"),
            "WORKBOOK_FORMAT", "Select the original XLSX or XLSM format; no implicit template conversion.")
    _text(bindings["authority_reference"], "Original authority template reference")
    require(bindings["macro_policy"] in ("absent", "preserve-unexecuted")
            and bindings["external_links_policy"] in ("absent", "preserve-unrefreshed"),
            "WORKBOOK_ACTIVE_POLICY", "Review original active-content and external-link preservation.")
    require(not package.macros or bindings["macro_policy"] == "preserve-unexecuted",
            "WORKBOOK_MACRO_POLICY", "Original macro parts require explicit preserve-unexecuted review.")
    require(not package.active, "WORKBOOK_EMBEDDED_ACTIVE", "Embedded active objects require the original native workflow.")
    require(not package.external or bindings["external_links_policy"] == "preserve-unrefreshed",
            "WORKBOOK_EXTERNAL_POLICY", "Original external relationships require preserve-unrefreshed review.")
    require(not package.signatures, "WORKBOOK_SIGNED_PACKAGE", "Do not invalidate a digitally signed template; use the issuer-approved input route.")
    require(isinstance(bindings["inputs"], list) and 0 < len(bindings["inputs"]) <= 10000
            and isinstance(bindings["checks"], list) and len(bindings["checks"]) <= 10000,
            "WORKBOOK_BINDING_COUNT", "Select bounded explicit input and check cells.")
    keys, coordinates = set(), set()
    for mode in ("inputs", "checks"):
        for item in bindings[mode]:
            allowed = ("key", "sheet", "cell", "value_type", "expected_cell_sha256") if mode == "inputs" else ("key", "sheet", "cell", "expected_cell_sha256", "expected")
            required = ("key", "sheet", "cell", "expected_cell_sha256") + (("value_type",) if mode == "inputs" else ())
            _shape(item, allowed, required)
            key = _text(item["key"], "Bound reporting key", 200)
            coordinate = (item["sheet"], item["cell"])
            require(key not in keys and coordinate not in coordinates, "WORKBOOK_BINDING_DUPLICATE", "Every binding needs a unique key and cell.")
            keys.add(key); coordinates.add(coordinate)
            current = package.cells.get(coordinate)
            require(current is not None, "WORKBOOK_BINDING_CELL", "Select an actual retained worksheet cell.")
            record = current["record"]
            require(item["expected_cell_sha256"] == record["sha256"],
                    "WORKBOOK_CELL_BINDING", "The original selected cell changed.")
            if mode == "inputs":
                require(record["editable"], "WORKBOOK_INPUT_PROTECTED", "Cannot replace formulas, protected locked cells or merged followers.")
                require(item["value_type"] in ("number", "text", "boolean", "blank"),
                        "WORKBOOK_INPUT_TYPE", "Select an explicit input type.")
                # Metadata/extension-bearing cells need the original native editor.
                require(set(current["element"].attrib) <= {"r", "s", "t", "ph"}
                        and all(child.tag in (package.q("v"), package.q("is")) for child in current["element"]),
                        "WORKBOOK_INPUT_STRUCTURE", "This input carries unsupported native cell metadata.")
            elif "expected" in item:
                _typed(item["expected"])
    return {"schema": BINDINGS_SCHEMA, "template_sha256": sha256(raw),
            "input_count": len(bindings["inputs"]), "check_count": len(bindings["checks"]),
            "inspection": package.inspection()}


def validate_input_values(bindings, values):
    require(isinstance(values, dict) and set(values) == {x["key"] for x in bindings["inputs"]},
            "WORKBOOK_VALUES", "Supply each reviewed input exactly once and no unbound values.")
    for item in bindings["inputs"]:
        _typed(values[item["key"]])
        require(values[item["key"]]["type"] == item["value_type"],
                "WORKBOOK_INPUT_TYPE", "Input type differs from the reviewed binding.")


def _replacement(package, current, value):
    begin, end = current["span"]
    original = package.parts[current["part"]][begin:end]
    opening_end = _tag_end(original, 0)
    opening = original[:opening_end].decode("utf-8")
    match = re.match(r"<([A-Za-z_][\w.-]*:)?c(?:\s|/|>)", opening)
    require(match is not None, "WORKBOOK_CELL_PREFIX", "Unsupported original cell QName.")
    prefix = match[1] or ""
    # Keep all original cell attributes except the value-type attribute.
    opening = re.sub(r"""\s+t\s*=\s*(?:"[^"]*"|'[^']*')""", "", opening)
    opening = re.sub(r"\s*/?>$", "", opening)
    kind = value["type"]
    if kind == "blank":
        return (opening + "/>").encode("utf-8")
    if kind == "text":
        body = "<" + prefix + 'is><' + prefix + 't xml:space="preserve">' + escape(_xstring_encode(value["value"])) + "</" + prefix + "t></" + prefix + "is>"
        opening += ' t="inlineStr">'
    else:
        opening += ' t="' + ("b" if kind == "boolean" else "n") + '">'
        body = "<" + prefix + "v>" + (("1" if value["value"] else "0") if kind == "boolean" else value["value"]) + "</" + prefix + "v>"
    return (opening + body + "</" + prefix + "c>").encode("utf-8")


def _equal_value(before, after):
    if before["type"] != after["type"]:
        return False
    if before["type"] == "number":
        return Decimal(before["value"]) == Decimal(after["value"])
    return before == after


def _population_parts(raw, bindings, values):
    validate_bindings(raw, bindings)
    validate_input_values(bindings, values)
    package = _Package(raw)
    edits, lineage = {}, []
    for item in bindings["inputs"]:
        current = package.cells[(item["sheet"], item["cell"])]
        begin, end = current["span"]
        replacement = _replacement(package, current, values[item["key"]])
        edits.setdefault(current["part"], []).append((begin, end, replacement))
        lineage.append({"key": item["key"], "sheet": item["sheet"], "cell": item["cell"],
                        "original_cell_sha256": current["record"]["sha256"],
                        "original_value": current["record"]["value"], "input": values[item["key"]]})
    changed = {}
    for path, mutations in edits.items():
        original, cursor, chunks = package.parts[path], 0, []
        for begin, end, replacement in sorted(mutations):
            require(cursor <= begin < end <= len(original), "WORKBOOK_EDIT_OVERLAP", "Selected original cell spans overlap.")
            chunks.extend((original[cursor:begin], replacement))
            cursor = end
        chunks.append(original[cursor:])
        source = b"".join(chunks)
        _xml(source, path)
        changed[path] = source
    return package, changed, lineage


def _population_description(package, changed, lineage, output, actual, bindings, values):
    require(set(actual.parts) == set(package.parts), "WORKBOOK_OUTPUT_PARTS", "Population changed original membership.")
    for path in package.parts:
        expected = changed.get(path, package.parts[path])
        require(actual.parts[path] == expected, "WORKBOOK_OUTPUT_PRESERVATION", "A populated or unselected original part differs.")
    for item in bindings["inputs"]:
        value = actual.cells[(item["sheet"], item["cell"])]["record"]["value"]
        require(value == values[item["key"]], "WORKBOOK_OUTPUT_VALUE", "Exact input readback differs.")
    return {"schema": SCHEMA + "/population", "template_sha256": sha256(package.raw),
                    "output_sha256": sha256(output), "bytes": len(output), "format": package.format,
                    "changed_parts": sorted(changed), "lineage": lineage,
                    "member_manifest": actual.manifest,
                    "native_numeric_precision_warnings": [{"key": x["key"], "value": values[x["key"]]["value"],
                        "meaning": "Exact OOXML decimal retained; native Excel precision may alter this value. Inspect the actual returned input."}
                        for x in bindings["inputs"] if values[x["key"]]["type"] == "number"
                        and len(values[x["key"]]["value"].replace("-", "").replace(".", "").lstrip("0")) > 15],
                    "calculation_executed": False,
                    "native_recalculation_verified": False, "validation_evaluated": False,
                    "note": "Only selected existing input cells changed. Formula caches remain historical; recalculate and inspect in the actual native workbook application."}


def populate_template(raw, bindings, values):
    package, changed, lineage = _population_parts(raw, bindings, values)
    destination = io.BytesIO()
    with zipfile.ZipFile(destination, "w") as archive:
        archive.comment = package.archive.comment
        for info in package.infos:
            archive.writestr(copy.copy(info), changed.get(info.filename, package.parts[info.filename]))
    output = destination.getvalue()
    return output, _population_description(package, changed, lineage, output, _Package(output), bindings, values)


def verify_population(original_raw, held_output_raw, bindings, values):
    """Verify the original held container without recompression or replacement.

    Every decompressed member must equal the original template member with only
    the exact selected cell spans replaced. Container compression bytes may vary
    by native Python/zlib version; the held container identity remains authority.
    """
    package, changed, lineage = _population_parts(original_raw, bindings, values)
    return _population_description(package, changed, lineage, held_output_raw,
                                   _Package(held_output_raw), bindings, values)


def _structure(package):
    return {"format": package.format,
            "sheets": [{"name": s["name"], "kind": s["kind"], "state": s["state"],
                        "protection": s.get("protection"), "protected_ranges": s.get("protected_ranges"),
                        "validation": s.get("validation"), "extensions": s.get("extensions"), "merges": s.get("merges")}
                       for s in package.sheets],
            "formulas": [{"sheet": key[0], "cell": key[1], "formula": value["record"]["formula"]}
                         for key, value in sorted(package.cells.items()) if value["record"]["formula"] is not None],
            "cell_protection": [{"sheet": key[0], "cell": key[1], "locked": value["record"]["locked"],
                                 "effective_locked": value["record"]["effective_locked"]}
                                for key, value in sorted(package.cells.items())],
            "defined_names": _semantic(package.workbook.find(package.q("definedNames"))),
            "workbook_protection": _semantic(package.workbook.find(package.q("workbookProtection")))}


def inspect_return(original, output, bindings, values):
    """Compare an actual externally saved return; never assert it was recalculated."""
    validate_bindings(original, bindings)
    validate_input_values(bindings, values)
    base, returned = _Package(original), _Package(output)
    source_structure, return_structure = _structure(base), _structure(returned)
    inputs = []
    for item in bindings["inputs"]:
        current = returned.cells.get((item["sheet"], item["cell"]))
        observed = current["record"]["value"] if current else None
        inputs.append({"key": item["key"], "sheet": item["sheet"], "cell": item["cell"],
                       "expected": values[item["key"]], "observed": observed,
                       "matches": bool(current and current["record"]["formula"] is None
                                       and _equal_value(values[item["key"]], observed))})
    checks = []
    for item in bindings["checks"]:
        current = returned.cells.get((item["sheet"], item["cell"]))
        observed = current["record"]["value"] if current else None
        checks.append({"key": item["key"], "sheet": item["sheet"], "cell": item["cell"],
                       "present": current is not None, "cached_value": observed,
                       "formula": current["record"]["formula"] if current else None,
                       "expected": item.get("expected"),
                       "matches_expected_cache": None if "expected" not in item else bool(current and _equal_value(item["expected"], observed)),
                       "calculation_freshness": "NOT_ESTABLISHED"})
    input_coordinates = {(item["sheet"], item["cell"]) for item in bindings["inputs"]}
    unbound_changes = []
    for coordinate in sorted(set(base.cells) | set(returned.cells)):
        if coordinate in input_coordinates:
            continue
        left = base.cells.get(coordinate)
        right = returned.cells.get(coordinate)
        a = left["record"] if left else None
        b = right["record"] if right else None
        changed_fields = [field for field in ("value", "formula", "locked", "effective_locked", "hidden_formula",
                                              "merged_range", "merged_anchor", "formula_ranges")
                          if (a.get(field) if a else None) != (b.get(field) if b else None)]
        if a is None or b is None or changed_fields:
            unbound_changes.append({"sheet": coordinate[0], "cell": coordinate[1],
                                    "change": "added" if a is None else "removed" if b is None else "changed",
                                    "changed_fields": changed_fields, "before": a, "after": b,
                                    "formula_cache_only": bool(a and b and a["formula"] is not None
                                                               and changed_fields == ["value"])})
    changes = []
    for path in sorted(set(base.parts) | set(returned.parts)):
        a, b = base.parts.get(path), returned.parts.get(path)
        if a != b:
            changes.append({"path": path, "before_sha256": sha256(a) if a is not None else None,
                            "after_sha256": sha256(b) if b is not None else None,
                            "before_bytes": len(a) if a is not None else None,
                            "after_bytes": len(b) if b is not None else None})
    structure = {key: source_structure[key] == return_structure[key] for key in source_structure}
    active_paths = set(base.macros + base.active + base.signatures + returned.macros + returned.active + returned.signatures)
    active_preserved = all(base.parts.get(p) == returned.parts.get(p) for p in active_paths)
    external_preserved = base.external == returned.external
    return {"schema": SCHEMA + "/return", "template_sha256": sha256(original),
            "return_sha256": sha256(output), "bytes": len(output), "format": returned.format,
            "inputs": inputs, "all_inputs_match": all(x["matches"] for x in inputs),
            "checks": checks, "unbound_cell_changes": unbound_changes,
            "structural_comparisons": structure, "part_changes": changes,
            "active_parts_preserved": active_preserved, "external_relationships_preserved": external_preserved,
            "calculation_properties": _semantic(returned.workbook.find(returned.q("calcPr"))),
            "validation_evidence": [{"sheet": s["name"], "definitions": s.get("validation"),
                                    "extensions": s.get("extensions")} for s in returned.sheets],
            "formula_caches": [{"sheet": key[0], "cell": key[1], "formula": value["record"]["formula"],
                                "cached_value": value["record"]["value"]}
                               for key, value in sorted(returned.cells.items()) if value["record"]["formula"] is not None],
            "member_manifest": returned.manifest, "native_recalculation_verified": False,
            "validation_evaluated": False, "dwp_acceptance": False,
            "requires_operator_review": True,
            "note": "Cached values and original validation definitions are observations only. Retain the native application's calculation, rendered checks and officer review separately."}


def binding_example():
    """Schema illustration only. Every placeholder must be replaced from inspection."""
    return {"schema": BINDINGS_SCHEMA, "template_sha256": "<actual complete template SHA-256>",
            "format": "xlsx", "authority_reference": "<actual issued workbook reference>",
            "macro_policy": "absent", "external_links_policy": "absent",
            "inputs": [{"key": "<reviewed metric or supplied contribution key>",
                        "sheet": "<actual sheet name>", "cell": "<actual A1 coordinate>",
                        "value_type": "number", "expected_cell_sha256": "<actual inspected cell SHA-256>"}],
            "checks": [{"key": "<reviewed original workbook check>", "sheet": "<actual sheet name>",
                        "cell": "<actual A1 coordinate>", "expected_cell_sha256": "<actual inspected cell SHA-256>",
                        "expected": {"type": "boolean", "value": True}}]}
