#!/usr/bin/env python3
"""Read retained public supplier originals without changing or executing them."""
from __future__ import annotations
import argparse
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import urlopen
import xml.etree.ElementTree as ET
import zipfile

XSD = "http://www.w3.org/2001/XMLSchema"
MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
ODREL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
STRICT_MAIN = "http://purl.oclc.org/ooxml/spreadsheetml/main"
STRICT_ODREL = "http://purl.oclc.org/ooxml/officeDocument/relationships"
WSDL = "http://schemas.xmlsoap.org/wsdl/"
MAX_EXPANDED = 64 * 1024 * 1024

def digest(body):
    return {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}

def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")

def unwrap(value):
    if isinstance(value, str):
        return unwrap(json.loads(value))
    if not isinstance(value, dict):
        raise ValueError("Expected complete connected-tool object")
    if value.get("isError"):
        raise ValueError("Connected tool returned an error")
    if value.get("structuredContent") is not None:
        return unwrap(value["structuredContent"])
    if "content" in value and isinstance(value["content"], list):
        for item in value["content"]:
            if item.get("type") == "text":
                try:
                    parsed = json.loads(item["text"])
                except (ValueError, TypeError):
                    continue
                return unwrap(parsed)
        raise ValueError("Complete connected-tool JSON text is missing")
    return value

def filename(value):
    if not isinstance(value, str) or not value or Path(value).name != value or "\\" in value or value in {".", ".."}:
        raise ValueError("Expected a plain original filename")
    return value

def sync_directory(path):
    """Complete a filename publication before reporting that it is durable."""
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_once(path, body):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink():
        raise ValueError("Refusing a symbolic-link output")
    if path.exists():
        if not path.is_file() or path.read_bytes() != body:
            raise ValueError("Existing output differs: " + path.name)
        sync_directory(path.parent)
        return
    fd, temporary = tempfile.mkstemp(prefix=".source-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.is_symlink() or not path.is_file() or path.read_bytes() != body:
                raise ValueError("Concurrent output differs: " + path.name)
    finally:
        os.unlink(temporary)
    # This also completes a concurrent exact-body publication. Sync after the
    # temporary filename is removed; an interrupted sync is completed by replay.
    sync_directory(path.parent)

def original_bytes(item, originals, downloads):
    name = filename(item["filename"])
    expected = item["bytes"]
    if type(expected) is not int or expected <= 0 or expected > MAX_EXPANDED:
        raise ValueError("Invalid declared original size: " + name)
    local = Path(originals) / name
    receipt = {}
    if local.is_symlink():
        raise ValueError("Refusing symbolic-link original: " + name)
    if local.exists():
        body = local.read_bytes()
        receipt["route"] = "retained-local-original"
    else:
        reference = item.get("stable_reference")
        matches = [row for row in downloads if row.get("reference") == reference]
        if not reference or len(matches) != 1:
            raise ValueError("Need one fresh resolved original reference: " + name)
        selected = matches[0]
        address = selected.get("url", "")
        parsed = urlsplit(address)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError("Expected original HTTPS download URL: " + name)
        try:
            with urlopen(address, timeout=60) as response:
                if urlsplit(response.geturl()).scheme != "https":
                    raise ValueError("Original download redirected outside HTTPS: " + name)
                body = response.read(expected + 1)
                receipt.update({
                    "route": "resolved-retained-notion-file",
                    "etag": response.headers.get("ETag"),
                    "lastModified": response.headers.get("Last-Modified"),
                    "downloadExpiry": selected.get("expiry_time"),
                })
        except HTTPError as error:
            raise RuntimeError("Original download HTTP " + str(error.code) + ": " + name) from None
        except URLError:
            raise RuntimeError("Original download transport failed: " + name) from None
    if len(body) != expected:
        raise ValueError("Original byte count changed: " + name)
    if item.get("sha256") and digest(body)["sha256"] != item["sha256"]:
        raise ValueError("Original digest differs: " + name)
    if not local.exists():
        write_once(local, body)
    return body, receipt

def xml_source(body):
    # No external entity resolution, DTD interpretation, or schema downloads.
    if b"<!DOCTYPE" in body.upper() or b"<!ENTITY" in body.upper():
        raise ValueError("DTD/entity declarations are outside this supplier source contract")
    namespaces = {}
    scoped = {}
    stack = []
    pending = []
    parser = ET.iterparse(io.BytesIO(body), events=("start-ns", "start", "end"))
    for event, item in parser:
        if event == "start-ns":
            pending.append(item)
            namespaces.setdefault(item[0], [])
            if item[1] not in namespaces[item[0]]:
                namespaces[item[0]].append(item[1])
        elif event == "start":
            context = dict(stack[-1]) if stack else {}
            context.update(pending)
            pending.clear()
            stack.append(context)
            scoped[id(item)] = context
        else:
            stack.pop()
    return parser.root, scoped, namespaces

def tree_value(node, scoped=None):
    result = {"tag": node.tag, "attributes": dict(node.attrib)}
    if node.text is not None:
        result["text"] = node.text
    if node.tail is not None:
        result["tail"] = node.tail
    if scoped is not None:
        result["namespaces"] = scoped[id(node)]
    if len(node):
        result["children"] = [tree_value(child, scoped) for child in node]
    return result

def qname(value, context):
    if ":" in value:
        prefix, local = value.split(":", 1)
        if prefix not in context:
            return {"lexical": value, "unresolvedPrefix": prefix}
        return {"lexical": value, "expanded": "{" + context[prefix] + "}" + local}
    return {"lexical": value, "expanded": "{" + context.get("", "") + "}" + value}

def xml_index(body):
    root, scoped, namespaces = xml_source(body)
    schemas, messages, operations, endpoints = [], [], [], []
    references = []
    def visit(node, path):
        local = node.tag.rsplit("}", 1)[-1]
        for key, value in node.attrib.items():
            if key in {"type", "base", "ref", "itemType", "substitutionGroup", "element", "message", "binding", "refer"}:
                references.append({"path": path, "attribute": key, **qname(value, scoped[id(node)])})
            elif key == "memberTypes":
                references.extend({"path": path, "attribute": key, **qname(v, scoped[id(node)])} for v in value.split())
        if node.tag == "{" + XSD + "}schema":
            target = node.get("targetNamespace", "")
            schemas.append({
                "path": path, "targetNamespace": target,
                "attributes": dict(node.attrib),
                "declarations": [
                    {"kind": child.tag.rsplit("}", 1)[-1], "name": child.get("name"),
                     "qualifiedName": "{" + target + "}" + child.get("name", ""),
                     "definition": tree_value(child, scoped)}
                    for child in node if child.get("name") is not None
                ],
                "imports": [tree_value(child, scoped) for child in node
                            if child.tag in {"{" + XSD + "}import", "{" + XSD + "}include", "{" + XSD + "}redefine"}],
            })
        if node.tag == "{" + WSDL + "}message":
            messages.append({"path": path, "name": node.get("name"), "definition": tree_value(node, scoped)})
        if node.tag == "{" + WSDL + "}operation":
            operations.append({"path": path, "name": node.get("name"), "definition": tree_value(node, scoped)})
        if local == "address" and "location" in node.attrib:
            endpoints.append({"path": path, **node.attrib})
        counts = {}
        for child in node:
            counts[child.tag] = counts.get(child.tag, 0) + 1
            visit(child, path + "/" + child.tag + "[" + str(counts[child.tag]) + "]")
    visit(root, "/" + root.tag + "[1]")
    return {"root": tree_value(root, scoped), "namespaces": namespaces,
            "schemas": schemas, "messages": messages, "operations": operations,
            "endpoints": endpoints, "qnameReferences": references}

def member_path(value):
    if not value or value.startswith("/") or "\\" in value:
        raise ValueError("Invalid workbook member")
    clean = PurePosixPath(value)
    if ".." in clean.parts or str(clean) != value.rstrip("/"):
        raise ValueError("Noncanonical workbook member")
    return value

def relationships(members, source):
    parent, name = posixpath.split(source)
    relpath = posixpath.join(parent, "_rels", name + ".rels")
    if relpath not in members:
        return {}
    root, _, _ = xml_source(members[relpath])
    result = {}
    for item in root:
        if item.tag != "{" + REL + "}Relationship":
            continue
        rid = item.get("Id")
        if not rid or rid in result:
            raise ValueError("Duplicate workbook relationship")
        row = dict(item.attrib)
        if item.get("TargetMode") != "External":
            target = item.get("Target", "")
            if "\\" in target:
                raise ValueError("Invalid workbook relationship target")
            target = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join(parent, target))
            member_path(target)
            if target not in members:
                raise ValueError("Workbook relationship target missing: " + target)
            row["member"] = target
        result[rid] = row
    return result

def rich_text(node, main):
    # Phonetic annotations are retained in raw XML, not appended to the cell value.
    text = []
    for child in node:
        if child.tag == "{" + main + "}t":
            text.append(child.text or "")
        elif child.tag == "{" + main + "}r":
            text.extend(t.text or "" for t in child.findall("{" + main + "}t"))
    return "".join(text)

def workbook_source(body):
    members, inventory = {}, []
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        if sum(info.file_size for info in archive.infolist()) > MAX_EXPANDED:
            raise ValueError("Workbook expanded size exceeds source-reader capacity")
        for info in archive.infolist():
            name = member_path(info.filename)
            if name in members:
                raise ValueError("Duplicate workbook member: " + name)
            data = archive.read(info)  # zipfile checks each member CRC.
            members[name] = data
            record = {"path": name, **digest(data), "crc32": format(info.CRC, "08x"),
                      "compressedBytes": info.compress_size, "compression": info.compress_type,
                      "base64": base64.b64encode(data).decode("ascii")}
            if name.endswith((".xml", ".rels")):
                node, _, _ = xml_source(data)
                record["xml"] = tree_value(node)
            inventory.append(record)
    if "xl/workbook.xml" not in members:
        raise ValueError("Missing original XLSX workbook")
    book, _, _ = xml_source(members["xl/workbook.xml"])
    if book.tag not in {"{" + MAIN + "}workbook", "{" + STRICT_MAIN + "}workbook"}:
        raise ValueError("Unsupported workbook root namespace")
    main = book.tag[1:].split("}", 1)[0]
    odrel = ODREL if main == MAIN else STRICT_ODREL
    rels = relationships(members, "xl/workbook.xml")
    shared = []
    shared_members = [x["member"] for x in rels.values()
                      if x.get("Type", "").endswith("/sharedStrings") and x.get("member")]
    if len(shared_members) > 1:
        raise ValueError("Multiple shared-string parts")
    if shared_members:
        shared_root, _, _ = xml_source(members[shared_members[0]])
        if shared_root.tag != "{" + main + "}sst":
            raise ValueError("Shared-string namespace differs from workbook")
        shared = [rich_text(item, main) for item in shared_root.findall("{" + main + "}si")]
    sheets = []
    for sheet in book.findall("{" + main + "}sheets/{" + main + "}sheet"):
        relation = rels.get(sheet.get("{" + odrel + "}id"))
        if not relation or "member" not in relation:
            raise ValueError("Worksheet relationship missing")
        sheetpath = relation["member"]
        node, _, _ = xml_source(members[sheetpath])
        if not node.tag.startswith("{" + main + "}"):
            raise ValueError("Sheet namespace differs from workbook")
        cells = []
        for cell in node.iter("{" + main + "}c"):
            val = cell.find("{" + main + "}v")
            formula = cell.find("{" + main + "}f")
            raw = None if val is None else val.text
            celltype = cell.get("t", "n")
            resolved = raw
            if celltype == "s":
                if raw is None or not re.fullmatch(r"\d+", raw) or int(raw) >= len(shared):
                    raise ValueError("Shared-string index invalid: " + str(cell.get("r")))
                resolved = shared[int(raw)]
            elif celltype == "inlineStr":
                inline = cell.find("{" + main + "}is")
                resolved = "" if inline is None else rich_text(inline, main)
            cells.append({
                "address": cell.get("r"), "attributes": dict(cell.attrib),
                "type": celltype, "rawValue": raw, "resolvedValue": resolved,
                "formula": None if formula is None else {"text": formula.text, "attributes": dict(formula.attrib)},
                "xml": tree_value(cell),
            })
        sheets.append({"name": sheet.get("name"), "attributes": dict(sheet.attrib),
                       "member": sheetpath, "kind": node.tag, "relationships": relationships(members, sheetpath),
                       "cells": cells, "xml": tree_value(node)})
    return {"members": inventory, "workbook": tree_value(book), "relationships": rels,
            "sharedStrings": shared, "sheets": sheets,
            "valuePolicy": "Original lexical values, explicit cell types, formulas and cached values are separate. Numeric/date serials remain strings; original styles and workbook date system are preserved. Formulas are not executed."}

def inspect_packet(packet):
    if packet.get("schema") != "commons.supplier-originals.v1":
        raise ValueError("Unexpected source packet schema")
    names = set()
    for item in packet["files"]:
        name = filename(item["filename"])
        if name in names:
            raise ValueError("Duplicate original filename")
        names.add(name)
        body = base64.b64decode(item["originalBase64"], validate=True)
        if digest(body) != {k: item[k] for k in ("bytes", "sha256")}:
            raise ValueError("Original round-trip differs: " + name)
        if name.lower().endswith(".pdf"):
            if not body.startswith(b"%PDF-") or item.get("document", {}).get("mediaType") != "application/pdf":
                raise ValueError("Original PDF type or header differs: " + name)
        if name.lower().endswith(".xlsx"):
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                expected = item["workbook"]["members"]
                infos = archive.infolist()
                if [x.filename for x in infos] != [x["path"] for x in expected]:
                    raise ValueError("Workbook member inventory differs")
                for info, member in zip(infos, expected):
                    raw = archive.read(info)
                    if raw != base64.b64decode(member["base64"], validate=True):
                        raise ValueError("Workbook member round-trip differs")
                    if digest(raw) != {k: member[k] for k in ("bytes", "sha256")}:
                        raise ValueError("Workbook member digest differs")
    return {"files": len(names), "sourceBytes": sum(x["bytes"] for x in packet["files"]),
            "workbooks": sum("workbook" in x for x in packet["files"])}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    collect = sub.add_parser("collect")
    collect.add_argument("--catalogue", required=True)
    collect.add_argument("--downloads", help="Complete current notion_get_file_download_urls JSON response")
    collect.add_argument("--originals", required=True)
    collect.add_argument("--out", required=True)
    collect.add_argument("--frame-characters", type=int, default=28000)
    inspect = sub.add_parser("inspect")
    inspect.add_argument("--packet", required=True)
    args = parser.parse_args()
    if args.command == "inspect":
        blob = Path(args.packet).read_bytes()
        packet = json.loads(gzip.decompress(blob) if blob[:2] == b"\x1f\x8b" else blob)
        print(json.dumps(inspect_packet(packet)))
        return
    catalogue = json.loads(Path(args.catalogue).read_text(encoding="utf-8"))
    items = catalogue["files"]
    if not isinstance(items, list) or not items:
        raise ValueError("Complete supplier catalogue has no files")
    names = [filename(item["filename"]) for item in items]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate catalogue filename")
    downloads = []
    if args.downloads:
        resolved = unwrap(json.loads(Path(args.downloads).read_text(encoding="utf-8")))
        downloads = resolved.get("files", [])
        if resolved.get("unresolved"):
            raise ValueError("Refresh unresolved retained original file references")
    if args.frame_characters < 1024 or args.frame_characters % 4:
        raise ValueError("Frame length must be at least1024 and divisible by4")
    output = Path(args.out)
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    packet = {"schema": "commons.supplier-originals.v1", "files": []}
    receipts = []
    for item in items:
        body, receipt = original_bytes(item, args.originals, downloads)
        name = item["filename"]
        record = {"filename": name, "sourceUrl": item.get("source_url"),
                  "stableReference": item.get("stable_reference"), **digest(body),
                  "originalBase64": base64.b64encode(body).decode("ascii")}
        if name.lower().endswith((".xml", ".xsd", ".wsdl")):
            record["xml"] = xml_index(body)
            try:
                record["originalText"] = body.decode("utf-8")
            except UnicodeDecodeError:
                pass
        elif name.lower().endswith(".xlsx"):
            record["workbook"] = workbook_source(body)
        elif name.lower().endswith(".pdf"):
            if not body.startswith(b"%PDF-"):
                raise ValueError("Declared original PDF has no PDF header: " + name)
            record["document"] = {
                "mediaType": "application/pdf",
                "sourceKind": item.get("kind", "original_supplier_pdf"),
                "textPolicy": "Complete original PDF bytes are retained. Document text, pages and layout belong to the original PDF reader."
            }
        else:
            record["originalText"] = body.decode("utf-8")
        packet["files"].append(record)
        receipts.append({"filename": name, **digest(body), **receipt})
        print(json.dumps({"read": name, **digest(body)}), flush=True)
    summary = inspect_packet(packet)
    payload = json_bytes(packet)
    compressed = gzip.compress(payload, compresslevel=9, mtime=0)
    if gzip.decompress(compressed) != payload:
        raise ValueError("Compressed source round-trip differs")
    write_once(output / "supplier-originals.json", payload)
    write_once(output / "supplier-originals.json.gz", compressed)
    encoded = base64.b64encode(compressed).decode("ascii")
    frames = [encoded[i:i + args.frame_characters] for i in range(0, len(encoded), args.frame_characters)]
    metadata = {"schema": "commons.supplier-originals-transfer.v1",
                "encoding": "gzip+base64-json-utf8", **digest(payload),
                "compressed": digest(compressed), "frames": len(frames),
                "sourceFiles": [{"filename": x["filename"], "bytes": x["bytes"], "sha256": x["sha256"]} for x in packet["files"]],
                "summary": summary}
    write_once(output / "SOURCE_TRANSFER.json", json_bytes(metadata))
    for index, frame in enumerate(frames, 1):
        write_once(output / ("source-frame-%04d.txt" % index), (frame + "\n").encode("ascii"))
    # Receipts retain no signed access URL. Source outputs are deterministic on resume.
    write_once(output / "original-read-receipt.json", json_bytes({
        "schema": "commons.supplier-originals-read.v1", "files": [
            {"filename": r["filename"], "bytes": r["bytes"], "sha256": r["sha256"]}
            for r in receipts]}))
    print(json.dumps({"complete": True, "output": str(output.resolve()), **metadata}), flush=True)

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"complete": False, "errorType": type(error).__name__, "error": str(error)}), file=sys.stderr)
        raise SystemExit(1)
