#!/usr/bin/env python3
"""MIT. WebDAV multistatus projection using the original hardened XML parser."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import re
import sys

_SOURCE = Path(__file__).resolve().parent.parent / "xml" / "xml_source.py"
_spec = importlib.util.spec_from_file_location("stellar_forge_original_xml_source", _SOURCE)
if _spec is None or _spec.loader is None:
    raise RuntimeError("WEBDAV_ORIGINAL_XML_SOURCE_MISSING")
_xml = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _xml
_spec.loader.exec_module(_xml)
DAV = "{DAV:}"

def children(node: dict, name: str) -> list[dict]:
    return [child for child in node["children"] if child["name"] == name]

def inner_text(node: dict) -> str:
    # These properties are text or namespaced empty resource-type elements.
    return "".join(node["text"]) + "".join(inner_text(child) for child in node["children"])

def first_text(node: dict, name: str) -> str | None:
    selected = children(node, name)
    return inner_text(selected[0]) if selected else None

def status(line: str | None) -> int | None:
    if line is None:
        return None
    match = re.fullmatch(r"HTTP/\d(?:\.\d)?[ \t]+([1-5]\d{2})(?:[ \t]+[^\r\n]*)?", line.strip())
    return int(match.group(1)) if match else None

def response(node: dict) -> dict:
    result = {
        "hrefs": [inner_text(item) for item in children(node, DAV + "href")],
        "statusLine": first_text(node, DAV + "status"),
        "description": first_text(node, DAV + "responsedescription"),
        "propstats": [],
    }
    result["status"] = status(result["statusLine"])
    for propstat in children(node, DAV + "propstat"):
        line = first_text(propstat, DAV + "status")
        props = []
        for container in children(propstat, DAV + "prop"):
            for prop in container["children"]:
                props.append({
                    "name": prop["name"],
                    "text": inner_text(prop),
                    "children": [child["name"] for child in prop["children"]],
                })
        result["propstats"].append({"status": status(line), "statusLine": line, "properties": props})
    return result

def parse(stream, max_entries: int, max_bytes: int) -> dict:
    native = _xml.parser()
    stack: list[dict] = []
    rows: list[dict] = []
    seen_root = False
    byte_count = 0
    node_count = 0
    text_count = 0
    def start(raw_name, attrs):
        nonlocal seen_root, node_count
        name = _xml.expanded(raw_name)
        node_count += 1
        if node_count > 600000 or len(stack) >= 64:
            raise _xml.InputError("The DAV multistatus exceeds its structural limit.")
        if not stack:
            if seen_root or name != DAV + "multistatus":
                raise _xml.InputError("Expected a DAV:multistatus document.")
            seen_root = True
        stack.append({"name": name, "text": [], "children": []})
    def text(value):
        nonlocal text_count
        text_count += len(value)
        if text_count > max_bytes:
            raise _xml.InputError("The DAV multistatus exceeds its text limit.")
        if stack:
            stack[-1]["text"].append(value)
    def end(raw_name):
        node = stack.pop()
        if len(stack) == 1 and node["name"] == DAV + "response":
            if len(rows) >= max_entries:
                raise _xml.InputError("The DAV multistatus exceeds its entry limit.")
            rows.append(response(node))
        elif stack and len(stack) > 1:
            stack[-1]["children"].append(node)
        elif stack and node["name"] != DAV + "response":
            # Unknown multistatus children are not candidate files.
            pass
    native.StartElementHandler = start
    native.CharacterDataHandler = text
    native.EndElementHandler = end
    while True:
        chunk = stream.read(65536)
        if not chunk:
            break
        byte_count += len(chunk)
        if byte_count > max_bytes:
            raise _xml.InputError("The DAV multistatus exceeds its byte limit.")
        native.Parse(chunk, False)
    native.Parse(b"", True)
    if not seen_root or stack:
        raise _xml.InputError("The DAV multistatus is incomplete.")
    return {"schema": "stellar-forge.webdav-multistatus.v1", "responses": rows, "xmlBytes": byte_count}

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-entries", type=int, required=True)
    ap.add_argument("--max-bytes", type=int, required=True)
    args = ap.parse_args()
    if not 1 <= args.max_entries <= 20000 or not 1024 <= args.max_bytes <= 16777216:
        raise ValueError("WEBDAV_XML_LIMITS")
    try:
        result = parse(sys.stdin.buffer, args.max_entries, args.max_bytes)
    except Exception as error:
        sys.stdout.write(json.dumps({"error": {"code": "WEBDAV_XML_INVALID", "message": str(error)[:1000]}}, ensure_ascii=True) + "\n")
        return 2
    sys.stdout.write(json.dumps(result, ensure_ascii=True, separators=(",", ":")) + "\n")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
