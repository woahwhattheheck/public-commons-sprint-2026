#!/usr/bin/env python3
"""MIT. Read a retained OAI page using the ORIGINAL source-native parser.

This is a read adapter. It does not serialize, rewrite, fetch, or replace XML.
The second Expat pass records the original lexical tag/attribute spellings for
Proteus, while the first pass supplies original protocol validation and hashes.
"""
from __future__ import annotations
import argparse
import io
import json
from pathlib import Path
import sys
from xml.parsers import expat

OAI = "http://www.openarchives.org/OAI/2.0/"
XML = "http://www.w3.org/XML/1998/namespace"

def lexical_names(raw, verb):
    parser = expat.ParserCreate()
    stack, names, results, envelope = [], None, [], {}
    def expanded(name, namespaces, attribute=False):
        if ":" in name:
            prefix, local = name.split(":", 1)
            uri = namespaces.get(prefix)
            if uri is None:
                raise ValueError("Unbound original XML namespace prefix")
            return "{" + uri + "}" + local
        uri = "" if attribute else namespaces.get("", "")
        return "{" + uri + "}" + name if uri else name
    def add(target, expanded_name, lexical):
        values = target.setdefault(expanded_name, [])
        if lexical not in values:
            values.append(lexical)
    def start(name, attributes):
        nonlocal names
        ns = dict(stack[-1][1]) if stack else {"xml": XML}
        for key, value in attributes.items():
            if key == "xmlns":
                ns[""] = value
            elif key.startswith("xmlns:"):
                ns[key[6:]] = value
        full = expanded(name, ns)
        stack.append((full, ns))
        if len(stack) <= 2 and full in {"{" + OAI + "}OAI-PMH", "{" + OAI + "}" + verb}:
            if full in envelope and envelope[full] != name:
                raise ValueError("The original envelope repeats with different tag spellings")
            envelope[full] = name
        if len(stack) == 3 and full == "{" + OAI + "}record" and stack[1][0] == "{" + OAI + "}" + verb:
            if names is not None:
                raise ValueError("Nested OAI record")
            names = {"elements": {}, "attributes": {}}
        if names is not None:
            add(names["elements"], full, name)
            for key, value in attributes.items():
                if key == "xmlns" or key.startswith("xmlns:"):
                    continue
                add(names["attributes"], expanded(key, ns, True), key)
    def end(name):
        nonlocal names
        if len(stack) == 3 and stack[-1][0] == "{" + OAI + "}record":
            results.append(names)
            names = None
        stack.pop()
    def forbidden(*_):
        raise ValueError("DTD and external entities are not permitted in retained OAI pages")
    parser.StartElementHandler = start
    parser.EndElementHandler = end
    parser.StartDoctypeDeclHandler = forbidden
    parser.ExternalEntityRefHandler = forbidden
    parser.EntityDeclHandler = forbidden
    parser.Parse(raw, True)
    return {"records": results, "envelopeNames": envelope}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--oai-directory", required=True)
    p.add_argument("--request-id", required=True)
    p.add_argument("--verb", required=True, choices=["ListRecords", "GetRecord"])
    p.add_argument("--max-bytes", type=int, default=64 * 1024 * 1024)
    args = p.parse_args()
    if args.max_bytes < 1 or args.max_bytes > 256 * 1024 * 1024:
        raise ValueError("Invalid original page byte limit")
    directory = Path(args.oai_directory).resolve(strict=True)
    for name in ("protocol.py", "bridge.py"):
        if not (directory / name).is_file():
            raise ValueError("Use the complete original OAI module directory")
    sys.path.insert(0, str(directory))
    from protocol import parse_page
    from bridge import storage
    raw = sys.stdin.buffer.read(args.max_bytes + 1)
    if len(raw) > args.max_bytes:
        raise ValueError("Retained page exceeds its declared limit")
    records = []
    def receive(ordinal, value):
        records.append({
            **value,
            "ordinal": ordinal,
            "observationId": storage.digest(storage.json_bytes([args.request_id, ordinal])),
            "semanticHash": storage.digest(storage.json_bytes({k: v for k, v in value.items() if k != "identifier"}))
        })
    parsed = parse_page(io.BytesIO(raw), args.verb, receive)
    lexical = lexical_names(raw, args.verb)
    names = lexical["records"]
    if len(names) != len(records) or parsed["recordCount"] != len(records):
        raise ValueError("Original namespace and protocol record counts differ")
    for record, spellings in zip(records, names):
        record["names"] = spellings
    json.dump({"schema": "tjl.ciim.original-oai-page.v1", "page": parsed, "records": records, "envelopeNames": lexical["envelopeNames"]},
              sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")

if __name__ == "__main__":
    main()
