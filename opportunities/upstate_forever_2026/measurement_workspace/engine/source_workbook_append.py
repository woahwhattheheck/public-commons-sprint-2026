"""Append source-bound review sheets while retaining the original workbook parts.

The existing Measurements publisher selects and validates the original scientific
snapshot. This helper uses Python's standard ZIP/XML libraries only; it never
evaluates workbook formulas, macros, relationships or external links.
"""
from __future__ import annotations
import argparse
from copy import copy
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import sys
from urllib.parse import unquote, urlsplit
import zipfile
from xml.dom import minidom, Node

MAX_EXPANDED = 512 * 1024 * 1024
MAX_CELL = 32767
NS_MAIN = {"http://schemas.openxmlformats.org/spreadsheetml/2006/main",
           "http://purl.oclc.org/ooxml/spreadsheetml/main"}
NS_REL = {"http://schemas.openxmlformats.org/officeDocument/2006/relationships",
          "http://purl.oclc.org/ooxml/officeDocument/relationships"}
NS_PACKAGE = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_TYPES = "http://schemas.openxmlformats.org/package/2006/content-types"
MAIN_TYPES = {
 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml": ".xlsx",
 "application/vnd.ms-excel.sheet.macroEnabled.main+xml": ".xlsm",
}
FORMAT = "upper-savannah-original-workbook-review/v1"

class WorkbookError(ValueError):
    pass

def need(ok, message):
    if not ok:
        raise WorkbookError(message)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def scalar(value):
    need(value is None or isinstance(value, (str, int, float, bool)),
         "A review cell must be a complete scalar value.")
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)

def utf16_length(value):
    return len(value.encode("utf-16-le")) // 2

def sheet_text(value):
    value = scalar(value)
    need(utf16_length(value) <= MAX_CELL,
         "A complete review value exceeds Excel's 32,767-character cell capacity. "
         "Use the complete row JSON and original workbook; no value was shortened.")
    # Literal OOXML escape-looking text must be escaped before control characters.
    value = re.sub(r"_x[0-9a-fA-F]{4}_", lambda m: "_x005F_" + m.group()[1:], value)
    value = re.sub(r"[\x00-\x08\x0b-\x1f\ufffe\uffff]",
                   lambda m: "_x%04X_" % ord(m.group()), value)
    return (value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&apos;"))

def column(index):
    result = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return result

def member_path(value):
    need(isinstance(value, str) and value and not value.startswith(("/", "\\")) and
         "\\" not in value and "\x00" not in value and
         all(p not in ("", ".", "..") for p in value.split("/")),
         "The original workbook has an unsafe package member name.")
    return value

def target_path(base, target):
    parsed = urlsplit(target)
    need(not parsed.scheme and not parsed.netloc and not parsed.query and not parsed.fragment,
         "The original workbook's main package relationship must be local.")
    target = unquote(parsed.path)
    need("\\" not in target and "\x00" not in target, "Invalid workbook relationship target.")
    parts = [] if target.startswith("/") else list(PurePosixPath(base).parent.parts)
    for part in target.lstrip("/").split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            need(bool(parts), "The original workbook relationship leaves its package.")
            parts.pop()
        else:
            parts.append(part)
    return member_path("/".join(parts))

def xml_document(raw, label):
    # OOXML catalogs do not need DTDs/entities. Preserve originals, reject their
    # active use, and avoid parser resource expansion or external dependencies.
    probe = raw.replace(b"\x00", b"")
    need(not re.search(br"<!\s*(?:DOCTYPE|ENTITY)\b", probe, re.I),
         label + " contains a DTD/entity declaration; the unchanged original remains available.")
    try:
        return minidom.parseString(raw)
    except Exception as exc:
        raise WorkbookError(label + " is not a complete readable XML part.") from exc

def children(node, local, namespace=None):
    return [n for n in node.childNodes if n.nodeType == Node.ELEMENT_NODE and
            n.localName == local and (namespace is None or n.namespaceURI == namespace)]

def create_like(doc, parent, local, namespace):
    prefix = parent.prefix
    return doc.createElementNS(namespace, (prefix + ":" if prefix else "") + local)

def xml_bytes(doc):
    return doc.toxml(encoding="UTF-8")

def attributes(element):
    return {element.attributes.item(i).name: element.attributes.item(i).value
            for i in range(element.attributes.length)}

def worksheet(table, namespace):
    headers = table["headers"]
    rows = table["rows"]
    need(isinstance(headers, list) and headers and len(headers) <= 16384 and
         isinstance(rows, list), "The complete review exceeds Excel column capacity.")
    need(len(rows) + 1 <= 1048576, "The complete review exceeds one worksheet's row capacity.")
    pieces = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
              '<worksheet xmlns="' + namespace + '">',
              '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" '
              'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
              '<cols><col min="1" max="' + str(len(headers)) +
              '" width="23" customWidth="1"/></cols><sheetData>']
    for y, row in enumerate([headers] + rows, 1):
        need(isinstance(row, list) and len(row) == len(headers),
             "A review row does not match its complete column map.")
        pieces.append('<row r="' + str(y) + '">')
        for x, value in enumerate(row, 1):
            pieces.append('<c r="' + column(x) + str(y) +
                          '" t="inlineStr"><is><t xml:space="preserve">' +
                          sheet_text(value) + '</t></is></c>')
        pieces.append('</row>')
    pieces.extend(['</sheetData><autoFilter ref="A1:', column(len(headers)),
                   str(len(rows) + 1), '"/></worksheet>'])
    return "".join(pieces).encode("utf-8")

def prepare(original, spec):
    need(spec.get("format") == FORMAT and spec.get("originalSha256") == sha(original) and
         spec.get("originalBytes") == len(original), "The complete original workbook identity changed.")
    tables = spec.get("tables")
    need(isinstance(tables, list) and tables, "Select a complete source-bound workbook review.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(original))
    except (zipfile.BadZipFile, OSError) as exc:
        raise WorkbookError("The original is not an unencrypted XLSX/XLSM package. "
                            "Its exact original file remains available.") from exc
    with archive:
        infos = archive.infolist()
        need(len(infos) <= 65535, "The original workbook exceeds supported package member capacity.")
        names = set()
        total = 0
        originals = {}
        for info in infos:
            if info.is_dir():
                # Directory records are retained; they are not worksheet parts.
                member_path(info.filename.rstrip("/"))
            else:
                member_path(info.filename)
            need(info.filename not in names, "The original workbook contains a duplicate package member.")
            names.add(info.filename)
            need(not info.flag_bits & 1, "The original workbook is encrypted; keep its exact original file.")
            need(info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                 "The original workbook uses an unsupported ZIP compression method.")
            total += info.file_size
            need(total <= MAX_EXPANDED, "The expanded original workbook exceeds 512 MiB; "
                 "retain the original and complete separate review files.")
            raw = archive.read(info)
            need(len(raw) == info.file_size, "An original workbook member is incomplete.")
            originals[info.filename] = raw
        need("[Content_Types].xml" in originals and "_rels/.rels" in originals,
             "The complete original workbook package catalogs are missing.")
        need(not any(n.lower().startswith("_xmlsignatures/") for n in names),
             "This workbook is digitally signed. The original signature remains intact; "
             "use the complete separate review workbook instead of adding sheets.")
        roots = xml_document(originals["_rels/.rels"], "Original package relationships")
        need(roots.documentElement.namespaceURI == NS_PACKAGE, "Unknown workbook package relationships.")
        need(not any("/digital-signature/" in r.getAttribute("Type") for r in
                     children(roots.documentElement, "Relationship", NS_PACKAGE)),
             "This workbook has a package digital signature. Its exact original remains available.")
        office = [r for r in children(roots.documentElement, "Relationship", NS_PACKAGE)
                  if r.getAttribute("Type") in {n + "/officeDocument" for n in NS_REL}]
        need(len(office) == 1 and office[0].getAttribute("TargetMode") != "External",
             "The original package must identify one internal workbook.")
        workbook_name = target_path("", office[0].getAttribute("Target"))
        need(workbook_name in originals, "The original workbook part is missing.")
        rel_namespace = office[0].getAttribute("Type").rsplit("/", 1)[0]
        parent = str(PurePosixPath(workbook_name).parent)
        if parent == ".":
            parent = ""
        rel_name = (parent + "/" if parent else "") + "_rels/" + PurePosixPath(workbook_name).name + ".rels"
        need(rel_name in originals, "The original workbook relationships are missing.")
        workbook = xml_document(originals[workbook_name], "Original workbook")
        main = workbook.documentElement.namespaceURI
        need(main in NS_MAIN and workbook.documentElement.localName == "workbook",
             "The original workbook XML namespace is unsupported.")
        need(not any(x.getAttribute("lockStructure").lower() in ("true", "1") for x in
                     children(workbook.documentElement, "workbookProtection", main)),
             "The original workbook structure is protected. Its protection is unchanged; "
             "use the separate review workbook or an owner-provided unprotected original.")
        containers = children(workbook.documentElement, "sheets", main)
        need(len(containers) == 1, "The original worksheet catalog is incomplete.")
        sheets = containers[0]
        prior_sheets = children(sheets, "sheet", main)
        need(prior_sheets, "The original workbook contains no worksheets.")
        prior_names = [s.getAttribute("name") for s in prior_sheets]
        need(len(set(n.casefold() for n in prior_names)) == len(prior_names),
             "The original workbook repeats a worksheet name.")
        for table in tables:
            need(table.get("sourceSheet") in prior_names,
                 "The retained source worksheet is absent from the original workbook.")
        rels = xml_document(originals[rel_name], "Original workbook relationships")
        need(rels.documentElement.namespaceURI == NS_PACKAGE, "Unknown original workbook relationship namespace.")
        types = xml_document(originals["[Content_Types].xml"], "Original content types")
        need(types.documentElement.namespaceURI == NS_TYPES, "Unknown original workbook content types.")
        need(not any("digital-signature" in x.getAttribute("ContentType") for x in
                     children(types.documentElement, "Override", NS_TYPES) +
                     children(types.documentElement, "Default", NS_TYPES)),
             "This workbook has signed package content. Its exact original remains available.")
        overrides = children(types.documentElement, "Override", NS_TYPES)
        main_types = [x.getAttribute("ContentType") for x in overrides
                      if unquote(x.getAttribute("PartName")).lstrip("/") == workbook_name]
        need(len(main_types) == 1 and main_types[0] in MAIN_TYPES,
             "Select a complete XLSX or XLSM workbook; templates/binary workbooks remain unchanged.")
        suffix = MAIN_TYPES[main_types[0]]
        rel_nodes = children(rels.documentElement, "Relationship", NS_PACKAGE)
        rel_ids = {r.getAttribute("Id") for r in rel_nodes}
        need(len(rel_ids) == len(rel_nodes), "The original workbook repeats a relationship identity.")
        ids = [int(s.getAttribute("sheetId")) for s in prior_sheets if s.getAttribute("sheetId").isdigit()]
        need(len(ids) == len(prior_sheets) and len(ids) == len(set(ids)) and all(x > 0 for x in ids),
             "The original workbook sheet identities are invalid.")
        next_id = max(ids) + 1
        need(next_id + len(tables) < 2**32, "The original worksheet identity range is exhausted.")
        namespace_prefix = next((a.split(":", 1)[1] for a, v in attributes(workbook.documentElement).items()
                                 if a.startswith("xmlns:") and v == rel_namespace), None)
        if namespace_prefix is None:
            namespace_prefix = "tjlReviewRel"
            while workbook.documentElement.hasAttribute("xmlns:" + namespace_prefix):
                namespace_prefix += "_"
            workbook.documentElement.setAttribute("xmlns:" + namespace_prefix, rel_namespace)
        additions = {}
        sheet_records = []
        used = {n.casefold() for n in prior_names}
        for index, table in enumerate(tables, 1):
            base = "TJLabs Review " + str(index)
            name = base
            counter = 2
            while name.casefold() in used:
                name = base[:25] + " " + str(counter)
                counter += 1
            need(utf16_length(name) <= 31, "The review worksheet name exceeds Excel capacity.")
            used.add(name.casefold())
            part_index = index
            sheet_name = (parent + "/" if parent else "") + "worksheets/tjl-review-" + str(part_index) + ".xml"
            while sheet_name in names or sheet_name in additions:
                part_index += 1
                sheet_name = (parent + "/" if parent else "") + "worksheets/tjl-review-" + str(part_index) + ".xml"
            rid = "tjlReview" + str(index)
            while rid in rel_ids:
                rid += "_"
            rel_ids.add(rid)
            data = worksheet(table, main)
            additions[sheet_name] = data
            sheet = create_like(workbook, sheets, "sheet", main)
            sheet.setAttribute("name", name)
            sheet.setAttribute("sheetId", str(next_id))
            sheet.setAttributeNS(rel_namespace, namespace_prefix + ":id", rid)
            sheets.appendChild(sheet)
            relation = create_like(rels, rels.documentElement, "Relationship", NS_PACKAGE)
            relation.setAttribute("Id", rid)
            relation.setAttribute("Type", rel_namespace + "/worksheet")
            relation.setAttribute("Target", "worksheets/" + PurePosixPath(sheet_name).name)
            rels.documentElement.appendChild(relation)
            override = create_like(types, types.documentElement, "Override", NS_TYPES)
            override.setAttribute("PartName", "/" + sheet_name)
            override.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")
            types.documentElement.appendChild(override)
            sheet_records.append({"name": name, "part": sheet_name, "sheetId": next_id,
                                  "relationshipId": rid, "sourceSheet": table["sourceSheet"],
                                  "binding": table["binding"], "rows": len(table["rows"]),
                                  "columns": len(table["headers"]), "bytes": len(data), "sha256": sha(data)})
            next_id += 1
        replacements = {workbook_name: xml_bytes(workbook), rel_name: xml_bytes(rels),
                        "[Content_Types].xml": xml_bytes(types)}
        need(total - sum(len(originals[n]) for n in replacements) +
             sum(map(len, replacements.values())) + sum(map(len, additions.values())) <= MAX_EXPANDED,
             "The complete reviewed workbook exceeds 512 MiB. Original and separate complete review remain available.")
        part_records = [{"path": info.filename, "bytes": len(originals[info.filename]),
                         "sha256": sha(originals[info.filename]),
                         "state": "catalog_updated" if info.filename in replacements else "unchanged",
                         **({"returnedBytes": len(replacements[info.filename]),
                             "returnedSha256": sha(replacements[info.filename])} if info.filename in replacements else {})}
                        for info in infos]
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as result:
            for info in infos:
                retained = copy(info)
                retained.compress_type = zipfile.ZIP_STORED
                # ZIP container metadata is regenerated deterministically. Every
                # original part except the three declared catalogs stays exact.
                retained.extra = b""
                result.writestr(retained, replacements.get(info.filename, originals[info.filename]))
            for name, raw in additions.items():
                info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_STORED
                info.external_attr = 0o600 << 16
                result.writestr(info, raw)
            result.comment = archive.comment
        reviewed = output.getvalue()
        need(len(reviewed) <= MAX_EXPANDED, "The complete reviewed workbook exceeds 512 MiB including its package directory.")
        # The exact outgoing bytes are reopened. All prior worksheet/formula,
        # style, media, macro and external-link parts remain byte-identical.
        with zipfile.ZipFile(io.BytesIO(reviewed)) as verify:
            need(set(verify.namelist()) == names | set(additions), "The reviewed workbook inventory changed.")
            for name, raw in originals.items():
                need(verify.read(name) == replacements.get(name, raw), "An original workbook part changed unexpectedly: " + name)
            for name, raw in additions.items():
                need(verify.read(name) == raw, "A complete review worksheet changed: " + name)
        return reviewed, {"format": FORMAT, "state": "ready", "extension": suffix,
                          "originalBytes": len(original), "originalSha256": sha(original),
                          "returnedBytes": len(reviewed), "returnedSha256": sha(reviewed),
                          "originalSheets": prior_names, "sheets": sheet_records,
                          "originalParts": part_records,
                          "unchangedPartCount": len(originals) - len(replacements),
                          "updatedCatalogs": sorted(replacements),
                          "macroParts": sorted(n for n in names if n.lower().endswith("vbaproject.bin")),
                          "externalLinksEvaluated": False, "formulasEvaluated": False}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original", required=True)
    parser.add_argument("--spec", required=True)
    parser.add_argument("--output")
    args = parser.parse_args()
    original = Path(args.original).read_bytes()
    spec = json.loads(Path(args.spec).read_text("utf-8"))
    try:
        reviewed, result = prepare(original, spec)
    except WorkbookError as exc:
        result = {"format": FORMAT, "state": "original_only", "reason": str(exc),
                  "originalBytes": len(original), "originalSha256": sha(original)}
    if result["state"] == "ready" and args.output:
        with Path(args.output).open("xb") as stream:
            stream.write(reviewed)
    sys.stdout.write(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")

if __name__ == "__main__":
    main()
