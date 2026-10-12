"""Lossless supplier intake, including original Syndigo catalogue envelopes."""
from __future__ import annotations
import csv, io, json, re, struct, zipfile
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET
from core import Problem, need, canonical, digest, gs1_check, MAX_EXPANDED

MAX_MEMBERS = 2000
MAX_ITEMS = 5000
MAX_ATTRIBUTES = 100000
csv.field_size_limit(16 * 1024 * 1024)
XML_FORBIDDEN = re.compile(br"<!\s*(DOCTYPE|ENTITY)\b", re.I)
GTIN_NAMES = {"gtin", "GTIN", "GlobalTradeItemNumber"}
ALIASES = {
    "gtin": ("gtin", "GTIN", "upc", "ean", "GlobalTradeItemNumber"),
    "provider_gln": ("provider_gln", "informationProviderGLN", "gln"),
    "name": ("name", "gtinName", "tradeItemDescription", "product_name", "descriptionShort"),
    "brand": ("brand", "brandName"),
    "description": ("description", "productDescription", "additionalTradeItemDescription"),
    "ingredients": ("ingredients", "ingredientStatement"),
    "allergens": ("allergens", "allergenStatement"),
    "net_content": ("net_content", "netContent"),
    "dimensions": ("dimensions",),
    "packaging": ("packaging", "packagingTypeCode"),
    "images": ("images", "image", "image_url", "referencedFile"),
    "nutrition": ("nutrition", "nutrient"),
}
ITEM_FIELDS = tuple(ALIASES)

def local(tag):
    return tag.rsplit("}", 1)[-1]

def xml(raw):
    need(b'\x00' not in raw and not XML_FORBIDDEN.search(raw), "XML_DECLARATION", "Use an ASCII-compatible XML encoding without entity or document type declarations.")
    try:
        return ET.fromstring(raw)
    except ET.ParseError as exc:
        raise Problem("XML_INVALID", "The original XML is not well formed.", details={"error": str(exc)}) from exc

def children(node, name):
    return [x for x in node if local(x.tag) == name]

def child(node, name):
    return next(iter(children(node, name)), None)

def val(node, name, default=""):
    if node is None:
        return default
    selected = child(node, name)
    return (selected.text or "").strip() if selected is not None else default

def leaves(root):
    rows = []
    def walk(node, path, inherited_name=None, ancestors=(), depth=0):
        need(depth <= 256, "XML_DEPTH", "The original XML exceeds the supported nesting depth.")
        need(len(rows) < MAX_ATTRIBUTES, "ATTRIBUTE_LIMIT", "This source exceeds the supported attribute count.")
        nodes = list(node)
        native_name = node.attrib.get("name") or inherited_name or local(node.tag)
        if node.attrib or node.text is not None and node.text.strip() or not nodes:
            rows.append({"path": path, "name": native_name,
                         "tag": local(node.tag), "namespace": node.tag.split("}")[0][1:] if "}" in node.tag else "",
                         "qualifiers": dict(node.attrib), "ancestor_qualifiers": list(ancestors),
                         "value": node.text if node.text and node.text.strip() else None if nodes else node.text or ""})
        counters = {}
        for item in nodes:
            name = local(item.tag)
            counters[name] = counters.get(name, 0) + 1
            qualifier = "[" + str(counters[name]) + "]"
            inherited = node.attrib.get("name") or inherited_name
            lineage = ancestors + ({"path": path, "attributes": dict(node.attrib)},) if node.attrib else ancestors
            walk(item, path + "/" + name + qualifier, inherited, lineage, depth + 1)
    walk(root, "/" + local(root.tag) + "[1]")
    return rows

def first_native(attrs, names):
    selected = next((r for name in names for r in attrs if (r["name"] == name or r["tag"] == name) and isinstance(r["value"], str) and r["value"].strip()), None)
    return selected["value"].strip() if selected else ""

def canonical_item(row, *, attrs=None, source=None):
    need(isinstance(row, dict), "ITEM_SHAPE", "Each supplier item must be an object.")
    attrs = attrs if attrs is not None else [
        {"path": "/" + str(k), "name": str(k), "tag": "field", "namespace": "",
         "qualifiers": {}, "value": v} for k, v in row.items()]
    value = {}
    for name, names in ALIASES.items():
        selected = next((row[n] for n in names if n in row), None)
        value[name] = selected if selected is not None else first_native(attrs, names)
    for name in ("gtin", "provider_gln"):
        selected = value[name]
        # Numeric spreadsheet or JSON identifiers must not silently lose leading zeroes.
        if selected is None:
            selected = ""
        value[name] = selected if isinstance(selected, str) else str(selected)
    value["identifier_type"] = row.get("identifier_type", "gtin")
    value["identifier"] = value["gtin"] if value["identifier_type"] == "gtin" else row.get("identifier", row.get("supplier_item_code", ""))
    value["identifier_namespace"] = "GS1 GTIN" if value["identifier_type"] == "gtin" else row.get("identifier_namespace", "")
    value["identifier_note"] = row.get("identifier_note", "")
    value["key"] = (value["provider_gln"] + ":" + value["gtin"] if value["identifier_type"] == "gtin" else
                    value["provider_gln"] + ":supplier:" + canonical([value["identifier_namespace"], value["identifier"]]).decode())
    value["attributes"], value["source"] = attrs, source or {}
    value["source"]["identifier_types"] = {
        name: type(next((row[n] for n in names if n in row), "")).__name__
        for name, names in ALIASES.items() if name in ("gtin", "provider_gln")}
    for name in ("images", "nutrition", "dimensions"):
        if value[name] == "":
            value[name] = []
    return value

def parse_xml(raw, member):
    root = xml(raw)
    kind = local(root.tag)
    items, observations = [], []
    header = child(root, "header")
    message_id = val(header, "messageId")
    docs = [d for d in root.iter() if local(d.tag) == "document"]
    for document in docs:
        item = child(document, "item")
        if item is None:
            continue
        attrs = leaves(item)
        row = {n: val(item, n) for n in ("gtin", "informationProviderGLN")}
        row["name"] = first_native(attrs, ALIASES["name"])
        provenance = {"member": member, "message_id": message_id,
                      "document_id": val(document, "documentId"),
                      "operation": val(item, "operation"),
                      "root_namespace": root.tag.split("}")[0][1:] if "}" in root.tag else "",
                      "target_markets": [val(t, "targetMarket") for t in children(item, "targetMarketAttributes")]}
        items.append(canonical_item(row, attrs=attrs, source=provenance))
        need(len(items) <= MAX_ITEMS, "ITEM_LIMIT", "The source exceeds 5,000 item editions.")
    # Standard GDSN catalogue notifications retain their complete namespaced tradeItem content.
    if not items:
        for item in [n for n in root.iter() if local(n.tag) == "tradeItem" and child(n, "gtin") is not None]:
            attrs = leaves(item)
            items.append(canonical_item({}, attrs=attrs, source={"member": member, "message_id": message_id,
                "operation": "catalogueItemNotification", "root_namespace": root.tag.split("}")[0][1:] if "}" in root.tag else ""}))
            need(len(items) <= MAX_ITEMS, "ITEM_LIMIT", "The source exceeds 5,000 item editions.")
    for response in [n for n in root.iter() if local(n.tag) in ("catalogueResponse", "catalogueItemConfirmation")]:
        rh = child(response, "header")
        rid = val(rh, "originatingMessageId")
        errors = [n for n in response.iter() if local(n.tag) in ("documentAcknowledgement", "documentException", "exception", "error")]
        if not errors:
            errors = [response]
        for error in errors:
            descriptions = [{"code": n.attrib.get("code", ""), "text": (n.text or "").strip()}
                            for n in error.iter() if local(n.tag) == "description"]
            observations.append({"kind": "native_response", "native_status": local(error.tag), "member": member,
                "originating_message_id": rid, "originating_document_id": val(error, "originatingDocumentId"),
                "gtins": [(n.text or "").strip() for n in error.iter() if local(n.tag) in GTIN_NAMES],
                "descriptions": descriptions, "attributes": leaves(error), "matched": False,
                "meaning": "Retained original response; matching requires its exact source identities."})
    if not items and not observations:
        observations.append({"kind": "native_message", "member": member, "root": kind,
            "message_id": message_id, "attributes": leaves(root), "matched": False,
            "meaning": "Original publication, link, schema, or other XML retained for source review."})
    return items, observations, {"root": kind, "namespace": root.tag.split("}")[0][1:] if "}" in root.tag else "",
                                "message_id": message_id}

def zip_members(raw):
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as exc:
        raise Problem("ZIP_INVALID", "The source ZIP is incomplete or invalid.") from exc
    infos = archive.infolist()
    need(len(infos) <= MAX_MEMBERS, "ZIP_MEMBERS", "The archive contains too many members.")
    seen, expanded = set(), 0
    selected = []
    for info in infos:
        name = info.filename
        pure = PurePosixPath(name)
        need(name not in seen and not pure.is_absolute() and ".." not in pure.parts and
             "\\" not in name and "\x00" not in name and not (info.flag_bits & 1) and
             ((info.external_attr >> 16) & 0o170000) != 0o120000,
             "ZIP_MEMBER", "The source has an unsafe, duplicate, encrypted, or linked member.", details={"member": name})
        seen.add(name)
        expanded += info.file_size
        need(expanded <= MAX_EXPANDED, "ZIP_EXPANSION", "The expanded source exceeds 96 MiB.")
        if not info.is_dir():
            selected.append(info)
    return archive, selected

def parse_xlsx(raw, filename):
    archive, infos = zip_members(raw)
    names = {i.filename for i in infos}
    need("xl/workbook.xml" in names and "xl/_rels/workbook.xml.rels" in names,
         "XLSX_INVALID", "A complete XLSX workbook is required.")
    with archive:
        strings = []
        if "xl/sharedStrings.xml" in names:
            strings = ["".join(n.text or "" for n in si.iter() if local(n.tag) == "t")
                       for si in xml(archive.read("xl/sharedStrings.xml"))]
        rels = {r.attrib.get("Id"): r.attrib.get("Target") for r in xml(archive.read("xl/_rels/workbook.xml.rels"))
                if r.attrib.get("TargetMode") != "External"}
        items, observations, sheets = [], [], []
        for sheet in [n for n in xml(archive.read("xl/workbook.xml")).iter() if local(n.tag) == "sheet"]:
            rid = next((v for k, v in sheet.attrib.items() if local(k) == "id"), None)
            target = rels.get(rid, "")
            path = "xl/" + target if not target.startswith("/") else target.lstrip("/")
            path = str(PurePosixPath(path))
            need(".." not in PurePosixPath(path).parts and path in names,
                 "XLSX_RELATIONSHIP", "The worksheet relationship is not contained in the original workbook.")
            table, formula_rows, row_numbers = [], [], set()
            for row in [n for n in xml(archive.read(path)).iter() if local(n.tag) == "row"]:
                cells = {}
                declared_row = row.attrib.get("r")
                need(declared_row is None or re.fullmatch(r"[1-9][0-9]*", declared_row),
                     "XLSX_ROW", "The workbook has an invalid original row reference.")
                number = int(declared_row) if declared_row is not None else None
                for cell in children(row, "c"):
                    ref, typ = cell.attrib.get("r", ""), cell.attrib.get("t", "")
                    matched = re.fullmatch(r"([A-Z]+)([1-9][0-9]*)", ref)
                    need(matched is not None, "XLSX_CELL", "The workbook has an invalid cell reference.")
                    cell_row = int(matched.group(2))
                    if number is None:
                        number = cell_row
                    need(cell_row == number and number <= 1048576, "XLSX_CELL_ROW",
                         "A source cell's row differs from its original worksheet row.")
                    index = 0
                    for c in matched.group(1):
                        index = index * 26 + ord(c) - 64
                    need(index <= 512, "XLSX_COLUMNS", "The source workbook exceeds 512 columns.")
                    need(index - 1 not in cells, "XLSX_DUPLICATE_CELL",
                         "The original worksheet contains a duplicate cell reference.", details={"cell": ref})
                    value = val(cell, "v")
                    if child(cell, "f") is not None:
                        formula_rows.append({"cell": ref, "formula": val(cell, "f"), "cached_value": value})
                    if typ == "s":
                        need(value.isdigit() and int(value) < len(strings), "XLSX_STRING", "The shared-string index is invalid.")
                        value = strings[int(value)]
                    elif typ == "inlineStr":
                        value = "".join(n.text or "" for n in cell.iter() if local(n.tag) == "t")
                    elif typ not in ("str", "s", "inlineStr") and value:
                        # Raw numeric lexical values survive; type annotation drives explicit validation.
                        value = {"numeric_lexeme": value, "cell_type": typ or "n"}
                    cells[index - 1] = value
                if cells:
                    need(number not in row_numbers, "XLSX_DUPLICATE_ROW", "The worksheet repeats an original row reference.")
                    row_numbers.add(number)
                    values = [cells.get(i, "") for i in range(max(cells) + 1)]
                    if any(v != "" for v in values):
                        table.append((number, values))
            if not table:
                continue
            header_row, headers = table[0]
            need(all(isinstance(v, str) and v.strip() for v in headers) and len(set(headers)) == len(headers),
                 "XLSX_HEADERS", "The first nonempty row needs unique text column names.")
            for number, values in table[1:]:
                need(len(values) <= len(headers), "XLSX_ROW", "A row has more values than its header.")
                row = dict(zip(headers, values))
                if all(v == "" for v in row.values()):
                    continue
                item = canonical_item(row, source={"member": filename, "sheet": sheet.attrib.get("name"), "row": number})
                for canonical_name, aliases in ALIASES.items():
                    if canonical_name not in ("gtin", "provider_gln"):
                        continue
                    value = next((row[a] for a in aliases if a in row), "")
                    if isinstance(value, dict) and "numeric_lexeme" in value:
                        item[canonical_name] = value["numeric_lexeme"]
                        item["source"]["identifier_types"][canonical_name] = "numeric_cell"
                if item["identifier_type"] == "gtin":
                    item["identifier"] = item["gtin"]
                    item["key"] = item["provider_gln"] + ":" + item["gtin"]
                items.append(item)
                need(len(items) <= MAX_ITEMS, "ITEM_LIMIT", "The source exceeds 5,000 item editions.")
            if formula_rows:
                observations.append({"kind": "workbook_formulas", "sheet": sheet.attrib.get("name"),
                    "formulas": formula_rows, "meaning": "Original formulas and cached values retained; this importer does not calculate them."})
            sheets.append({"name": sheet.attrib.get("name"), "header_row": header_row, "rows": max(0, len(table) - 1)})
        return items, observations, {"sheets": sheets}

def parse_delimited(raw, filename):
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise Problem("CSV_ENCODING", "Save the supplier CSV as UTF-8, preserving identifier columns as text.") from exc
    delimiter = "\t" if filename.lower().endswith(".tsv") else ","
    reader = csv.DictReader(io.StringIO(content, newline=""), delimiter=delimiter, strict=True)
    need(reader.fieldnames and all(v and v.strip() for v in reader.fieldnames) and len(set(reader.fieldnames)) == len(reader.fieldnames),
         "CSV_HEADERS", "The first row needs unique, nonempty column names.")
    items = []
    for number, row in enumerate(reader, 2):
        need(None not in row, "CSV_COLUMNS", "A CSV row has more fields than its header.", details={"row": number})
        if not any(v for v in row.values()):
            continue
        items.append(canonical_item(row, source={"member": filename, "row": number}))
        need(len(items) <= MAX_ITEMS, "ITEM_LIMIT", "The source exceeds 5,000 item editions.")
    return items, [], {"delimiter": delimiter, "encoding": "UTF-8"}

def unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, "JSON_DUPLICATE_KEY",
             "The original supplier JSON repeats an object key.", details={"key": key})
        result[key] = value
    return result

def parse_json(raw, filename):
    try:
        value = json.loads(raw, object_pairs_hook=unique_json_object,
                           parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
    except (ValueError, UnicodeDecodeError, RecursionError) as exc:
        raise Problem("JSON_INVALID", "The original supplier JSON is invalid.") from exc
    rows = value.get("items") if isinstance(value, dict) else value
    need(isinstance(rows, list) and len(rows) <= MAX_ITEMS, "JSON_ITEMS", "Supply an item array or an object with an items array.")
    return [canonical_item(row, source={"member": filename, "row": i + 1}) for i, row in enumerate(rows)], [], {}

def image_metadata(raw, name):
    if raw.startswith(b"\x89PNG\r\n\x1a\n") and len(raw) >= 24:
        w, h = struct.unpack(">II", raw[16:24])
        return {"member": name, "format": "png", "width": w, "height": h, "sha256": digest(raw), "bytes": len(raw)}
    if raw.startswith(b"\xff\xd8"):
        stream = io.BytesIO(raw)
        stream.seek(2)
        while stream.tell() < len(raw):
            value = stream.read(1)
            if value != b"\xff":
                continue
            code = stream.read(1)
            while code == b"\xff":
                code = stream.read(1)
            if code in (b"\xd8", b"\xd9", b"\x00"):
                continue
            length_bytes = stream.read(2)
            if len(length_bytes) != 2:
                break
            size = int.from_bytes(length_bytes, "big")
            if size < 2:
                break
            if code and code[0] in (0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF):
                data = stream.read(5)
                if len(data) == 5:
                    h, w = struct.unpack(">HH", data[1:])
                    return {"member": name, "format": "jpeg", "width": w, "height": h, "sha256": digest(raw), "bytes": len(raw)}
                break
            stream.seek(size - 2, 1)
    return {"member": name, "format": "unrecognized", "sha256": digest(raw), "bytes": len(raw)}

def parse_source(filename, raw):
    extension = filename.rsplit(".", 1)[-1].lower()
    if extension == "xlsx":
        items, observations, provenance = parse_xlsx(raw, filename)
        members = []
    elif extension == "zip":
        archive, infos = zip_members(raw)
        items, observations, members = [], [], []
        with archive:
            for info in infos:
                name = info.filename
                data = archive.read(info)
                ext = name.rsplit(".", 1)[-1].lower()
                inventory = {"name": name, "bytes": len(data), "sha256": digest(data), "role": "retained_original"}
                members.append(inventory)
                if ext in ("xml", "json", "csv", "tsv", "xlsx"):
                    result = parse_source(name, data)
                    items.extend(result["items"])
                    observations.extend(result["observations"])
                    inventory["role"] = "supplier_source"
                    inventory["provenance"] = result["provenance"]
                elif ext in ("jpg", "jpeg", "png", "webp", "gif", "tif", "tiff"):
                    observations.append({"kind": "image_asset", **image_metadata(data, name)})
                need(len(items) <= MAX_ITEMS, "ITEM_LIMIT", "The source exceeds 5,000 item editions.")
        provenance = {"archive_members": len(members), "original_bytes": len(raw)}
    elif extension == "xml":
        items, observations, provenance = parse_xml(raw, filename)
        members = []
    elif extension in ("csv", "tsv"):
        items, observations, provenance = parse_delimited(raw, filename)
        members = []
    elif extension == "json":
        items, observations, provenance = parse_json(raw, filename)
        members = []
    else:
        raise Problem("FORMAT_UNSUPPORTED", "Choose an original CSV, TSV, XLSX, XML, JSON, or ZIP.")
    return {"format": extension, "items": items, "observations": observations, "provenance": provenance, "members": members}

def validate_source(parsed, supplier, source_label):
    findings = []
    def add(severity, code, item, field, message):
        findings.append({"severity": severity, "code": code, "item_key": item.get("key") if item else None,
                         "field": field, "message": message})
    seen = {}
    for item in parsed["items"]:
        key = item["key"]
        if item["identifier_type"] not in ("gtin", "supplier"):
            add("error", "IDENTIFIER_TYPE", item, "identifier_type", "Select a GTIN or an explicitly scoped original supplier identifier.")
        elif item["identifier_type"] == "gtin":
            if not gs1_check(item["gtin"], (8, 12, 13, 14)):
                add("error", "GTIN_INVALID", item, "gtin", "Supply a GS1 GTIN with its original leading zeroes and a valid check digit.")
        else:
            if not isinstance(item["identifier"], str) or not item["identifier"].strip() or len(item["identifier"]) > 240 or "\x00" in item["identifier"]:
                add("error", "SUPPLIER_IDENTIFIER", item, "identifier", "Retain the actual supplier or random-weight item identifier as text.")
            if not isinstance(item["identifier_namespace"], str) or not item["identifier_namespace"].strip() or len(item["identifier_namespace"]) > 240:
                add("error", "IDENTIFIER_NAMESPACE", item, "identifier_namespace", "Name the actual supplier catalogue or local identifier namespace.")
            if item["gtin"] and not gs1_check(item["gtin"], (8, 12, 13, 14)):
                add("error", "GTIN_INVALID", item, "gtin", "Any separately supplied GTIN must retain its original valid check digit.")
            add("warning", "LOCAL_IDENTIFIER_REVIEW", item, "identifier", "Review this original supplier identifier and its target-system mapping. No global GTIN is inferred.")
        if item["provider_gln"] and not gs1_check(item["provider_gln"], (13,)):
            add("error", "GLN_INVALID", item, "provider_gln", "The information-provider GLN must contain 13 digits and its valid check digit.")
        if supplier.get("gln") and item["provider_gln"] and supplier["gln"] != item["provider_gln"]:
            add("error", "SUPPLIER_ID_MISMATCH", item, "provider_gln", "The source's information provider differs from the selected supplier.")
        for name, typ in item["source"].get("identifier_types", {}).items():
            if typ not in ("str", "NoneType"):
                add("error", "IDENTIFIER_COERCION", item, name, "Import this identifier from a text cell or string; numeric input cannot prove its original zeroes.")
        if not item["name"] or not isinstance(item["name"], str):
            add("error", "NAME_REQUIRED", item, "name", "A product name is required for review.")
        if not item["brand"]:
            add("warning", "BRAND_MISSING", item, "brand", "No brand was mapped from the retained source.")
        for field, label in (("images", "product images"), ("nutrition", "nutrition information"),
                             ("dimensions", "dimensions"), ("packaging", "packaging"), ("ingredients", "ingredients")):
            if not item[field]:
                add("warning", "CONTENT_INCOMPLETE", item, field, "Review the source mapping for " + label + ".")
        if key in seen:
            add("error", "MULTIPLE_ITEM_OPERATIONS", item, "key", "This intake contains multiple editions of the same supplier/GTIN. Import the intended ADD or MODIFY document separately.")
        seen[key] = item
    if not parsed["items"]:
        add("error", "NO_PRODUCT_ITEMS", None, "source", "The source contains no product item to review. Its original messages remain available as observations.")
    messages = {(i["source"].get("message_id"), i["source"].get("document_id")) for i in parsed["items"]}
    for observation in parsed["observations"]:
        if observation["kind"] == "native_response":
            pair = (observation.get("originating_message_id"), observation.get("originating_document_id"))
            observation["matched"] = bool(all(pair) and pair in messages)
            add("warning", "SOURCE_RESPONSE_REVIEW", None, "observations",
                "Review the retained native response and its exact message/document identity; it is not a product approval.")
        elif observation["kind"] == "image_asset":
            if observation.get("format") == "unrecognized":
                add("warning", "IMAGE_FORMAT_REVIEW", None, "images", "An original image needs decoder review: " + observation["member"])
            elif observation.get("width", 0) < 600 or observation.get("height", 0) < 600:
                add("warning", "IMAGE_DIMENSIONS", None, "images",
                    "An original image is below the workbench's local review baseline of 600×600 pixels: " + observation["member"])
        elif observation["kind"] == "workbook_formulas":
            add("warning", "FORMULA_VALUES", None, "source", "Workbook formulas were preserved with cached values. Review calculated input before approval.")
    if "publisher" in source_label.lower() or "documentation" in source_label.lower():
        add("warning", "PUBLISHER_EXAMPLE", None, "provenance", "Publisher documentation example: keep its source attribution when reviewing or exporting.")
    return findings


def inspect_source(filename, raw, supplier, source_label):
    """Retain validation failures as source cases with unchanged original bytes."""
    try:
        parsed = parse_source(filename, raw)
        return parsed, validate_source(parsed, supplier, source_label)
    except (Problem, csv.Error, zipfile.BadZipFile) as exc:
        if isinstance(exc, csv.Error):
            exc = Problem("CSV_INVALID", "The original CSV is malformed or contains a field larger than 16 MiB.")
        elif isinstance(exc, zipfile.BadZipFile):
            exc = Problem("ZIP_INVALID", "The original archive is incomplete or has a damaged member.")
        parsed = {"format": filename.rsplit(".", 1)[-1].lower(), "items": [],
                  "observations": [{"kind": "source_parse_failure", "code": exc.code,
                                    "message": str(exc), "details": exc.details}],
                  "provenance": {"original_bytes": len(raw), "parse_status": "requires_correction"},
                  "members": []}
        findings = [{"severity": "error", "code": exc.code, "item_key": None,
                     "field": "source", "message": str(exc)}]
        return parsed, findings
