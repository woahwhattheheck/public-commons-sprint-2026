#!/usr/bin/env python3
"""Parse original openTRANS XML using Expat and the captured local publisher DTD.

No instance-selected URL or filesystem path is opened. DTD validity is evaluated
from Expat's actual element/attribute declarations. Original XML bytes remain the
caller's retained input; the returned ordered tree is its XML information set.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
from urllib.parse import unquote, urlparse
from xml.parsers import expat
from xml.parsers.expat import model as xm

MAX_XML_BYTES = 64 * 1024 * 1024
MAX_DTD_BYTES = 4 * 1024 * 1024
MAX_NODES = 500_000
MAX_DEPTH = 128
MAX_FINDINGS = 10_000
KINDS = frozenset(("ORDER", "ORDERRESPONSE", "DISPATCHNOTIFICATION", "INVOICE"))
XML_SPACE = frozenset(" \t\r\n")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class NativeError(Exception):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code = code
        self.details = details


def fail(code, message, **details):
    raise NativeError(code, message, **details)


def original_file(path, expected_bytes=None, expected_sha256=None, maximum=MAX_DTD_BYTES):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            fail("OPENTRANS_SOURCE_FILE", "The selected publisher source must be a regular file.")
        if before.st_size > maximum:
            fail("OPENTRANS_SOURCE_SIZE", "The selected publisher source exceeds its parser limit.")
        chunks = []
        total = 0
        digest = hashlib.sha256()
        while True:
            chunk = os.read(fd, 64 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > maximum:
                fail("OPENTRANS_SOURCE_SIZE", "The selected publisher source grew beyond its parser limit.")
            digest.update(chunk)
            chunks.append(chunk)
        after = os.fstat(fd)
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if identity(before) != identity(after) or total != before.st_size:
            fail("OPENTRANS_SOURCE_CHANGED", "The publisher source changed during its read.")
        if expected_bytes is not None and total != expected_bytes:
            fail("OPENTRANS_SOURCE_BYTES", "The publisher source byte count differs from its retained identity.")
        if expected_sha256 is not None and digest.hexdigest() != expected_sha256:
            fail("OPENTRANS_SOURCE_SHA256", "The publisher source differs from its retained SHA256.")
        return b"".join(chunks)
    finally:
        os.close(fd)


class PublisherDTD:
    def __init__(self, manifest_path, kind):
        self.kind = kind
        self.directory = manifest_path.parent
        encoded = original_file(manifest_path, maximum=2 * 1024 * 1024)
        self.manifest_sha256 = hashlib.sha256(encoded).hexdigest()
        try:
            self.manifest = json.loads(encoded)
        except (UnicodeError, ValueError) as error:
            fail("OPENTRANS_SOURCE_MANIFEST", "The retained publisher-source manifest is invalid.", cause=str(error))
        if self.manifest.get("schema") != "stellar-forge.opentrans-source.v1":
            fail("OPENTRANS_SOURCE_MANIFEST", "The publisher source manifest schema is unsupported.")
        self.files = {}
        for item in self.manifest.get("files", []):
            if not isinstance(item, dict) or item.get("role") not in ("dtd", "dtd-dependency"):
                continue
            rel = item.get("path")
            if not isinstance(rel, str) or not rel or "\\" in rel:
                fail("OPENTRANS_SOURCE_MANIFEST", "A DTD source path is invalid.")
            parts = PurePosixPath(rel).parts
            if PurePosixPath(rel).is_absolute() or any(x in ("", ".", "..") for x in parts):
                fail("OPENTRANS_SOURCE_MANIFEST", "A DTD source path must remain within the original source bundle.")
            size = item.get("bytes")
            sha = item.get("sha256")
            if type(size) is not int or size < 0 or size > MAX_DTD_BYTES or not isinstance(sha, str) or not SHA256.fullmatch(sha):
                fail("OPENTRANS_SOURCE_MANIFEST", "A DTD source identity is invalid.")
            if rel in self.files:
                fail("OPENTRANS_SOURCE_MANIFEST", "A DTD source path is repeated.")
            self.files[rel] = dict(item)
        self.selection = self.manifest.get("dtds", {}).get(kind, {})
        self.main = self.selection.get("path")
        if self.main not in self.files:
            fail("OPENTRANS_SOURCE_MANIFEST", "The selected original DTD is absent from its manifest.")
        if len(self.files) > 64:
            fail("OPENTRANS_SOURCE_MANIFEST", "The original DTD dependency set exceeds its parser limit.")
        self.cache = {}
        self.resolutions = []

    def resolve(self, system_id, base=None, root=False):
        if root:
            selected = self.main
            if system_id:
                source_names = {PurePosixPath(self.main).name, *self.selection.get("systemIds", [])}
                parsed = urlparse(system_id)
                basename = PurePosixPath(unquote(parsed.path)).name
                if system_id not in source_names and basename not in source_names:
                    fail("OPENTRANS_DTD_DECLARATION", "The document declares a DTD outside the selected original profile.", systemId=system_id)
        else:
            if not isinstance(system_id, str) or not system_id:
                fail("OPENTRANS_DTD_DEPENDENCY", "An external DTD dependency has no captured identity.")
            parsed = urlparse(system_id)
            requested = unquote(parsed.path)
            selected = None
            candidates = []
            if not parsed.scheme and not parsed.netloc and base:
                parent = PurePosixPath(base).parent
                normalized = []
                for part in (parent / requested).parts:
                    if part == "..":
                        if not normalized:
                            fail("OPENTRANS_DTD_DEPENDENCY", "The DTD dependency leaves its captured source bundle.")
                        normalized.pop()
                    elif part not in ("", "."):
                        normalized.append(part)
                candidates.append("/".join(normalized))
            candidates.append(requested)
            for path, item in self.files.items():
                if system_id in item.get("systemIds", []):
                    candidates.append(path)
            for candidate in candidates:
                if candidate in self.files:
                    selected = candidate
                    break
            if selected is None:
                basename = PurePosixPath(requested).name
                matches = [path for path in self.files if PurePosixPath(path).name == basename]
                if len(matches) == 1:
                    selected = matches[0]
            if selected is None:
                fail("OPENTRANS_DTD_DEPENDENCY", "The external DTD dependency is not captured in the selected source.", systemId=system_id)
        if selected not in self.cache:
            item = self.files[selected]
            self.cache[selected] = original_file(self.directory / selected, item["bytes"], item["sha256"])
        resolution = {"systemId": system_id, "path": selected, "bytes": self.files[selected]["bytes"], "sha256": self.files[selected]["sha256"]}
        if resolution not in self.resolutions:
            self.resolutions.append(resolution)
        return selected, self.cache[selected]


class ContentMachine:
    """A Thompson NFA over the original DTD's element-name content model."""
    def __init__(self, content):
        self.edges = []
        self.epsilon = []
        self.start, self.end = self.compile(content)

    def node(self):
        index = len(self.edges)
        self.edges.append({})
        self.epsilon.append(set())
        return index

    def edge(self, start, name, end):
        self.edges[start].setdefault(name, set()).add(end)

    def compile(self, content):
        kind, quantifier, name, children = content
        start, end = self.node(), self.node()
        if kind == xm.XML_CTYPE_NAME:
            self.edge(start, name, end)
        elif kind == xm.XML_CTYPE_EMPTY:
            self.epsilon[start].add(end)
        elif kind == xm.XML_CTYPE_SEQ:
            cursor = start
            for child in children:
                a, b = self.compile(child)
                self.epsilon[cursor].add(a)
                cursor = b
            self.epsilon[cursor].add(end)
        elif kind == xm.XML_CTYPE_CHOICE:
            for child in children:
                a, b = self.compile(child)
                self.epsilon[start].add(a)
                self.epsilon[b].add(end)
        else:
            fail("OPENTRANS_DTD_MODEL", "The original DTD content model is unsupported.", kind=kind)
        if quantifier in (xm.XML_CQUANT_OPT, xm.XML_CQUANT_REP):
            self.epsilon[start].add(end)
        if quantifier in (xm.XML_CQUANT_PLUS, xm.XML_CQUANT_REP):
            self.epsilon[end].add(start)
        return start, end

    def closure(self, states):
        states = set(states)
        pending = list(states)
        while pending:
            current = pending.pop()
            for nxt in self.epsilon[current]:
                if nxt not in states:
                    states.add(nxt)
                    pending.append(nxt)
        return states

    def accepts(self, names):
        current = self.closure((self.start,))
        for name in names:
            following = set()
            for state in current:
                following.update(self.edges[state].get(name, ()))
            if not following:
                return False
            current = self.closure(following)
        return self.end in current


def xml_name_start(char):
    n = ord(char)
    return char in ":_" or "A" <= char <= "Z" or "a" <= char <= "z" or 0xC0 <= n <= 0xD6 or 0xD8 <= n <= 0xF6 or 0xF8 <= n <= 0x2FF or 0x370 <= n <= 0x37D or 0x37F <= n <= 0x1FFF or 0x200C <= n <= 0x200D or 0x2070 <= n <= 0x218F or 0x2C00 <= n <= 0x2FEF or 0x3001 <= n <= 0xD7FF or 0xF900 <= n <= 0xFDCF or 0xFDF0 <= n <= 0xFFFD or 0x10000 <= n <= 0xEFFFF


def xml_name_char(char):
    n = ord(char)
    return xml_name_start(char) or char in "-." or "0" <= char <= "9" or n == 0xB7 or 0x0300 <= n <= 0x036F or 0x203F <= n <= 0x2040


def is_name(value):
    return bool(value) and xml_name_start(value[0]) and all(map(xml_name_char, value[1:]))


def is_nmtoken(value):
    return bool(value) and all(map(xml_name_char, value))


class OriginalXML:
    def __init__(self, dtd):
        self.dtd = dtd
        self.declarations = {}
        self.attributes = {}
        self.entities = {}
        self.notations = set()
        self.models = {}
        self.stack = []
        self.siblings = []
        self.root = None
        self.prolog = []
        self.epilog = []
        self.xml = {"version": "1.0", "encoding": None, "standalone": None}
        self.doctype = None
        self.trusted_depth = 0
        self.node_count = 0
        self.findings = []
        self.finding_count = 0
        self.ids = {}
        self.idrefs = []
        self.parser = expat.ParserCreate()
        self.active_parsers = [self.parser]
        p = self.parser
        p.buffer_text = True
        p.ordered_attributes = True
        p.specified_attributes = True
        p.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_ALWAYS)
        p.UseForeignDTD(True)
        p.XmlDeclHandler = self.xml_decl
        p.StartDoctypeDeclHandler = self.doctype_decl
        p.ElementDeclHandler = self.element_decl
        p.AttlistDeclHandler = self.attribute_decl
        p.EntityDeclHandler = self.entity_decl
        p.NotationDeclHandler = self.notation_decl
        p.ExternalEntityRefHandler = self.external
        p.StartElementHandler = self.start
        p.EndElementHandler = self.end
        p.CharacterDataHandler = self.text
        p.CommentHandler = lambda value: self.misc({"comment": value})
        p.ProcessingInstructionHandler = lambda target, value: self.misc({"instruction": target, "text": value})

    def xml_decl(self, version, encoding, standalone):
        if not self.trusted_depth:
            self.xml = {"version": version, "encoding": encoding, "standalone": None if standalone == -1 else bool(standalone)}

    def doctype_decl(self, name, system_id, public_id, internal):
        if internal:
            fail("OPENTRANS_INTERNAL_DTD", "Instance-defined DTD subsets are not part of the retained openTRANS source.")
        self.doctype = {"name": name, "systemId": system_id, "publicId": public_id}
        if name not in KINDS:
            fail("OPENTRANS_DOCUMENT_KIND", "The document type is not an original supported openTRANS business document.", name=name)

    def element_decl(self, name, content):
        if not self.trusted_depth:
            fail("OPENTRANS_INTERNAL_DTD", "Element declarations must come from the captured publisher DTD.")
        if name not in self.declarations:
            self.declarations[name] = content

    def attribute_decl(self, element, name, attr_type, default, required):
        if not self.trusted_depth:
            fail("OPENTRANS_INTERNAL_DTD", "Attribute declarations must come from the captured publisher DTD.")
        self.attributes.setdefault(element, {}).setdefault(name, {"type": attr_type, "default": default, "required": bool(required)})

    def entity_decl(self, name, is_parameter, value, base, system_id, public_id, notation):
        if not self.trusted_depth:
            fail("OPENTRANS_INTERNAL_DTD", "Entity declarations must come from the captured publisher DTD.")
        if not is_parameter:
            self.entities.setdefault(name, {"value": value, "systemId": system_id, "notation": notation})

    def notation_decl(self, name, base, system_id, public_id):
        if not self.trusted_depth:
            fail("OPENTRANS_INTERNAL_DTD", "Notations must come from the captured publisher DTD.")
        self.notations.add(name)

    def external(self, context, base, system_id, public_id):
        if context is not None:
            fail("OPENTRANS_EXTERNAL_ENTITY", "External general entities are not resolved in source documents.", systemId=system_id)
        main = not self.trusted_depth
        path, payload = self.dtd.resolve(system_id, base, root=main)
        if self.trusted_depth >= 16:
            fail("OPENTRANS_DTD_DEPTH", "The original DTD dependency nesting exceeds its parser limit.")
        child = self.active_parsers[-1].ExternalEntityParserCreate(context)
        child.SetBase(path)
        self.active_parsers.append(child)
        self.trusted_depth += 1
        try:
            child.Parse(payload, True)
        finally:
            self.trusted_depth -= 1
            self.active_parsers.pop()
        return 1

    def start(self, name, attrs):
        if self.trusted_depth:
            fail("OPENTRANS_DTD_CONTENT", "The publisher DTD emitted document content.")
        self.node_count += 1
        if self.node_count > MAX_NODES or len(self.stack) >= MAX_DEPTH:
            fail("OPENTRANS_XML_COMPLEXITY", "The original XML exceeds the supported tree size or nesting depth.")
        if not self.stack:
            if self.root is not None:
                fail("OPENTRANS_XML_ROOT", "The original XML contains more than one root.")
            path = "/" + name + "[1]"
        else:
            counters = self.siblings[-1]
            counters[name] = counters.get(name, 0) + 1
            path = self.stack[-1]["sourcePath"] + "/" + name + "[" + str(counters[name]) + "]"
        node = {"name": name, "attributes": [[attrs[i], attrs[i + 1]] for i in range(0, len(attrs), 2)], "content": [], "sourcePath": path, "location": {"line": self.parser.CurrentLineNumber, "column": self.parser.CurrentColumnNumber, "byte": self.parser.CurrentByteIndex}}
        if self.stack:
            self.stack[-1]["content"].append(node)
        else:
            self.root = node
        self.stack.append(node)
        self.siblings.append({})

    def end(self, name):
        if not self.stack or self.stack[-1]["name"] != name:
            fail("OPENTRANS_XML_STACK", "The original parser element boundary is inconsistent.")
        self.validate(self.stack.pop())
        self.siblings.pop()

    def text(self, value):
        if self.trusted_depth or not value:
            return
        if not self.stack:
            if any(c not in XML_SPACE for c in value):
                fail("OPENTRANS_XML_TEXT", "Text outside the original XML root is not supported.")
            return
        content = self.stack[-1]["content"]
        if content and isinstance(content[-1], str):
            content[-1] += value
        else:
            content.append(value)

    def misc(self, node):
        if self.trusted_depth:
            return
        self.node_count += 1
        if self.node_count > MAX_NODES:
            fail("OPENTRANS_XML_COMPLEXITY", "The original XML exceeds the supported tree size.")
        if self.stack:
            self.stack[-1]["content"].append(node)
        elif self.root is None:
            self.prolog.append(node)
        else:
            self.epilog.append(node)

    def finding(self, code, path, message, **details):
        self.finding_count += 1
        if len(self.findings) < MAX_FINDINGS:
            row = {"severity": "error", "code": code, "path": path, "message": message, "rule": {"kind": "DTD", "source": self.dtd.main, "sha256": self.dtd.files[self.dtd.main]["sha256"]}}
            if details:
                row["details"] = details
            self.findings.append(row)

    def validate(self, node):
        name, path = node["name"], node["sourcePath"]
        declaration = self.declarations.get(name)
        if declaration is None:
            self.finding("OPENTRANS_DTD_ELEMENT", path, "The element is not declared by the selected original DTD.", element=name)
            return
        child_names = [c["name"] for c in node["content"] if isinstance(c, dict) and "name" in c]
        texts = [c for c in node["content"] if isinstance(c, str)]
        kind = declaration[0]
        if kind == xm.XML_CTYPE_EMPTY:
            if child_names or any(texts):
                self.finding("OPENTRANS_DTD_EMPTY", path, "The original DTD declares an empty element.")
        elif kind == xm.XML_CTYPE_MIXED:
            permitted = {child[2] for child in declaration[3]}
            if any(child not in permitted for child in child_names):
                self.finding("OPENTRANS_DTD_CONTENT", path, "An element is outside the original mixed-content declaration.", children=child_names)
        elif kind != xm.XML_CTYPE_ANY:
            if any(any(c not in XML_SPACE for c in text) for text in texts):
                self.finding("OPENTRANS_DTD_TEXT", path, "The original DTD permits child elements, not character data.")
            machine = self.models.get(name)
            if machine is None:
                machine = self.models[name] = ContentMachine(declaration)
            if not machine.accepts(child_names):
                self.finding("OPENTRANS_DTD_SEQUENCE", path, "Child elements do not match the original DTD order or cardinality.", children=child_names)
        declared = self.attributes.get(name, {})
        actual = dict(node["attributes"])
        for attr, value in actual.items():
            apath = path + "/@" + attr
            spec = declared.get(attr)
            if spec is None:
                self.finding("OPENTRANS_DTD_ATTRIBUTE", apath, "The attribute is not declared by the selected original DTD.")
                continue
            if spec["required"] and spec["default"] is not None and value != spec["default"]:
                self.finding("OPENTRANS_DTD_FIXED", apath, "The attribute differs from its fixed original DTD value.", expected=spec["default"])
            self.validate_attribute(spec["type"], value, apath)
        for attr, spec in declared.items():
            if attr not in actual:
                if spec["required"] and spec["default"] is None:
                    self.finding("OPENTRANS_DTD_REQUIRED", path + "/@" + attr, "The original DTD requires this attribute.")
                elif spec["default"] is not None:
                    self.validate_attribute(spec["type"], spec["default"], path + "/@" + attr)

    def validate_attribute(self, kind, value, path):
        if kind == "CDATA":
            return
        if kind.startswith("(") or kind.startswith("NOTATION("):
            terms = kind[kind.index("(") + 1:-1].split("|")
            if value not in terms:
                self.finding("OPENTRANS_DTD_ENUM", path, "The attribute is outside the original declared values.", allowed=terms)
            return
        plural = kind in ("IDREFS", "ENTITIES", "NMTOKENS")
        values = value.split() if plural else [value]
        if not values or any(not (is_nmtoken(item) if kind in ("NMTOKEN", "NMTOKENS") else is_name(item)) for item in values):
            self.finding("OPENTRANS_DTD_ATTRIBUTE_TYPE", path, "The attribute does not match its original XML name/token type.", type=kind)
            return
        if kind == "ID":
            if value in self.ids:
                self.finding("OPENTRANS_DTD_ID", path, "An XML ID is repeated.", firstPath=self.ids[value])
            else:
                self.ids[value] = path
        elif kind in ("IDREF", "IDREFS"):
            self.idrefs.extend((value, path) for value in values)
        elif kind in ("ENTITY", "ENTITIES"):
            for value in values:
                declared = self.entities.get(value)
                if not declared or not declared.get("notation"):
                    self.finding("OPENTRANS_DTD_ENTITY_ATTRIBUTE", path, "The attribute does not identify a declared unparsed entity.", entity=value)


    def layout(self):
        def names(model):
            result = []
            def walk(current):
                if current[0] == xm.XML_CTYPE_NAME and current[2] not in result:
                    result.append(current[2])
                for child in current[3]:
                    walk(child)
            walk(model)
            return result
        return {"schema": "stellar-forge.opentrans-dtd-layout.v1",
                "manifestSha256": self.dtd.manifest_sha256,
                "kind": self.dtd.kind,
                "dtdPath": self.dtd.main,
                "elements": {name: {"children": names(model),
                                    "contentType": model[0],
                                    "attributes": self.attributes.get(name, {})}
                             for name, model in self.declarations.items()}}

    def finish(self):
        if self.root is None or self.stack:
            fail("OPENTRANS_XML_INCOMPLETE", "The original XML did not complete its root element.")
        if self.root["name"] not in KINDS:
            fail("OPENTRANS_DOCUMENT_KIND", "Only the original openTRANS 1.0 order, response, dispatch and invoice documents are supported.", name=self.root["name"])
        if self.xml["version"] != "1.0":
            fail("OPENTRANS_XML_VERSION", "The selected openTRANS profile requires XML 1.0.")
        if self.doctype and self.doctype["name"] != self.root["name"]:
            self.finding("OPENTRANS_DTD_ROOT", self.root["sourcePath"], "The declared document type differs from the root element.")
        for value, path in self.idrefs:
            if value not in self.ids:
                self.finding("OPENTRANS_DTD_IDREF", path, "The XML ID reference has no declared ID in this document.", value=value)
        if self.finding_count > len(self.findings):
            self.findings.append({"severity": "error", "code": "OPENTRANS_DTD_FINDING_LIMIT", "path": "/", "message": "The original document has more DTD findings than the structured response limit.", "details": {"total": self.finding_count, "returned": len(self.findings)}})
        return {"schema": "stellar-forge.opentrans-raw.v1", "xml": self.xml, "doctype": self.doctype, "prolog": self.prolog, "root": self.root, "epilog": self.epilog}


class SelectedKind(Exception):
    def __init__(self, kind):
        self.kind = kind


def select_kind_parser():
    # Read only the original declaration/root prefix. This parser never opens
    # a DTD or expands an instance entity; the selected parser rereads the same
    # retained prefix using the one captured DTD for that actual document kind.
    parser = expat.ParserCreate()
    def selected(name):
        if name not in KINDS:
            fail("OPENTRANS_DOCUMENT_KIND", "The original document kind is unsupported.", name=name)
        raise SelectedKind(name)
    def doctype(name, system_id, public_id, internal):
        if internal:
            fail("OPENTRANS_INTERNAL_DTD", "Instance-defined DTD subsets are not part of the retained openTRANS source.")
        selected(name)
    parser.StartDoctypeDeclHandler = doctype
    parser.StartElementHandler = lambda name, attrs: selected(name)
    parser.ExternalEntityRefHandler = lambda *args: 0
    return parser


def parse_stream(stream, manifest_path):
    sniffer = select_kind_parser()
    digest = hashlib.sha256()
    total = 0
    prefix = b""
    pending = []
    document = None
    dtd = None
    while True:
        chunk = stream.read(64 * 1024)
        if not chunk:
            break
        if len(prefix) < 4:
            prefix = (prefix + chunk)[:4]
        total += len(chunk)
        if total > MAX_XML_BYTES:
            fail("OPENTRANS_XML_BYTES", "The original XML exceeds the supported 64 MiB intake size.", maximum=MAX_XML_BYTES)
        digest.update(chunk)
        if document is None:
            pending.append(chunk)
            try:
                sniffer.Parse(chunk, False)
            except SelectedKind as selected:
                dtd = PublisherDTD(manifest_path, selected.kind)
                document = OriginalXML(dtd)
                for retained in pending:
                    document.parser.Parse(retained, False)
                pending.clear()
        else:
            document.parser.Parse(chunk, False)
    if document is None:
        sniffer.Parse(b"", True)
        fail("OPENTRANS_XML_INCOMPLETE", "The original XML did not contain a supported root element.")
    document.parser.Parse(b"", True)
    raw = document.finish()
    encoding = raw["xml"]["encoding"]
    if not encoding:
        encoding = "UTF-16BE" if prefix.startswith(b"\\xfe\\xff") or prefix == b"\\x00<\\x00?" else "UTF-16LE" if prefix.startswith(b"\\xff\\xfe") or prefix == b"<\\x00?\\x00" else "UTF-8"
    return {"raw": raw, "layout": document.layout(), "findings": document.findings, "source": {"bytes": total, "sha256": digest.hexdigest(), "encoding": encoding}, "validation": {"schema": "stellar-forge.opentrans-dtd-validation.v1", "manifestSha256": dtd.manifest_sha256, "kind": dtd.kind, "dtd": {"path": dtd.main, "bytes": dtd.files[dtd.main]["bytes"], "sha256": dtd.files[dtd.main]["sha256"]}, "resolved": dtd.resolutions, "attributeDefaults": {element: {name: row["default"] for name, row in attributes.items() if row["default"] is not None} for element, attributes in document.attributes.items() if any(row["default"] is not None for row in attributes.values())}, "findings": document.finding_count, "nodes": document.node_count}}


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--manifest", required=True)
    arguments.add_argument("--describe", choices=sorted(KINDS))
    args = arguments.parse_args()
    try:
        if args.describe:
            import io
            parsed = parse_stream(io.BytesIO(('<' + args.describe + ' version="1.0"/>').encode("ascii")), Path(args.manifest))
            result = {"layout": parsed["layout"], "validation": parsed["validation"]}
        else:
            result = parse_stream(sys.stdin.buffer, Path(args.manifest))
        sys.stdout.write(json.dumps({"ok": True, "result": result}, ensure_ascii=False, separators=(",", ":")) + "\n")
        return 0
    except NativeError as error:
        sys.stdout.write(json.dumps({"ok": False, "error": {"code": error.code, "message": str(error), "details": error.details}}, ensure_ascii=False, separators=(",", ":")) + "\n")
        return 2
    except expat.ExpatError as error:
        sys.stdout.write(json.dumps({"ok": False, "error": {"code": "OPENTRANS_XML_SYNTAX", "message": str(error), "details": {"line": error.lineno, "column": error.offset, "expatCode": error.code}}}, ensure_ascii=False, separators=(",", ":")) + "\n")
        return 2
    except (OSError, ValueError, TypeError) as error:
        sys.stdout.write(json.dumps({"ok": False, "error": {"code": "OPENTRANS_SOURCE_RUNTIME", "message": str(error)}}, ensure_ascii=False, separators=(",", ":")) + "\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
