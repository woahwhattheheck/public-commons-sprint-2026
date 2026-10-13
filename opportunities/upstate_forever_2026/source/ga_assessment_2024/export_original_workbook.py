#!/usr/bin/env python3
"""Preserve an original assessment XLSX and export every stored cell without coercion."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import tempfile
import zipfile
from xml.etree import ElementTree as ET

SCHEMA = "commons.original-workbook-cells/v1"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
    path.write_bytes(data)
    return {"path": str(path), "bytes": len(data), "sha256": digest(data)}


def local(tag):
    return tag.rsplit("}", 1)[-1]


def children(element, name):
    return [item for item in element if local(item.tag) == name]


def child(element, name):
    return next(iter(children(element, name)), None)


def text_nodes(element):
    if element is None:
        return ""
    # Phonetic guides are retained in original XML, not concatenated into the value.
    values = []
    def visit(node):
        if local(node.tag) == "rPh":
            return
        if local(node.tag) == "t":
            values.append(node.text or "")
        for nested in node:
            visit(nested)
    visit(element)
    return "".join(values)


def cell_index(address):
    match = re.fullmatch(r"([A-Za-z]+)([1-9][0-9]*)", address or "")
    if not match:
        raise ValueError("Invalid original cell address: " + repr(address))
    column = 0
    for letter in match[1].upper():
        column = column * 26 + ord(letter) - 64
    return int(match[2]), column


def column_name(column):
    result = ""
    while column:
        column, remainder = divmod(column - 1, 26)
        result = chr(65 + remainder) + result
    return result


def part_name(base, target):
    if "\\" in target or "://" in target or "?" in target or "#" in target:
        raise ValueError("Unexpected workbook relationship target: " + target)
    name = posixpath.normpath(target.lstrip("/") if target.startswith("/")
                             else posixpath.join(posixpath.dirname(base), target))
    if name == ".." or name.startswith("../") or name.startswith("/"):
        raise ValueError("Workbook relationship leaves original package: " + target)
    return name


def relationships(parts, name):
    if name not in parts:
        return []
    return [dict(item.attrib) for item in ET.fromstring(parts[name])
            if local(item.tag) == "Relationship"]


def workbook_export(original, destination, source_uri, source_reference=None):
    original = Path(original).resolve(strict=True)
    destination = Path(destination).resolve()
    raw = original.read_bytes()
    original_sha = digest(raw)
    if destination.exists():
        raise FileExistsError("Choose a new output directory; preserve the prior original export: "
                              + str(destination))
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=destination.name + ".staging-", dir=destination.parent))
    # An interrupted stage is left available with its actual exception; never overwrite inputs.
    originals = stage / "original"
    originals.mkdir()
    (originals / original.name).write_bytes(raw)
    parts = {}
    members = []
    with zipfile.ZipFile(original) as package:
        for info in package.infolist():
            if info.is_dir():
                continue
            name = info.filename
            path = PurePosixPath(name)
            if (path.is_absolute() or ".." in path.parts or "\\" in name
                    or name in parts or "\x00" in name):
                raise ValueError("Noncanonical or repeated original ZIP member: " + repr(name))
            body = package.read(info)  # Original CRC is checked by ZipFile.
            parts[name] = body
            target = stage / "package" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            members.append({"path": name, "bytes": len(body), "sha256": digest(body),
                            "crc32": "%08x" % info.CRC, "compression_method": info.compress_type,
                            "compressed_bytes": info.compress_size, "external_attr": info.external_attr})
    root_relationships = relationships(parts, "_rels/.rels")
    office = [item for item in root_relationships
              if item.get("Type", "").endswith("/officeDocument")
              and item.get("TargetMode") != "External"]
    if len(office) != 1:
        raise ValueError("Expected one original workbook officeDocument relationship")
    workbook_path = part_name("", office[0]["Target"])
    workbook = ET.fromstring(parts[workbook_path])
    relpath = posixpath.join(posixpath.dirname(workbook_path), "_rels",
                            posixpath.basename(workbook_path) + ".rels")
    relations = relationships(parts, relpath)
    relmap = {item["Id"]: item for item in relations}
    shared = []
    for relation in relations:
        if (relation.get("Type", "").endswith("/sharedStrings")
                and relation.get("TargetMode") != "External"):
            path = part_name(workbook_path, relation["Target"])
            shared = [{"index": i, "text": text_nodes(item),
                       "xml": ET.tostring(item, encoding="unicode")}
                      for i, item in enumerate(ET.fromstring(parts[path]))
                      if local(item.tag) == "si"]
    (stage / "sheets").mkdir()
    sheets = []
    sheet_parent = child(workbook, "sheets")
    if sheet_parent is None:
        raise ValueError("Original workbook has no sheets")
    for ordinal, declaration in enumerate(sheet_parent, 1):
        if local(declaration.tag) != "sheet":
            continue
        relationship_id = next((value for key, value in declaration.attrib.items()
                                if key.startswith("{") and local(key) == "id"), None)
        relation = relmap[relationship_id]
        if relation.get("TargetMode") == "External":
            raise ValueError("External original worksheet needs its own retained source")
        path = part_name(workbook_path, relation["Target"])
        tree = ET.fromstring(parts[path])
        base = {"sheet_index": ordinal, "name": declaration.attrib["name"],
                "sheet_attributes": dict(declaration.attrib), "relationship": relation,
                "part": path, "original_xml_bytes": len(parts[path]),
                "original_xml_sha256": digest(parts[path]),
                "root_attributes": dict(tree.attrib)}
        if not relation.get("Type", "").endswith("/worksheet"):
            base.update(kind=relation.get("Type"), rows=[],
                        notes=["Original non-worksheet sheet retained as its complete package member."])
        else:
            data = child(tree, "sheetData")
            parsed = []
            max_column = 0
            last_row = 0
            for row in data if data is not None else []:
                if local(row.tag) != "row":
                    continue
                row_number = int(row.attrib.get("r", last_row + 1))
                if row_number <= last_row:
                    raise ValueError("Original rows are not strictly increasing in " + path)
                last_row = row_number
                cells = {}
                last_column = 0
                for item in row:
                    if local(item.tag) != "c":
                        continue
                    address = item.attrib.get("r")
                    actual_row, column = (cell_index(address) if address
                                          else (row_number, last_column + 1))
                    if actual_row != row_number or column in cells:
                        raise ValueError("Repeated or mismatched original cell in " + path)
                    last_column = column
                    max_column = max(max_column, column)
                    value_node, formula_node = child(item, "v"), child(item, "f")
                    inline_node = child(item, "is")
                    raw_value = value_node.text if value_node is not None else None
                    kind = item.attrib.get("t", "n")
                    resolved = raw_value
                    if kind == "s" and raw_value is not None:
                        shared_index = int(raw_value)
                        if not 0 <= shared_index < len(shared):
                            raise ValueError("Original shared-string index is outside the retained table")
                        resolved = shared[shared_index]["text"]
                    elif kind == "inlineStr":
                        resolved = text_nodes(inline_node)
                    cells[column] = {
                        "address": address or column_name(column) + str(row_number),
                        "address_inferred": address is None,
                        "row_index": row_number, "column_index": column,
                        "present": True, "attributes": dict(item.attrib),
                        "type": kind, "raw_value": raw_value,
                        "has_value_element": value_node is not None,
                        "resolved_value": resolved,
                        "formula": None if formula_node is None else {
                            "text": formula_node.text, "attributes": dict(formula_node.attrib)},
                        "cached_value": raw_value if formula_node is not None else None,
                        "inline_string_xml": None if inline_node is None else ET.tostring(
                            inline_node, encoding="unicode"),
                        "cell_xml": ET.tostring(item, encoding="unicode"),
                    }
                parsed.append((row_number, dict(row.attrib), cells))
            if max_column * max(last_row, 1) > 20_000_000:
                raise ValueError("The original rectangular sheet exceeds 20 million cells; "
                                 "retain its complete XML and choose an explicit sparse export")
            row_map = {number: (attrs, cells) for number, attrs, cells in parsed}
            rows = []
            for number in range(1, last_row + 1):
                attrs, cells = row_map.get(number, ({}, {}))
                aligned = [cells.get(column, {
                    "address": column_name(column) + str(number),
                    "row_index": number, "column_index": column, "present": False,
                    "type": None, "raw_value": None, "resolved_value": None,
                    "formula": None, "cached_value": None})
                    for column in range(1, max_column + 1)]
                rows.append({"row_index": number, "present": number in row_map,
                             "attributes": attrs, "cells": aligned})
            dimension = child(tree, "dimension")
            merged = child(tree, "mergeCells")
            base.update(kind="worksheet", rows=rows, row_count=last_row,
                        column_count=max_column,
                        stored_rows=len(parsed), stored_cells=sum(len(row[2]) for row in parsed),
                        declared_dimension=None if dimension is None else dict(dimension.attrib),
                        merged_cells=[] if merged is None else [dict(item.attrib) for item in merged])
        name = "sheets/%03d.json" % ordinal
        output = write_json(stage / name, base)
        output["path"] = name
        sheets.append({key: base.get(key) for key in
                       ("sheet_index", "name", "kind", "part", "row_count",
                        "column_count", "stored_rows", "stored_cells")})
        sheets[-1]["export"] = output
    shared_output = write_json(stage / "shared-strings.json", shared)
    shared_output["path"] = "shared-strings.json"
    manifest = {
        "schema": SCHEMA, "original": {"filename": original.name, "bytes": len(raw),
            "sha256": original_sha, "source_uri": source_uri,
            "source_reference": source_reference, "path": "original/" + original.name},
        "workbook_path": workbook_path, "workbook_attributes": dict(workbook.attrib),
        "workbook_properties": [dict(item.attrib) for item in children(workbook, "workbookPr")],
        "defined_names": [{"attributes": dict(item.attrib), "text": item.text}
                          for parent in children(workbook, "definedNames") for item in parent],
        "root_relationships": root_relationships, "workbook_relationships": relations,
        "shared_strings": shared_output, "sheets": sheets, "package_members": members,
        "interpretation": [
            "Raw numeric, boolean, error and date serial values remain original strings.",
            "No formula calculation, date conversion or assessment normalization is performed.",
            "Formula text/attributes and original cached value are retained separately.",
            "Missing interior rows/cells are explicit present=false entries within the stored-cell extent.",
            "Every original ZIP member and the complete original workbook are retained unchanged.",
            "Rendered XML strings are convenience views; package member bytes are authoritative."
        ],
    }
    write_json(stage / "manifest.json", manifest)
    os.rename(stage, destination)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-uri", required=True)
    parser.add_argument("--source-reference")
    args = parser.parse_args()
    result = workbook_export(args.workbook, args.output, args.source_uri, args.source_reference)
    print(json.dumps({"schema": SCHEMA, "output": str(args.output.resolve()),
                      "original": result["original"], "sheets": result["sheets"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
