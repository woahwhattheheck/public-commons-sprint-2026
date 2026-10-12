"""MIT. Decode retained Census Jam Values cells with their original workbook.

The supported 2023/2024 table bindings are explicit. Thresholds and labels come
from the matching original workbook cells, never from estimate arithmetic.
"""
import hashlib
import json
import re
import xml.etree.ElementTree as ET
import zipfile
import io

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "p": "http://schemas.openxmlformats.org/package/2006/relationships"}
BINDINGS = (
    ("B25064_001", 24, "Gross Rent"),
    ("B19013_001", 26, "Person Income, Household Income, Family Income"),
    ("B25088_002", 32, "Selected Monthly Owner Costs (With Mortgage)"),
    ("B25088_003", 33, "Selected Monthly Owner Costs (Without Mortgage)"),
    ("B25077_001", 34, "Value"),
    ("B25035_001", 35, "Year Built"),
)


def workbook_cells(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if sum(item.file_size for item in z.infolist()) > 16 * 1024 * 1024:
            raise ValueError("JAM_WORKBOOK_TOO_LARGE")
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            tree = ET.fromstring(z.read("xl/sharedStrings.xml"))
            shared = ["".join(node.itertext()) for node in tree.findall("s:si", NS)]
        workbook = ET.fromstring(z.read("xl/workbook.xml"))
        sheets = workbook.findall("s:sheets/s:sheet", NS)
        chosen = [s for s in sheets if s.attrib.get("name") == "Jam Values"]
        if len(chosen) != 1:
            raise ValueError("JAM_VALUES_SHEET_REQUIRED")
        rel_id = chosen[0].attrib["{" + NS["r"] + "}id"]
        relations = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target = next(r.attrib["Target"] for r in relations if r.attrib.get("Id") == rel_id)
        if target.startswith("/xl/"):
            member = target[1:]
        elif not target.startswith("/") and ".." not in target.split("/"):
            member = "xl/" + target
        else:
            raise ValueError("JAM_WORKBOOK_RELATION_INVALID")
        tree = ET.fromstring(z.read(member))
        cells = {}
        for cell in tree.findall(".//s:sheetData/s:row/s:c", NS):
            name = cell.attrib["r"]
            if cell.find("s:f", NS) is not None:
                raise ValueError("JAM_BOUND_FORMULA_REQUIRES_REVIEW")
            value = cell.find("s:v", NS)
            raw = "" if value is None else value.text or ""
            if cell.attrib.get("t") == "s":
                raw = shared[int(raw)]
            elif cell.attrib.get("t") == "inlineStr":
                raw = "".join(cell.find("s:is", NS).itertext())
            cells[name] = raw
    return cells, member


def normalize_workbook(data, *, year, workbook_path, source_url):
    cells, sheet_member = workbook_cells(data)
    result = {"schema": "stellar-forge.census-acs-annotations.v1", "year": year,
              "workbook_path": workbook_path, "workbook_sha256": hashlib.sha256(data).hexdigest(),
              "source_url": source_url, "sheet": "Jam Values", "sheet_member": sheet_member,
              "workbook_title_raw": cells.get("A1", ""), "bounds": []}
    # These are the releases whose original table-to-topic bindings were checked.
    # A new release still retains its workbook; its mapping is explicitly reviewed.
    if year not in (2023, 2024):
        result["mapping_status"] = "source_retained_binding_review_required"
        return result
    for indicator, row, topic in BINDINGS:
        if cells.get("A" + str(row)) != topic:
            raise ValueError("JAM_TOPIC_BINDING_CHANGED: " + indicator)
        original = {column + str(row): cells.get(column + str(row), "") for column in "ABCDEFG"}
        for meaning_column, display_column, raw_column, lower in (("B", "C", "D", True), ("E", "F", "G", False)):
            label = original[meaning_column + str(row)]
            display = original[display_column + str(row)]
            raw = original[raw_column + str(row)]
            if not re.fullmatch(r"-?[0-9]+", raw) or not re.fullmatch(r"[0-9,]+[-+]", display):
                raise ValueError("JAM_BOUND_CELL_INVALID: " + indicator)
            threshold = int(display[:-1].replace(",", ""))
            kind = ("lte" if "or earlier" in label else "lt") if lower else "gte"
            result["bounds"].append({"indicator_id": indicator, "raw": raw, "kind": kind,
                                     "value": threshold, "label": label,
                                     "cell": "Jam Values!" + raw_column + str(row),
                                     "display_cell": "Jam Values!" + display_column + str(row),
                                     "meaning_cell": "Jam Values!" + meaning_column + str(row),
                                     "source_cells": original})
    result["mapping_status"] = "original_cells_bound"
    return result
