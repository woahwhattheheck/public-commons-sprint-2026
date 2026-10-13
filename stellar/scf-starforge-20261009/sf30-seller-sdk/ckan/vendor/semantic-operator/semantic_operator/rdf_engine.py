"""Retained-input RDF, SHACL, SPARQL and graph-difference operations.

The application owns workers, cancellation and publication. RDFLib owns syntax,
query evaluation and graph canonicalization; pySHACL owns validation.
"""
from __future__ import annotations

import contextlib
import contextvars
import csv
import hashlib
import html
import importlib.metadata
import io
import json
import re
import string
import sys
from collections import Counter, defaultdict, deque
from decimal import Decimal
from pathlib import Path
from urllib.parse import quote, urlsplit
from xml.sax import handler as sax_handler
from xml.sax.xmlreader import InputSource as XMLInputSource

import rdflib
from rdflib import BNode, Dataset, Graph, Literal, URIRef
from rdflib.compare import _TripleCanonicalizer, graph_diff
from rdflib.namespace import RDF, RDFS, SH, XSD
from rdflib.parser import PythonInputSource
from rdflib.plugins.parsers.jsonld import JsonLDParser
from rdflib.plugins.parsers.notation3 import RDFSink, SinkParser, sfloat
from rdflib.plugins.parsers.rdfxml import create_parser as create_rdfxml_parser
from rdflib.plugins.serializers.nt import _nt_row, _quoteLiteral
from rdflib.plugins.serializers.turtle import TurtleSerializer
from rdflib.plugins.sparql.algebra import translateQuery
from rdflib.plugins.sparql.parser import parseQuery
from rdflib.plugins.sparql.parserutils import CompValue
from pyparsing import ParseResults

SCHEMA = "commons-semantic-native-engine-result/1"
PROVENANCE_SCHEMA = "commons-semantic-provenance/1"
PINNED = {"rdflib": "7.6.0", "pyshacl": "0.40.1"}
# Capture this module at load time, before any job runs. Later source publication
# must not relabel a worker already using this loaded implementation.
_ENGINE_SOURCE_BYTES = Path(__file__).read_bytes()
ENGINE_SOURCE = {
    "path": "semantic_operator/rdf_engine.py",
    "sha256": hashlib.sha256(_ENGINE_SOURCE_BYTES).hexdigest(),
    "git_blob_sha1": hashlib.sha1(
        b"blob " + str(len(_ENGINE_SOURCE_BYTES)).encode("ascii") + b"\0" + _ENGINE_SOURCE_BYTES
    ).hexdigest(),
    "bytes": len(_ENGINE_SOURCE_BYTES),
    "captured": "module-load",
}
del _ENGINE_SOURCE_BYTES
RDF_FORMATS = {"turtle", "nt", "xml", "json-ld"}
ALLOWED_FORMATS = RDF_FORMATS | {"csv", "json"}
_NO_NETWORK = contextvars.ContextVar("commons_semantic_no_network", default=False)
_AUDIT_INSTALLED = False


class SemanticError(ValueError):
    """An explicit original-input, native capability or integrity error."""


def require(condition, message):
    if not condition:
        raise SemanticError(message)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode("utf-8")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def term(value):
    if value is None:
        return None
    if isinstance(value, URIRef):
        return {"type": "uri", "value": str(value)}
    if isinstance(value, BNode):
        return {"type": "bnode", "value": str(value)}
    if isinstance(value, Literal):
        result = {"type": "literal", "value": str(value)}
        if value.datatype:
            result["datatype"] = str(value.datatype)
        if value.language:
            result["xml:lang"] = value.language
        return result
    raise SemanticError("Unexpected native RDF term: " + type(value).__name__)


def triple_value(triple):
    return {name: term(value) for name, value in zip(("subject", "predicate", "object"), triple)}


def nt_line(triple):
    return _nt_row(triple)


class _LexicalTurtleSerializer(TurtleSerializer):
    def label(self, node, position):
        if isinstance(node, Literal):
            return _quoteLiteral(node)
        return super().label(node, position)


def turtle_bytes(graph):
    output = io.BytesIO()
    _LexicalTurtleSerializer(graph).serialize(output, encoding="utf-8")
    return output.getvalue()


def graph_bytes(graph):
    return "".join(sorted(nt_line(triple) for triple in graph)).encode("utf-8")


def term_key(value):
    return json.dumps(term(value), sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def native_versions():
    found = {name: importlib.metadata.version(name) for name in PINNED}
    require(found == PINNED, "Exact native versions required: " + json.dumps(PINNED)
            + "; found " + json.dumps(found))
    return found


def _network_audit(event, args):
    if _NO_NETWORK.get() and (
        event == "urllib.Request" or event == "http.client.connect"
        or event in {"socket.connect", "socket.connect_ex", "socket.getaddrinfo",
                     "socket.gethostbyname", "socket.gethostbyaddr"}
    ):
        raise SemanticError("Network access is disabled for retained-input semantic jobs")


@contextlib.contextmanager
def native_scope():
    """Process-local guards; the caller runs one isolated native job per worker."""
    global _AUDIT_INSTALLED
    if not _AUDIT_INSTALLED:
        sys.addaudithook(_network_audit)
        _AUDIT_INSTALLED = True
    token = _NO_NETWORK.set(True)
    previous = rdflib.NORMALIZE_LITERALS
    original_new = Literal.__new__

    def lexical_new(cls, lexical_or_value, lang=None, datatype=None, normalize=None):
        value = original_new(cls, lexical_or_value, lang=lang, datatype=datatype, normalize=False)
        # RDFLib unconditionally normalizes these two datatypes even when
        # normalize=False. Retain the RDF lexical string and the native parsed
        # value/ill-typed flag separately, using the original native term slots.
        if (isinstance(lexical_or_value, str) and not isinstance(lexical_or_value, Literal)
                and str(datatype) in {str(XSD.normalizedString), str(XSD.token)}
                and str(value) != lexical_or_value):
            exact = str.__new__(cls, lexical_or_value)
            for slot in Literal.__slots__:
                setattr(exact, slot, getattr(value, slot))
            return exact
        return value

    rdflib.NORMALIZE_LITERALS = False
    Literal.__new__ = staticmethod(lexical_new)
    try:
        yield
    finally:
        Literal.__new__ = staticmethod(original_new)
        rdflib.NORMALIZE_LITERALS = previous
        _NO_NETWORK.reset(token)


def absolute_iri(value, label="IRI"):
    require(isinstance(value, str) and value != "", label + " must be nonempty text")
    require(not re.search(r'[\x00-\x20<>"{}|\\^\x60]', value),
            label + " contains an unescaped forbidden character")
    try:
        parsed = urlsplit(value)
    except ValueError as exc:
        raise SemanticError(label + " is invalid: " + str(exc)) from exc
    require(bool(parsed.scheme) and bool(re.fullmatch(r"[A-Za-z][A-Za-z0-9+.-]*", parsed.scheme)),
            label + " must be absolute")
    return URIRef(value)


class _LexicalSink(RDFSink):
    def newLiteral(self, value, datatype=None, lang=None):
        return Literal(value, datatype=datatype, lang=lang if not datatype else None,
                       normalize=False)


class _LexicalTurtleParser(SinkParser):
    """Retain a bare numeric lexeme after the native Turtle parser recognizes it."""
    def nodeOrLiteral(self, text, start, result):
        previous = len(result)
        end = super().nodeOrLiteral(text, start, result)
        if end >= 0 and len(result) == previous + 1:
            value = result[-1]
            datatype = None
            if isinstance(value, bool):
                pass
            elif isinstance(value, int):
                datatype = XSD.integer
            elif isinstance(value, Decimal):
                datatype = XSD.decimal
            elif isinstance(value, sfloat):
                datatype = XSD.double
            if datatype is not None:
                token_start = end
                while token_start > start and text[token_start - 1] in "0123456789+-.eE":
                    token_start -= 1
                result[-1] = Literal(text[token_start:end], datatype=datatype, normalize=False)
        return end


class _CanonicalTracker(_TripleCanonicalizer):
    """Observe the pinned native canonicalizer without replacing its algorithm."""
    def __init__(self, graph):
        super().__init__(graph)
        self.node_map = {}

    def _canonicalize_bnodes(self, triple, labels):
        canonical_triple = tuple(super()._canonicalize_bnodes(triple, labels))
        for old, new in zip(triple, canonical_triple):
            if isinstance(old, BNode):
                self.node_map[old] = new
        yield from canonical_triple


def canonical(graph):
    tracker = _CanonicalTracker(graph)
    result = Graph()
    for prefix, namespace in graph.namespaces():
        result.bind(prefix, namespace)
    for triple in tracker.canonical_triples():
        result.add(triple)
    return result, tracker.node_map


def replace_nodes(triple, mapping):
    return tuple(mapping.get(node, node) for node in triple)


def scope_graph(graph, identity):
    canonical_graph, original_to_canonical = canonical(graph)
    prefix = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:32]
    scoped = {node: BNode("s" + prefix + "_" + str(node))
              for triple in canonical_graph for node in triple if isinstance(node, BNode)}
    result = Graph()
    for name, namespace in graph.namespaces():
        result.bind(name, namespace)
    for triple in canonical_graph:
        result.add(replace_nodes(triple, scoped))
    mapping = {old: scoped[new] for old, new in original_to_canonical.items()}
    return result, mapping


class _RejectEntities(sax_handler.EntityResolver):
    def resolveEntity(self, publicId, systemId):
        raise SemanticError("External XML entities are disabled")


class _RejectDTD(sax_handler.LexicalHandler):
    def startDTD(self, name, public_id, system_id):
        raise SemanticError("RDF/XML document type declarations are disabled")


class _GraphOnlyDataset(Dataset):
    def __init__(self, base):
        self.observing_named_graphs = False
        super().__init__(default_union=False, default_graph_base=base)
        self.observing_named_graphs = True

    def get_context(self, identifier, quoted=False, base=None):
        require(not self.observing_named_graphs,
                "The native JSON-LD parser selected a named graph. This graph-only "
                "job cannot flatten a dataset, including an empty named graph.")
        return super().get_context(identifier, quoted=quoted, base=base)


def no_remote_contexts(value):
    def context(context_value):
        if isinstance(context_value, str):
            raise SemanticError("JSON-LD contexts must be inline retained objects")
        if isinstance(context_value, list):
            for item in context_value:
                context(item)
        elif isinstance(context_value, dict):
            require("@import" not in context_value, "JSON-LD context @import is disabled")
            visit(context_value)
        elif context_value is not None:
            raise SemanticError("Invalid JSON-LD context type")

    def visit(node):
        if isinstance(node, dict):
            for key, item in node.items():
                if key == "@context":
                    context(item)
                elif key == "@import":
                    raise SemanticError("JSON-LD context @import is disabled")
                else:
                    visit(item)
        elif isinstance(node, list):
            for item in node:
                visit(item)
    visit(value)


def load_json(raw):
    def invalid_constant(value):
        raise SemanticError("Non-JSON numeric constant: " + value)

    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "Duplicate JSON object key: " + key)
            result[key] = value
        return result
    return json.loads(raw.decode("utf-8-sig"), parse_constant=invalid_constant,
                      object_pairs_hook=unique_object)


def parse_graph(raw, fmt, base):
    require(fmt in RDF_FORMATS, "This action requires a declared RDF graph format")
    graph = Graph()
    if fmt == "turtle":
        parser = _LexicalTurtleParser(_LexicalSink(graph), baseURI=base, turtle=True)
        parser.loadStream(io.BytesIO(raw))
        for prefix, namespace in parser._bindings.items():
            graph.bind(prefix, namespace)
    elif fmt == "nt":
        context = {}
        graph.parse(data=raw, format="nt", publicID=base, bnode_context=context)
        # Join original N-Triples labels to their native parsed nodes.
        labels = {value: BNode(label) for label, value in context.items()}
        retained = Graph()
        for triple in graph:
            retained.add(replace_nodes(triple, labels))
        graph = retained
    elif fmt == "xml":
        source = XMLInputSource(base)
        source.setPublicId(base)
        source.setByteStream(io.BytesIO(raw))
        parser = create_rdfxml_parser(source, graph)
        parser.setFeature(sax_handler.feature_external_ges, False)
        parser.setFeature(sax_handler.feature_external_pes, False)
        parser.setEntityResolver(_RejectEntities())
        parser.setProperty(sax_handler.property_lexical_handler, _RejectDTD())
        parser.getContentHandler().preserve_bnode_ids = True
        parser.parse(source)
    else:
        document = load_json(raw)
        no_remote_contexts(document)
        dataset = _GraphOnlyDataset(base)
        try:
            JsonLDParser().parse(PythonInputSource(document, system_id=base), dataset,
                                 base=base, version=1.1)
        finally:
            dataset.observing_named_graphs = False
        default_id = dataset.default_graph.identifier
        require(not any(g.identifier != default_id and len(g) for g in dataset.graphs()),
                "A named JSON-LD graph must be retained as a dataset")
        for triple in dataset.default_graph:
            graph.add(triple)
        for prefix, namespace in dataset.namespaces():
            graph.bind(prefix, namespace)
    for subject, predicate, obj in graph:
        require(isinstance(subject, (URIRef, BNode)) and isinstance(predicate, URIRef)
                and isinstance(obj, (URIRef, BNode, Literal)), "Non-RDF-1.1 graph term")
    return graph


def checked_query(text, prepare=True):
    require(isinstance(text, str) and text.strip(), "SPARQL text is required")
    parsed = parseQuery(text)
    require(len(parsed) == 2 and isinstance(parsed[1], CompValue)
            and parsed[1].name in {"SelectQuery", "AskQuery", "ConstructQuery", "DescribeQuery"},
            "Only native SELECT, ASK, CONSTRUCT and DESCRIBE queries are supported")
    seen = set()

    def walk(node):
        if isinstance(node, (CompValue, ParseResults, dict, list, tuple)):
            identity = id(node)
            if identity in seen:
                return
            seen.add(identity)
        if isinstance(node, CompValue):
            require(node.name not in {"DatasetClause", "ServiceGraphPattern"},
                    "SPARQL FROM and SERVICE are disabled for retained-input jobs")
            for child in node.values():
                walk(child)
        elif isinstance(node, dict):
            for child in node.values():
                walk(child)
        elif isinstance(node, (ParseResults, list, tuple)):
            for child in node:
                walk(child)
    walk(parsed)
    return parsed[1].name, translateQuery(parsed) if prepare else None


def guard_shapes(graph):
    for predicate in (SH.select, SH.ask, SH.construct):
        for value in graph.objects(None, predicate):
            require(isinstance(value, Literal), "SHACL SPARQL text must be an RDF literal")
            checked_query(str(value), prepare=False)
    require(not any(graph.triples((None, URIRef(str(SH) + "update"), None))),
            "SPARQL updates are disabled in SHACL sources")
    require(not any(graph.triples((None, URIRef(str(SH) + "js"), None))),
            "SHACL-JS declarations are not supported by this native profile")


def positive_integer(value, name, default, maximum=None, minimum=1):
    value = default if value is None else value
    require(type(value) is int and value >= minimum, name + " is outside its supported range")
    if maximum is not None:
        require(value <= maximum, name + " exceeds the supported maximum")
    return value


class Context:
    def __init__(self, job, input_paths, output_dir):
        require(isinstance(job, dict) and job.get("schema") == "commons-semantic-native-job/1",
                "Unknown native job schema")
        require(isinstance(job.get("job_id"), str) and job["job_id"], "A stable job_id is required")
        require(isinstance(job.get("inputs"), list), "Declared inputs are required")
        self.job = job
        self.parameters = job.get("parameters") or {}
        require(isinstance(self.parameters, dict), "Job parameters must be an object")
        self.inputs, self.raw, self.graphs = {}, {}, {}
        self.files, self.warnings = [], []
        self.output = Path(output_dir)
        self.output.mkdir(parents=True, exist_ok=True)
        require(not any(self.output.iterdir()), "The owned native output directory must be empty")
        for entry in job["inputs"]:
            require(isinstance(entry, dict), "Each input must be a declared object")
            key = entry.get("key")
            require(isinstance(key, str) and key and key not in self.inputs,
                    "Every input key must be unique and nonempty")
            require(entry.get("format") in ALLOWED_FORMATS,
                    "Unsupported format; named-graph datasets must not be flattened")
            require(key in input_paths, "A declared original local input is missing: " + key)
            path = Path(input_paths[key])
            require(path.is_absolute() and path.is_file(), "An absolute original file is required: " + key)
            raw = path.read_bytes()
            require(type(entry.get("bytes")) is int and len(raw) == entry["bytes"],
                    "Original input length changed: " + key)
            require(sha(raw) == entry.get("sha256"), "Original input SHA-256 changed: " + key)
            self.inputs[key] = dict(entry)
            self.raw[key] = raw

    def entry(self, key):
        require(key in self.inputs, "Undeclared input: " + str(key))
        return self.inputs[key]

    def source(self, key):
        return dict(self.entry(key))

    def base(self, key):
        entry = self.entry(key)
        candidate = entry.get("source_reference")
        if isinstance(candidate, str):
            try:
                return str(absolute_iri(candidate, "Source base"))
            except SemanticError:
                pass
        return "https://retained.invalid/sha256/" + entry["sha256"] + "/"

    def graph(self, key):
        if key not in self.graphs:
            entry = self.entry(key)
            self.graphs[key] = parse_graph(self.raw[key], entry["format"], self.base(key))
        return self.graphs[key]

    def write(self, name, body, media_type, role, title):
        require(Path(name).name == name and name not in {"", ".", ".."},
                "Native output names must be simple filenames")
        data = body.encode("utf-8") if isinstance(body, str) else body
        with (self.output / name).open("xb") as stream:
            stream.write(data)
            stream.flush()
        self.files.append({"path": name, "media_type": media_type, "role": role, "title": title})
        return sha(data)

    def json(self, name, value, role, title):
        return self.write(name, json_bytes(value), "application/json", role, title)

    def graph_files(self, graph, stem, nt_role="graph", turtle_role="turtle", title="RDF graph"):
        digest = self.write(stem + ".nt", graph_bytes(graph), "application/n-triples", nt_role,
                            title + " — complete N-Triples")
        self.write(stem + ".ttl", turtle_bytes(graph),
                   "text/turtle", turtle_role, title + " — Turtle")
        return digest

    def report(self, title, summary, sections=()):
        def render(value):
            return "<pre>" + html.escape(json.dumps(value, ensure_ascii=False, indent=2,
                                                    allow_nan=False)) + "</pre>"
        body = "<h1>" + html.escape(title) + "</h1>" + render(summary)
        for heading, value in sections:
            body += "<h2>" + html.escape(heading) + "</h2>" + render(value)
        document = ('<!doctype html><html lang="en"><meta charset="utf-8">'
                    '<meta name="viewport" content="width=device-width,initial-scale=1">'
                    '<title>' + html.escape(title) + '</title><style>'
                    'body{font:15px/1.5 system-ui;margin:2rem auto;padding:0 1rem;max-width:76rem;'
                    'color:#222;background:#fff}h1,h2{line-height:1.2}pre{white-space:pre-wrap;'
                    'overflow-wrap:anywhere;background:#f4f4f4;border:1px solid #ccc;padding:1rem}'
                    '</style><body>' + body + '</body></html>')
        self.write("report.html", document, "text/html; charset=utf-8", "report", title)


def graph_stats(graph):
    predicates, classes, languages, datatypes = Counter(), Counter(), Counter(), Counter()
    iris, blank_nodes, subjects = set(), set(), set()
    literals = 0
    for subject, predicate, obj in graph:
        subjects.add(subject)
        predicates[str(predicate)] += 1
        if predicate == RDF.type and isinstance(obj, URIRef):
            classes[str(obj)] += 1
        for value in (subject, predicate, obj):
            if isinstance(value, URIRef):
                iris.add(value)
            elif isinstance(value, BNode):
                blank_nodes.add(value)
        if isinstance(obj, Literal):
            literals += 1
            if obj.language:
                languages[obj.language] += 1
            if obj.datatype:
                datatypes[str(obj.datatype)] += 1
    counted = lambda counter: [{"value": key, "count": value}
                               for key, value in sorted(counter.items())]
    return {"triples": len(graph), "subjects": len(subjects), "unique_iris": len(iris),
            "blank_nodes": len(blank_nodes), "literal_objects": literals,
            "predicates": counted(predicates), "classes": counted(classes),
            "languages": counted(languages), "datatypes": counted(datatypes)}


def csv_rows(raw, delimiter=","):
    require(isinstance(delimiter, str) and len(delimiter) == 1
            and delimiter not in {'"', "\r", "\n", "\x00"},
            "CSV delimiter must be one declared non-quote character")
    reader = csv.reader(io.StringIO(raw.decode("utf-8-sig"), newline=""),
                        delimiter=delimiter, strict=True)
    try:
        headers = next(reader)
    except StopIteration:
        raise SemanticError("CSV requires an original header row")
    require(headers and all(isinstance(h, str) and h != "" for h in headers),
            "CSV original headers must be nonempty")
    require(len(set(headers)) == len(headers), "CSV duplicate original headers are ambiguous")
    previous_line = reader.line_num
    rows = []
    for ordinal, cells in enumerate(reader, 1):
        start_line = previous_line + 1
        previous_line = reader.line_num
        require(len(cells) == len(headers),
                "CSV row " + str(ordinal) + " has " + str(len(cells))
                + " cells; original header has " + str(len(headers)))
        rows.append({"row": ordinal, "physical_line_start": start_line,
                     "physical_line_end": reader.line_num, "values": dict(zip(headers, cells))})
    return headers, rows


def template_fields(template, headers):
    require(isinstance(template, str) and template != "", "A reviewed IRI template is required")
    result = []
    for literal, field, spec, conversion in string.Formatter().parse(template):
        require(not spec and conversion is None, "IRI templates do not support formatting or conversion")
        if field is not None:
            require(field in headers, "IRI template references an undeclared original header: " + str(field))
            result.append(field)
    return result


def template_iri(template, row, null_values):
    pieces = []
    for literal, field, spec, conversion in string.Formatter().parse(template):
        pieces.append(literal)
        if field is not None:
            value = row[field]
            require(value not in null_values, "IRI template source cell is explicitly null: " + field)
            pieces.append(quote(value, safe=""))
    return absolute_iri("".join(pieces), "Mapped IRI")


def reviewed_mapping(mapping, context):
    require(isinstance(mapping, dict) and isinstance(mapping.get("mapping_id"), str)
            and mapping["mapping_id"], "Every mapping needs its original mapping_id")
    positive_integer(mapping.get("revision"), "Mapping revision", 1)
    key = mapping.get("input_key")
    require(context.entry(key)["format"] == "csv", "A table mapping requires its original CSV input")
    headers, rows = csv_rows(context.raw[key], mapping.get("delimiter", ","))
    require(isinstance(mapping.get("null_values", []), list)
            and all(isinstance(v, str) for v in mapping.get("null_values", [])),
            "Mapping null_values must be exact original strings")
    null_values = set(mapping.get("null_values", []))
    template_fields(mapping.get("subject_template"), headers)
    classes = mapping.get("classes", [])
    require(isinstance(classes, list), "Mapping classes must be an explicit list")
    for value in classes:
        absolute_iri(value, "Mapped class")
    fields = mapping.get("fields", [])
    require(isinstance(fields, list), "Mapping fields must be a list")
    for field in fields:
        require(isinstance(field, dict) and field.get("column") in headers,
                "Mapping field must name an exact original header")
        absolute_iri(field.get("predicate"), "Mapped predicate")
        require(field.get("kind") in {"literal", "iri"}, "Mapping field kind must be literal or iri")
        datatype, language = field.get("datatype"), field.get("language")
        require(not (datatype and language), "An RDF literal cannot have both a datatype and language")
        if datatype:
            absolute_iri(datatype, "Literal datatype")
        if language:
            require(isinstance(language, str) and bool(re.fullmatch(r"[A-Za-z]+(?:-[A-Za-z0-9]+)*", language)),
                    "Invalid original language tag")
        if field["kind"] == "iri":
            require(not datatype and not language, "IRI fields do not have literal datatype/language rules")
            if field.get("iri_template") is not None:
                template_fields(field["iri_template"], headers)
        else:
            require(field.get("iri_template") is None, "A literal field cannot apply an IRI template")
    return headers, rows, null_values


def snapshot(context):
    parameters = context.parameters
    data_keys, mappings = parameters.get("data_keys", []), parameters.get("mappings", [])
    require(isinstance(data_keys, list) and len(set(data_keys)) == len(data_keys),
            "data_keys must be a unique ordered list")
    require(isinstance(mappings, list) and (data_keys or mappings),
            "Snapshot requires selected RDF sources or reviewed CSV mappings")
    require(len({m.get("mapping_id") for m in mappings if isinstance(m, dict)}) == len(mappings),
            "Mapping IDs must be unique within a snapshot")
    merged = Graph()
    origins = defaultdict(list)
    original_rows = []
    used_sources = {}
    skipped_null_fields = 0
    invalid_lexemes = 0
    for key in data_keys:
        source = context.source(key)
        used_sources[key] = source
        scoped, _ = scope_graph(context.graph(key), json.dumps(
            {name: source.get(name) for name in ("key", "source_id", "revision", "sha256")},
            sort_keys=True, separators=(",", ":")))
        for prefix, namespace in scoped.namespaces():
            merged.bind(prefix, namespace)
        for triple in scoped:
            merged.add(triple)
            origins[triple].append({"kind": "rdf", "input_key": key,
                                   "source_id": source.get("source_id"),
                                   "revision": source.get("revision"),
                                   "sha256": source["sha256"],
                                   "source_statement": triple_value(triple)})
            if isinstance(triple[2], Literal) and getattr(triple[2], "ill_typed", False):
                invalid_lexemes += 1
        if source["format"] == "json-ld":
            context.warnings.append(
                "JSON-LD uses the native JSON value-to-RDF conversion. Explicit typed string "
                "values retain their RDF lexical forms; JSON number token spelling and precision "
                "remain in the original source bytes and are not claimed as RDF string lexemes.")
    for mapping in mappings:
        key = mapping["input_key"]
        source = context.source(key)
        used_sources[key] = source
        headers, rows, null_values = reviewed_mapping(mapping, context)
        for row in rows:
            row_id = mapping["mapping_id"] + ":" + str(mapping.get("revision", 1)) + ":" + str(row["row"])
            original_rows.append({"id": row_id, "mapping_id": mapping["mapping_id"],
                                  "mapping_revision": mapping.get("revision", 1),
                                  "input_key": key, "source_id": source.get("source_id"),
                                  "source_revision": source.get("revision"),
                                  "source_sha256": source["sha256"], "headers": headers, **row})
            subject = template_iri(mapping["subject_template"], row["values"], null_values)
            common = {"kind": "csv", "input_key": key, "source_id": source.get("source_id"),
                      "revision": source.get("revision"), "sha256": source["sha256"],
                      "mapping_id": mapping["mapping_id"], "mapping_revision": mapping.get("revision", 1),
                      "row_id": row_id, "row": row["row"],
                      "physical_line_start": row["physical_line_start"],
                      "physical_line_end": row["physical_line_end"],
                      "subject_template": mapping["subject_template"]}
            for class_iri in mapping.get("classes", []):
                triple = (subject, RDF.type, absolute_iri(class_iri))
                merged.add(triple)
                origins[triple].append({**common, "rule": "declared class", "class": class_iri})
            for field_index, field in enumerate(mapping.get("fields", [])):
                value = row["values"][field["column"]]
                if value in null_values:
                    skipped_null_fields += 1
                    continue
                predicate = absolute_iri(field["predicate"])
                if field["kind"] == "iri":
                    obj = (template_iri(field["iri_template"], row["values"], null_values)
                           if field.get("iri_template") is not None else absolute_iri(value, "Original IRI cell"))
                else:
                    obj = Literal(value, datatype=URIRef(field["datatype"]) if field.get("datatype") else None,
                                  lang=field.get("language") or None, normalize=False)
                    if getattr(obj, "ill_typed", False):
                        invalid_lexemes += 1
                triple = (subject, predicate, obj)
                merged.add(triple)
                origins[triple].append({**common, "rule": "declared field", "field_index": field_index,
                                       "column": field["column"], "raw_cell": value,
                                       "predicate": field["predicate"], "kind": field["kind"],
                                       "datatype": field.get("datatype"), "language": field.get("language"),
                                       "iri_template": field.get("iri_template")})
    graph, node_map = canonical(merged)
    digest = context.graph_files(graph, "graph", title="Retained semantic snapshot")
    canonical_origins = defaultdict(list)
    for triple, values in origins.items():
        canonical_origins[replace_nodes(triple, node_map)].extend(values)
    provenance = {
        "schema": PROVENANCE_SCHEMA, "job_id": context.job["job_id"],
        "graph_sha256": digest, "graph_triples": len(graph),
        "canonicalization": "RDFLib 7.6.0 native graph canonicalization; labels are graph-scoped",
        "sources": [used_sources[key] for key in sorted(used_sources)],
        "mappings": mappings, "csv_rows": original_rows,
        "blank_nodes": [{"source_scoped": str(old), "snapshot": str(new)}
                        for old, new in sorted(node_map.items(), key=lambda item: str(item[0]))],
        "triples": [{**triple_value(triple), "ntriples": nt_line(triple).rstrip("\n"),
                     "origins": canonical_origins[triple]}
                    for triple in sorted(graph, key=nt_line)],
    }
    context.json("provenance.json", provenance, "provenance", "Complete original source and CSV row provenance")
    summary = {**graph_stats(graph), "source_count": len(used_sources), "mapping_count": len(mappings),
               "mapped_rows": len(original_rows), "null_fields_skipped": skipped_null_fields,
               "ill_typed_literal_occurrences": invalid_lexemes, "graph_sha256": digest,
               "provenance_complete": True, "native_outcome": "complete"}
    if invalid_lexemes:
        context.warnings.append("Ill-typed literal lexemes are retained unchanged for validation; count is "
                                + str(invalid_lexemes) + " source/mapping occurrences.")
    context.report("Semantic snapshot", summary, [("Original selected sources", provenance["sources"])])
    return summary


def inspect_source(context):
    key = context.parameters.get("input_key")
    source = context.source(key)
    fmt = source["format"]
    if fmt in RDF_FORMATS:
        graph, _ = canonical(context.graph(key))
        graph_sha = context.graph_files(graph, "inspection-graph", title="Complete inspected RDF graph")
        definitions = []
        terms = set(graph.subjects(RDF.type, RDFS.Class)) | set(graph.subjects(RDF.type, RDF.Property))
        terms |= set(graph.subjects(RDFS.label, None)) | set(graph.subjects(RDFS.comment, None))
        for value in sorted(terms, key=term_key):
            definitions.append({"term": term(value), "assertions": [
                triple_value(triple) for triple in sorted(graph.triples((value, None, None)), key=nt_line)]})
        result = {"schema": "commons-semantic-inspection/1", "source": source,
                  "kind": "rdf", "statistics": graph_stats(graph), "definitions": definitions,
                  "definitions_complete": True, "graph_sha256": graph_sha}
        summary = {"kind": "rdf", **result["statistics"], "definitions": len(definitions),
                   "graph_sha256": graph_sha, "native_outcome": "complete"}
    elif fmt == "csv":
        delimiter = context.parameters.get("delimiter", ",")
        headers, rows = csv_rows(context.raw[key], delimiter)
        profiles = [{"column": header, "empty_cells": sum(row["values"][header] == "" for row in rows),
                     "distinct_raw_values": len({row["values"][header] for row in rows}),
                     "maximum_characters": max((len(row["values"][header]) for row in rows), default=0)}
                    for header in headers]
        context.write("inspection-rows.jsonl",
                      "".join(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n" for row in rows),
                      "application/x-ndjson", "inspection", "Complete original CSV rows and physical line references")
        result = {"schema": "commons-semantic-inspection/1", "source": source, "kind": "csv",
                  "delimiter": delimiter, "headers": headers, "rows": len(rows), "columns": profiles,
                  "preview": rows[:50], "preview_limit": 50, "preview_truncated": len(rows) > 50,
                  "complete_rows_file": "inspection-rows.jsonl", "typing": "raw strings; no inferred coercions"}
        summary = {"kind": "csv", "rows": len(rows), "columns": len(headers), "native_outcome": "complete"}
    else:
        document = load_json(context.raw[key])
        result = {"schema": "commons-semantic-inspection/1", "source": source, "kind": "json",
                  "document": document, "document_complete": True}
        summary = {"kind": "json", "top_level_type": type(document).__name__,
                   "top_level_items": len(document) if isinstance(document, (dict, list)) else 1,
                   "native_outcome": "complete"}
    context.json("inspection.json", result, "inspection", "Complete original source inspection")
    context.report("Original source inspection", summary, [("Selected source", source)])
    return summary


def merge_selected(context, keys, role):
    require(isinstance(keys, list) and len(keys) == len(set(keys)), role + " keys must be unique")
    merged = Graph()
    for key in keys:
        source = context.source(key)
        scoped, _ = scope_graph(context.graph(key), role + ":" + json.dumps(
            {name: source.get(name) for name in ("key", "source_id", "revision", "sha256")},
            sort_keys=True, separators=(",", ":")))
        for prefix, namespace in scoped.namespaces():
            merged.bind(prefix, namespace)
        merged += scoped
    return merged


def validation(context):
    from pyshacl import validate
    from pyshacl.entrypoints import meta_validate
    from pyshacl.errors import ValidationFailure

    parameters = context.parameters
    graph_key = parameters.get("graph_key")
    graph = context.graph(graph_key)
    shape_keys, ontology_keys = parameters.get("shape_keys", []), parameters.get("ontology_keys", [])
    require(shape_keys, "Validation requires selected retained shape sources")
    shapes = merge_selected(context, shape_keys, "shapes")
    ontology = merge_selected(context, ontology_keys, "ontology")
    guard_shapes(shapes)
    guard_shapes(ontology)
    inference = parameters.get("inference", "none")
    require(inference in {"none", "rdfs", "owlrl", "both"}, "Unknown explicit inference profile")
    for name in ("allow_infos", "allow_warnings"):
        require(type(parameters.get(name, False)) is bool, name + " must be a boolean")
    # Ask the original native meta-validator for its report before the public
    # validate(meta_shacl=True) path would turn a shape failure into an exception.
    # Invalid shapes are a retained native outcome, never a claim about the data.
    shapes_valid, meta_report, meta_text = meta_validate(
        shapes, inference=inference, abort_on_first=False,
        allow_infos=parameters.get("allow_infos", False),
        allow_warnings=parameters.get("allow_warnings", False),
        advanced=False, js=False, do_owl_imports=False, inplace=False, debug=False,
    )
    phase = "data" if shapes_valid else "shapes"
    if shapes_valid:
        conforms, report_graph, report_text = validate(
            data_graph=graph, shacl_graph=shapes, ont_graph=ontology if ontology_keys else None,
            inference=inference, abort_on_first=False,
            allow_infos=parameters.get("allow_infos", False),
            allow_warnings=parameters.get("allow_warnings", False),
            meta_shacl=True, advanced=False, js=False, do_owl_imports=False,
            inplace=False, debug=False,
        )
    else:
        conforms, report_graph, report_text = None, meta_report, meta_text
    context.write("validation-report.txt", str(report_text), "text/plain; charset=utf-8",
                  "validation_report", "Complete native pySHACL report")
    if isinstance(report_graph, ValidationFailure):
        summary = {"native_outcome": "validation_failure", "conforms": None,
                   "validation_phase": phase, "shapes_valid": bool(shapes_valid),
                   "data_validation_performed": bool(shapes_valid),
                   "message": str(report_graph), "inference": inference,
                   "graph_sha256": context.entry(graph_key)["sha256"], "report_complete": False}
        context.json("findings.json", {"schema": "commons-semantic-findings/1", **summary,
                                      "findings": []}, "findings", "Native validation failure")
        context.report("Native SHACL validation failure", summary)
        return summary
    require(isinstance(report_graph, Graph), "The native validator returned no RDF report graph")
    report, report_node_map = canonical(report_graph)
    original_report_nodes = {new: old for old, new in report_node_map.items()}
    context.graph_files(report, "validation-report", "validation_report", "validation_report",
                        "Complete native SHACL report")
    roots = set(report.objects(None, SH.result))
    nodes = set(report.subjects(RDF.type, SH.ValidationResult)) | roots
    findings = []
    composition_suggestions = {}
    severity_counts = Counter()
    for node in sorted(nodes, key=term_key):
        values = lambda predicate: [term(value) for value in sorted(report.objects(node, predicate), key=term_key)]
        native_node = original_report_nodes.get(node, node)
        original_focus = list(report_graph.objects(native_node, SH.focusNode))
        linked_sources = []
        for source_key in (shape_keys if phase == "shapes" else [graph_key]):
            original_graph = context.graph(source_key)
            statements = set()
            for focus in original_focus:
                statements.update(original_graph.triples((focus, None, None)))
                statements.update(original_graph.triples((None, None, focus)))
            if statements:
                linked_sources.append({"source": context.source(source_key),
                                       "statements": [triple_value(t) for t in sorted(statements, key=nt_line)]})
        if phase == "shapes":
            for source_key, source_entry in context.inputs.items():
                if source_key in shape_keys or source_entry["format"] not in RDF_FORMATS:
                    continue
                definitions = set()
                for focus in original_focus:
                    if isinstance(focus, URIRef) and any(context.graph(source_key).triples((focus, SH.path, None))):
                        definitions.update(context.graph(source_key).triples((focus, None, None)))
                if definitions:
                    suggestion = composition_suggestions.setdefault(source_key, {
                        "input_key": source_key, "selected_role": source_entry.get("role"),
                        "source": context.source(source_key), "reason":
                        "This declared input contains a referenced property definition but is not in shape_keys.",
                        "suggested_review": "Select this unchanged companion input as part of the shape profile.",
                        "definitions": {}})
                    for definition in definitions:
                        suggestion["definitions"][nt_line(definition)] = triple_value(definition)
        severity = values(SH.resultSeverity)
        for value in severity:
            severity_counts[value["value"]] += 1
        findings.append({"id": term(node), "root_result": node in roots,
                         "focus_nodes": values(SH.focusNode), "paths": values(SH.resultPath),
                         "original_focus_nodes": [term(value) for value in sorted(original_focus, key=term_key)],
                         "original_sources": linked_sources,
                         "values": values(SH.value), "messages": values(SH.resultMessage),
                         "severity": severity, "source_shapes": values(SH.sourceShape),
                         "constraint_components": values(SH.sourceConstraintComponent),
                         "details": values(SH.detail),
                         "native_assertions": [triple_value(triple)
                                               for triple in sorted(report.triples((node, None, None)), key=nt_line)]})
    summary = {"native_outcome": ("conforms" if conforms else "nonconforming") if shapes_valid else "invalid_shapes",
               "conforms": bool(conforms) if shapes_valid else None,
               "validation_phase": phase, "shapes_valid": bool(shapes_valid),
               "data_validation_performed": bool(shapes_valid),
               "graph_sha256": context.entry(graph_key)["sha256"], "inference": inference,
               "allow_infos": parameters.get("allow_infos", False),
               "allow_warnings": parameters.get("allow_warnings", False),
               "root_results": len(roots), "all_results_including_details": len(findings),
               "severity_counts": dict(sorted(severity_counts.items())), "report_triples": len(report),
               "meta_shacl": True, "advanced": False, "js": False, "owl_imports": False,
               "report_complete": True,
               "shape_composition_suggestions": [
                   {**item, "definitions": [item["definitions"][key] for key in sorted(item["definitions"])]}
                   for _, item in sorted(composition_suggestions.items())]}
    context.json("findings.json", {"schema": "commons-semantic-findings/1", **summary,
                                  "sources": [context.source(key) for key in [graph_key] + shape_keys + ontology_keys],
                                  "findings": findings}, "findings", "Complete native validation findings")
    context.report("Native SHACL validation", summary, [("Complete findings", findings)])
    return summary


def query(context):
    parameters = context.parameters
    graph_key = parameters.get("graph_key")
    graph = context.graph(graph_key)
    query_text = parameters.get("query")
    kind, prepared = checked_query(query_text)
    row_limit = positive_integer(parameters.get("row_limit"), "Query row_limit", 10000)
    result = graph.query(prepared, use_store_provided=False)
    context.write("query.rq", query_text, "application/sparql-query; charset=utf-8",
                  "query_result", "Original reviewed SPARQL query")
    summary = {"native_outcome": "complete", "query_form": kind, "row_limit": row_limit,
               "graph_sha256": context.entry(graph_key)["sha256"], "remote_queries": False}
    if result.type == "SELECT":
        variables = [str(value) for value in result.vars]
        bindings = []
        observed = 0
        for native_row in result:
            observed += 1
            if observed > row_limit:
                break
            bindings.append({name: term(value) for name, value in zip(variables, native_row)
                             if value is not None})
        truncated = observed > row_limit
        summary.update({"rows_returned": len(bindings), "truncated": truncated,
                        "total_rows": None if truncated else len(bindings),
                        "observed_rows_at_least": observed, "result_complete": not truncated,
                        "native_outcome": "limited" if truncated else "complete",
                        "variables": variables})
        context.json("query-result.srj", {"head": {"vars": variables}, "results": {"bindings": bindings}},
                     "query_result", "Typed native SPARQL SELECT bindings")
        context.files[-1]["media_type"] = "application/sparql-results+json"
        output = io.StringIO(newline="")
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow([part for variable in variables for part in
                         (variable, variable + "__bound", variable + "__kind",
                          variable + "__datatype", variable + "__language")])
        for binding in bindings:
            row = []
            for variable in variables:
                value = binding.get(variable)
                row.extend([value.get("value", "") if value else "", "true" if value else "false",
                            value.get("type", "") if value else "",
                            value.get("datatype", "") if value else "",
                            value.get("xml:lang", "") if value else ""])
            writer.writerow(row)
        context.write("query-result.csv", output.getvalue(), "text/csv; charset=utf-8",
                      "query_result", "SELECT values with bound, kind, datatype and language columns")
        if truncated:
            context.warnings.append("SELECT output stopped after the reviewed row_limit. "
                                    "The native query was not rewritten; the complete total is unknown.")
    elif result.type == "ASK":
        summary.update({"answer": bool(result.askAnswer), "truncated": False, "result_complete": True})
        context.json("query-result.srj", {"head": {}, "boolean": bool(result.askAnswer)},
                     "query_result", "Native SPARQL ASK result")
        context.files[-1]["media_type"] = "application/sparql-results+json"
    elif result.type in {"CONSTRUCT", "DESCRIBE"}:
        output_graph, _ = canonical(result.graph)
        digest = context.graph_files(output_graph, "query-result", "query_result", "query_result",
                                     "Complete native SPARQL graph result")
        summary.update({"triples": len(output_graph), "result_sha256": digest,
                        "truncated": False, "result_complete": True,
                        "row_limit_applies": "SELECT bindings only"})
    else:
        raise SemanticError("Unexpected native query result type: " + str(result.type))
    context.json("query-summary.json", summary, "query_result", "Exact query completeness and original input")
    context.report("Native SPARQL result", summary)
    return summary


def term_from_json(value):
    require(isinstance(value, dict) and isinstance(value.get("value"), str),
            "Invalid retained provenance RDF term")
    if value.get("type") == "uri":
        return absolute_iri(value["value"], "Provenance IRI")
    if value.get("type") == "bnode":
        require(value["value"] != "", "A retained blank-node label cannot be empty")
        return BNode(value["value"])
    if value.get("type") == "literal":
        datatype, language = value.get("datatype"), value.get("xml:lang")
        require(not (datatype and language), "Ambiguous retained literal datatype/language")
        return Literal(value["value"], datatype=absolute_iri(datatype) if datatype else None,
                       lang=language, normalize=False)
    raise SemanticError("Unknown retained provenance term type")


def provenance_index(context, provenance_key, graph_key, graph, node_map):
    if provenance_key is None:
        return {}, None
    require(context.entry(provenance_key)["format"] == "json", "Provenance must be retained JSON")
    value = load_json(context.raw[provenance_key])
    require(value.get("schema") == PROVENANCE_SCHEMA, "Unknown retained provenance schema")
    require(value.get("graph_sha256") == context.entry(graph_key)["sha256"],
            "Provenance does not describe the exact selected snapshot bytes")
    require(value.get("graph_triples") == len(graph), "Retained provenance graph count changed")
    index = {}
    originals = value.get("triples")
    require(isinstance(originals, list) and len(originals) == len(graph),
            "Complete retained triple provenance is required")
    for item in originals:
        triple = tuple(term_from_json(item[name]) for name in ("subject", "predicate", "object"))
        require(triple in graph, "Retained provenance names a statement absent from its original graph")
        require(item.get("ntriples") == nt_line(triple).rstrip("\n"),
                "Retained provenance term and N-Triples identities disagree")
        require(isinstance(item.get("origins"), list), "Retained statement origins must be a list")
        identity = nt_line(replace_nodes(triple, node_map))
        require(identity not in index, "Duplicate retained triple provenance")
        index[identity] = item["origins"]
    return index, {"input_key": provenance_key, "sha256": context.entry(provenance_key)["sha256"],
                   "sources": value.get("sources", []), "mappings": value.get("mappings", [])}


def compare(context):
    parameters = context.parameters
    before_key, after_key = parameters.get("before_graph_key"), parameters.get("after_graph_key")
    before_original, after_original = context.graph(before_key), context.graph(after_key)
    before, before_map = canonical(before_original)
    after, after_map = canonical(after_original)
    # This is RDFLib's maintained graph difference, including its blank-node
    # canonicalization, not a string diff or a replacement matching algorithm.
    common, removed, added = graph_diff(before_original, after_original)
    context.graph_files(added, "additions", "additions", "additions", "Complete added RDF statements")
    context.graph_files(removed, "removals", "removals", "removals", "Complete removed RDF statements")
    before_provenance, before_source = provenance_index(
        context, parameters.get("before_provenance_key"), before_key, before_original, before_map)
    after_provenance, after_source = provenance_index(
        context, parameters.get("after_provenance_key"), after_key, after_original, after_map)
    indexes = {"before": before_provenance, "after": after_provenance}
    provenance_complete = before_source is not None and after_source is not None
    if not provenance_complete:
        context.warnings.append("Original provenance was not selected for both snapshots. "
                                "The graph difference is complete; some changed-source references are unavailable.")
    predicates = parameters.get("edge_predicates", [])
    require(isinstance(predicates, list), "edge_predicates must be an explicit list")
    selected_predicates = {absolute_iri(value, "Impact edge predicate") for value in predicates}
    depth = positive_integer(parameters.get("depth"), "Impact depth", 2, minimum=0)
    node_limit = positive_integer(parameters.get("node_limit"), "Impact node_limit", 100000)

    def node_key(value, side):
        if isinstance(value, URIRef):
            return ("iri", str(value))
        require(isinstance(value, BNode), "An impact node must be an IRI or blank node")
        return ("bnode", side, str(value))

    def node_json(key):
        if key[0] == "iri":
            return {"term": term(URIRef(key[1])), "snapshot_scope": "shared IRI"}
        return {"term": term(BNode(key[2])), "snapshot_scope": key[1]}

    changes = []
    seeds = set()
    changed_subjects = set()
    adjacency = defaultdict(list)
    predicate_uses = defaultdict(list)
    relationships = {}
    node_sources = defaultdict(dict)
    for side, graph in (("before", before), ("after", after)):
        for triple in graph:
            subject, predicate, obj = triple
            subject_key = node_key(subject, side)
            relationship_id = side + ":" + sha(nt_line(triple).encode("utf-8"))
            original_refs = indexes[side].get(nt_line(triple), [])
            relationship = {"id": relationship_id, "snapshot": side, **triple_value(triple),
                            "ntriples": nt_line(triple).rstrip("\n"), "origins": original_refs}
            relationships[relationship_id] = relationship
            predicate_uses[node_key(predicate, side)].append((subject_key, relationship_id, "predicate-use"))
            for origin in original_refs:
                identity = json.dumps(origin, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
                node_sources[subject_key][identity] = origin
            if isinstance(obj, (URIRef, BNode)):
                object_key = node_key(obj, side)
                for origin in original_refs:
                    identity = json.dumps(origin, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
                    node_sources[object_key][identity] = origin
                if not selected_predicates or predicate in selected_predicates:
                    adjacency[subject_key].append((object_key, relationship_id, "outgoing"))
                    adjacency[object_key].append((subject_key, relationship_id, "incoming"))
    for side, kind, graph in (("before", "removed", removed), ("after", "added", added)):
        for triple in sorted(graph, key=nt_line):
            subject, predicate, obj = triple
            subject_key = node_key(subject, side)
            seeds.add(subject_key)
            changed_subjects.add(subject_key)
            if isinstance(obj, (URIRef, BNode)):
                seeds.add(node_key(obj, side))
            changes.append({"change": kind, "snapshot": side, **triple_value(triple),
                            "ntriples": nt_line(triple).rstrip("\n"),
                            "origins": indexes[side].get(nt_line(triple), [])})
    ordered_seeds = sorted(seeds)
    selected_seeds = ordered_seeds[:node_limit]
    visited = {key: 0 for key in selected_seeds}
    reasons = {key: [{"kind": "changed statement"}] for key in selected_seeds}
    queue = deque(selected_seeds)
    observed_candidates = set(seeds)
    used_relationships = set()
    truncated = len(seeds) > node_limit
    while queue:
        current = queue.popleft()
        distance = visited[current]
        if distance >= depth:
            continue
        neighbors = adjacency.get(current, []) + predicate_uses.get(current, [])
        for neighbor, relationship_id, direction in sorted(neighbors, key=lambda entry: (entry[0], entry[1], entry[2])):
            observed_candidates.add(neighbor)
            used_relationships.add(relationship_id)
            if neighbor in visited:
                continue
            if len(visited) >= node_limit:
                truncated = True
                continue
            visited[neighbor] = distance + 1
            reasons[neighbor] = [{"kind": direction, "from": node_json(current),
                                  "relationship_id": relationship_id}]
            queue.append(neighbor)
    affected = [{**node_json(key), "distance": visited[key], "changed_subject": key in changed_subjects,
                 "reasons": reasons[key], "origins": [node_sources[key][identity]
                                                    for identity in sorted(node_sources[key])]}
                for key in sorted(visited, key=lambda value: (visited[value], value))]
    context.write("changes.jsonl",
                  "".join(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n" for item in changes),
                  "application/x-ndjson", "impact", "Complete changed statements and original source references")
    context.write("impact-relationships.jsonl",
                  "".join(json.dumps(relationships[key], ensure_ascii=False, sort_keys=True) + "\n"
                          for key in sorted(used_relationships)),
                  "application/x-ndjson", "impact", "Relationships actually traversed by the selected impact analysis")
    summary = {"native_outcome": "limited_impact" if truncated else "complete",
               "before_triples": len(before_original), "after_triples": len(after_original),
               "common_triples": len(common), "added_triples": len(added), "removed_triples": len(removed),
               "equivalent": not added and not removed, "graph_difference_complete": True,
               "before_sha256": context.entry(before_key)["sha256"],
               "after_sha256": context.entry(after_key)["sha256"],
               "changed_subjects": len(changed_subjects), "seed_nodes": len(seeds),
               "impact_nodes": len(affected), "impact_depth": depth, "impact_node_limit": node_limit,
               "impact_truncated": truncated,
               "impact_total_within_depth": None if truncated else len(affected),
               "observed_candidate_nodes_at_least": len(observed_candidates),
               "traversed_relationships": len(used_relationships),
               "edge_predicates": sorted(str(value) for value in selected_predicates),
               "provenance_complete": provenance_complete,
               "direction": "incoming and outgoing selected resource edges, plus use of a visited predicate IRI",
               "blank_node_scope": "separate before/after graph scope; IRIs are shared identifiers"}
    context.json("impact.json", {"schema": "commons-semantic-impact/1", **summary,
                                "before_provenance": before_source, "after_provenance": after_source,
                                "nodes": affected}, "impact", "Source-linked changed-subject and relationship impact")
    context.report("Native semantic comparison", summary,
                   [("Changed statement preview (first 50; changes.jsonl is complete)", changes[:50])])
    return summary


def execute(job: dict, input_paths: dict[str, Path], output_dir: Path) -> dict:
    """Execute one already retained job into its fresh owned output directory.

    Caller-added workspace, actor, operation, storage and resource-limit fields
    are preserved by the caller; this engine neither interprets nor rewrites them.
    """
    if isinstance(job, dict) and job.get("schema") == "commons-semantic-native-job/2":
        from .dataset_engine import execute as execute_dataset
        return execute_dataset(job, input_paths, output_dir)
    require(not isinstance(job, dict) or job.get("parameters", {}).get("data_model") != "dataset",
            "Dataset operations require the version 2 native job contract")
    versions = native_versions()
    with native_scope():
        context = Context(job, input_paths, output_dir)
        action = job.get("action")
        operations = {"inspect": inspect_source, "snapshot": snapshot, "validate": validation,
                      "query": query, "compare": compare}
        require(action in operations, "Unknown semantic native action")
        summary = operations[action](context)
        return {"schema": SCHEMA, "action": action,
                "summary": {**summary, "engine_versions": versions,
                            "engine_source_sha256": ENGINE_SOURCE["sha256"]},
                "engine_source": dict(ENGINE_SOURCE),
                "files": context.files, "warnings": list(dict.fromkeys(context.warnings))}
