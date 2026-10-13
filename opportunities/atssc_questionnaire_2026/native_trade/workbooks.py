"""Read original XLSX editions without changing cells, formulas or workbook bytes."""
from __future__ import annotations

import hashlib
import io
import posixpath
import re
import zipfile
from xml.etree import ElementTree as ET

MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
DOC = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG = "{http://schemas.openxmlformats.org/package/2006/relationships}"
CELL = re.compile(r"^([A-Z]{1,3})([1-9][0-9]{0,6})$")


def col_number(letters):
    number = 0
    for char in letters:
        number = number * 26 + ord(char) - 64
    return number


def col_letters(number):
    result = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result


def cell_parts(address):
    match = CELL.fullmatch(address)
    if not match or col_number(match[1]) > 16384 or int(match[2]) > 1048576:
        raise ValueError("Invalid workbook cell address")
    return int(match[2]), col_number(match[1])


def range_cells(address):
    ends = address.split(":")
    if len(ends) > 2:
        raise ValueError("Invalid workbook range")
    r1, c1 = cell_parts(ends[0])
    r2, c2 = cell_parts(ends[-1])
    if r2 < r1 or c2 < c1 or (r2-r1+1)*(c2-c1+1) > 100000:
        raise ValueError("Workbook range is reversed or too large")
    return [f"{col_letters(c)}{r}" for r in range(r1, r2+1) for c in range(c1, c2+1)]


def _text(element):
    return "" if element is None else "".join(element.itertext())


def read_xlsx(data):
    if not isinstance(data, bytes) or len(data) > 64*1024*1024:
        raise ValueError("An XLSX workbook of at most 64 MiB is required")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or len(names) > 20000:
            raise ValueError("Workbook contains duplicate or excessive ZIP members")
        if sum(x.file_size for x in archive.infolist()) > 256*1024*1024:
            raise ValueError("Expanded workbook exceeds 256 MiB")
        if "xl/workbook.xml" not in names:
            raise ValueError("The original file is not an XLSX workbook")
        for name in names:
            if name.startswith("/") or ".." in name.split("/"):
                raise ValueError("Workbook contains an invalid member path")
        book = ET.fromstring(archive.read("xl/workbook.xml"))
        relations = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {}
        for relation in relations:
            if relation.get("TargetMode") == "External":
                continue
            target = relation.get("Target", "")
            targets[relation.get("Id")] = posixpath.normpath(target.lstrip("/") if target.startswith("/") else "xl/"+target)
        strings = []
        if "xl/sharedStrings.xml" in names:
            strings = ["".join(t.text or "" for t in x.iter(MAIN+"t")) for x in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        sheets = []
        for sheet in book.find(MAIN+"sheets"):
            target = targets.get(sheet.get(DOC+"id"))
            if not target or target not in names:
                raise ValueError("Workbook sheet has no retained source member")
            root = ET.fromstring(archive.read(target))
            cells = {}
            for element in root.iter(MAIN+"c"):
                address = element.get("r", "")
                cell_parts(address)
                kind = element.get("t", "n")
                raw = element.findtext(MAIN+"v")
                value = raw
                if kind == "s" and raw is not None:
                    index = int(raw)
                    if not 0 <= index < len(strings):
                        raise ValueError("Workbook shared-string index is invalid")
                    value = strings[index]
                elif kind == "inlineStr":
                    value = "".join(t.text or "" for t in element.iter(MAIN+"t"))
                elif kind == "b" and raw is not None:
                    value = raw == "1"
                formula = element.find(MAIN+"f")
                cells[address] = {"value":value,"raw":raw,"kind":kind,"style":element.get("s"),"formula":None if formula is None else {"text":formula.text or "","attributes":dict(formula.attrib)}}
            validations = []
            for validation in root.iter(MAIN+"dataValidation"):
                validations.append({**dict(validation.attrib),"formula1":validation.findtext(MAIN+"formula1"),"formula2":validation.findtext(MAIN+"formula2")})
            sheets.append({"name":sheet.get("name"),"state":sheet.get("state","visible"),"member":target,"dimension":None if root.find(MAIN+"dimension") is None else root.find(MAIN+"dimension").get("ref"),"cells":cells,"mergedRanges":[x.get("ref") for x in root.iter(MAIN+"mergeCell")],"validations":validations,"protection":None if root.find(MAIN+"sheetProtection") is None else dict(root.find(MAIN+"sheetProtection").attrib)})
        return {"schema":"atssc.workbook.v1","sha256":hashlib.sha256(data).hexdigest(),"bytes":len(data),"date1904":bool(book.find(MAIN+"workbookPr") is not None and book.find(MAIN+"workbookPr").get("date1904") in {"1","true"}),"sheets":sheets,"sheetCount":len(sheets),"cellCount":sum(len(x["cells"]) for x in sheets),"formulaCount":sum(c["formula"] is not None for x in sheets for c in x["cells"].values()),"members":len(names),"macroMembers":[n for n in names if n.lower().endswith("vbaproject.bin")],"externalLinks":[n for n in names if n.startswith("xl/externalLinks/") and n.endswith(".xml")]}


def cell_value(book, sheet, cell):
    for item in book["sheets"]:
        if item["name"] == sheet:
            return item["cells"].get(cell, {}).get("value")
    raise ValueError(f"Original worksheet is absent: {sheet}")


def workbook_diff(before, after):
    """Complete value/formula/type changes, including cleared and removed sheets."""
    left = {s["name"]:s for s in before["sheets"]}
    right = {s["name"]:s for s in after["sheets"]}
    changes = []
    structure = []
    for name in sorted(set(left)|set(right)):
        a, b = left.get(name), right.get(name)
        if a is None or b is None:
            structure.append({"sheet":name,"change":"added" if a is None else "removed"})
        elif any(a.get(k) != b.get(k) for k in ("state","mergedRanges","validations","protection")):
            structure.append({"sheet":name,"change":"sheet definition","before":{k:a.get(k) for k in ("state","mergedRanges","validations","protection")},"after":{k:b.get(k) for k in ("state","mergedRanges","validations","protection")}})
        ca, cb = (a or {}).get("cells",{}), (b or {}).get("cells",{})
        for address in sorted(set(ca)|set(cb),key=cell_parts):
            va = {k:ca.get(address,{}).get(k) for k in ("value","raw","kind","formula","style")}
            vb = {k:cb.get(address,{}).get(k) for k in ("value","raw","kind","formula","style")}
            if va != vb:
                changes.append({"sheet":name,"cell":address,"before":va,"after":vb})
    return {"schema":"atssc.workbook-diff.v1","beforeSha256":before["sha256"],"afterSha256":after["sha256"],"cellChanges":changes,"structureChanges":structure,"cellChangeCount":len(changes),"structureChangeCount":len(structure)}
