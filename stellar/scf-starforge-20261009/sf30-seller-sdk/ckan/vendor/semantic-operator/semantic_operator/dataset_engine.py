"""Whole-dataset semantics over the original retained-input RDF engine.

RDFLib 7.6.0 parses and queries; PyLD 3.3.0 supplies URDNA2015.  Empty graph
inventory is retained separately and bound into the dataset identity.  This
module never opens a remote source, creates a workspace, or edits a source.
"""
from __future__ import annotations

import copy
import hashlib
import importlib.metadata
import io
import json
import re
from collections import Counter, defaultdict, deque
from pathlib import Path

from rdflib import BNode, ConjunctiveGraph, Dataset, Graph, Literal, URIRef
from rdflib.namespace import RDF, XSD
from rdflib.parser import InputSource, PythonInputSource
from rdflib.plugins.parsers.jsonld import JsonLDParser
from rdflib.plugins.parsers.nquads import NQuadsParser
from rdflib.plugins.parsers.trig import TrigSinkParser
from pyld.canon import URDNA2015
from pyld.nquads import serialize_nquad

from . import rdf_engine as native

SCHEMA = "commons-semantic-native-engine-result/2"
JOB_SCHEMA = "commons-semantic-native-job/2"
CATALOG_SCHEMA = "commons-semantic-graph-catalog/1"
PROVENANCE_SCHEMA = "commons-semantic-dataset-provenance/1"
CANONICALIZATION = {"algorithm": "URDNA2015", "implementation": "PyLD", "version": "3.3.0",
                    "profile": "commons-semantic-dataset-inventory/1"}
DATASET_FORMATS = set(native.RDF_FORMATS) | {"trig", "nquads"}
ALLOWED_FORMATS = DATASET_FORMATS | {"csv", "json"}
INTERNAL_DEFAULT = URIRef("urn:commons:semantic:dataset-default")
RDFLIB_DEFAULT = URIRef("urn:x-rdflib:default")
RESERVED_GRAPH_NAMES = {INTERNAL_DEFAULT, RDFLIB_DEFAULT}
_SOURCE_BYTES = Path(__file__).read_bytes()
ENGINE_SOURCE = {
    "path": "semantic_operator/dataset_engine.py",
    "sha256": hashlib.sha256(_SOURCE_BYTES).hexdigest(),
    "git_blob_sha1": hashlib.sha1(
        b"blob " + str(len(_SOURCE_BYTES)).encode("ascii") + b"\0" + _SOURCE_BYTES).hexdigest(),
    "bytes": len(_SOURCE_BYTES), "captured": "module-load",
}
SemanticError, require = native.SemanticError, native.require
sha, json_bytes = native.sha, native.json_bytes


def _stable(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def graph_selector(value):
    return {"type": "default"} if value is None else native.term(value)


def graph_key(value):
    return _stable(graph_selector(value))


def selector_term(value, *, named_only=False):
    require(isinstance(value, dict), "A graph selector must be an object")
    kind = value.get("type")
    if kind == "default":
        require(set(value) == {"type"} and not named_only, "Default graph is not a named graph selector")
        return None
    require(kind in {"uri", "bnode"} and set(value) == {"type", "value"},
            "A graph selector must be default, uri, or bnode")
    raw = value.get("value")
    require(isinstance(raw, str) and raw, "A graph selector requires a value")
    if kind == "uri":
        result = native.absolute_iri(raw, "Named graph IRI")
        require(result not in RESERVED_GRAPH_NAMES,
                "Named graph collides with a reserved native default-graph identifier: " + raw)
        return result
    require(not raw.startswith("_:") and not re.search(r"[\s<>{}\"\\]", raw),
            "Blank graph selectors use the retained label without '_:'")
    return BNode(raw)


def _term(value):
    if isinstance(value, URIRef):
        return native.absolute_iri(str(value), "RDF IRI")
    if isinstance(value, BNode):
        require(bool(str(value)), "Blank RDF identifiers must be nonempty")
        return value
    if isinstance(value, Literal):
        # RDF 1.1 simple literals denote xsd:string. Language tags compare
        # case-insensitively; source spelling remains in the retained input.
        if value.language:
            return Literal(str(value), lang=value.language.lower(), normalize=False)
        datatype = native.absolute_iri(str(value.datatype), "Literal datatype") if value.datatype else XSD.string
        return Literal(str(value), datatype=datatype, normalize=False)
    raise SemanticError("Only RDF 1.1 terms are supported in retained datasets")


def normalized_quad(quad):
    require(isinstance(quad, (tuple, list)) and len(quad) == 4, "An RDF quad has four terms")
    s, p, o, g = quad
    require(isinstance(s, (URIRef, BNode)) and isinstance(p, URIRef)
            and isinstance(o, (URIRef, BNode, Literal))
            and (g is None or isinstance(g, (URIRef, BNode))),
            "Generalized RDF and quoted triples are not supported")
    require(g not in RESERVED_GRAPH_NAMES, "Named graph collides with a reserved native identifier")
    return _term(s), _term(p), _term(o), _term(g) if g is not None else None


class DatasetValue:
    def __init__(self, quads=(), graphs=None):
        self.quads = {normalized_quad(q) for q in quads}
        self.graphs = {None} | set(graphs or ()) | {q[3] for q in self.quads}
        for graph in self.graphs:
            if graph is not None:
                require(isinstance(graph, (URIRef, BNode)) and graph not in RESERVED_GRAPH_NAMES,
                        "A retained named graph must have a nonreserved RDF IRI or blank-node name")
                _term(graph)
        self.quad_origins = defaultdict(list)
        self.graph_origins = defaultdict(list)

    def ordinary_graph(self, graphs):
        selected = set(graphs)
        graph = Graph()
        for s, p, o, g in self.quads:
            if g in selected:
                graph.add((s, p, o))
        return graph


def _pyld_term(value):
    if isinstance(value, URIRef):
        return {"type": "IRI", "value": str(value)}
    if isinstance(value, BNode):
        return {"type": "blank node", "value": "_:" + str(value)}
    result = {"type": "literal", "value": str(value),
              "datatype": str(RDF.langString if value.language else (value.datatype or XSD.string))}
    if value.language:
        result["language"] = value.language.lower()
    return result


def _pyld_quad(quad):
    s, p, o, g = quad
    result = {"subject": _pyld_term(s), "predicate": _pyld_term(p), "object": _pyld_term(o)}
    if g is not None:
        result["name"] = _pyld_term(g)
    return result


def nq_line(quad):
    return serialize_nquad(_pyld_quad(quad))


def quad_value(quad):
    return {**native.triple_value(quad[:3]), "graph": graph_selector(quad[3])}


def _replace_quad(quad, mapping):
    return tuple(mapping.get(value, value) if isinstance(value, BNode) else value for value in quad)


def _dedup_origins(values):
    return [value for _, value in sorted({_stable(value): value for value in values}.items())]


def _inventory_markers(value):
    """Represent only otherwise-unrepresented blank graph membership in labeling."""
    counts = Counter(q[3] for q in value.quads)
    empty_names = [g for g in value.graphs if isinstance(g, BNode) and counts[g] == 0]
    if not empty_names:
        return set()
    iris = {str(v) for q in value.quads for v in q if isinstance(v, URIRef)}
    iris.update(str(g) for g in value.graphs if isinstance(g, URIRef))
    iris.update(str(q[2].datatype) for q in value.quads
                if isinstance(q[2], Literal) and q[2].datatype is not None)
    index = 0
    while True:
        base = "urn:commons:semantic:empty-graph-inventory:" + str(index)
        predicate, obj, graph = (URIRef(base + suffix) for suffix in (":member", ":Graph", ":graph"))
        if not {str(predicate), str(obj), str(graph)} & iris:
            break
        index += 1
    return {(name, predicate, obj, graph) for name in empty_names}


def canonical_dataset(value):
    """URDNA2015 with the explicitly recorded complete-inventory labeling profile.

    Empty blank graph membership must distinguish otherwise quad-symmetric
    nodes. Collision-free auxiliary statements enter only the native labeling
    problem; they are removed before serializing any retained RDF artifact.
    """
    markers = _inventory_markers(value)
    labeling_quads = value.quads | markers
    blank_nodes = {v for q in labeling_quads for v in q if isinstance(v, BNode)}
    blank_nodes.update(g for g in value.graphs if isinstance(g, BNode))
    # PyLD's pinned implementation treats its own output prefix specially.
    # Scope every supplied label away from that prefix before calling it.
    temporary = {old: BNode("input" + str(i)) for i, old in enumerate(sorted(blank_nodes, key=str))}
    dataset = defaultdict(list)
    for quad in sorted(labeling_quads, key=nq_line):
        s, p, o, g = _replace_quad(quad, temporary)
        name = "@default" if g is None else ("_:" + str(g) if isinstance(g, BNode) else str(g))
        dataset[name].append({"subject": _pyld_term(s), "predicate": _pyld_term(p), "object": _pyld_term(o)})
    algorithm = URDNA2015()
    output = algorithm.main(copy.deepcopy(dict(dataset)), {"format": "application/n-quads"})
    mapping = {}
    for old, interim in temporary.items():
        key = "_:" + str(interim)
        require(algorithm.canonical_issuer.has_id(key),
                "A graph-inventory blank node was omitted from the native labeling problem")
        mapping[old] = BNode(algorithm.canonical_issuer.get_id(key)[2:])
    check_bytes = "".join(sorted(nq_line(_replace_quad(q, mapping)) for q in labeling_quads)).encode("utf-8")
    require(check_bytes == output.encode("utf-8"), "Native dataset canonicalization map/output disagreed")
    canonical = DatasetValue((_replace_quad(q, mapping) for q in value.quads),
                             [mapping.get(g, g) for g in value.graphs])
    canonical_bytes = "".join(sorted(nq_line(q) for q in canonical.quads)).encode("utf-8")
    for q, origins in value.quad_origins.items():
        canonical.quad_origins[_replace_quad(q, mapping)].extend(origins)
    for g, origins in value.graph_origins.items():
        canonical.graph_origins[mapping.get(g, g)].extend(origins)
    return canonical, mapping, canonical_bytes


def dataset_identity(value, canonical_bytes):
    inventory = [graph_selector(g) for g in sorted(value.graphs, key=graph_key)]
    return sha(b"commons-semantic-dataset-identity/1\n" + canonical_bytes + b"\0" + json_bytes(inventory))


def graph_catalog(value, canonical_bytes):
    counts = Counter(q[3] for q in value.quads)
    return {
        "schema": CATALOG_SCHEMA, "data_model": "dataset",
        "canonicalization": dict(CANONICALIZATION),
        "dataset_sha256": dataset_identity(value, canonical_bytes),
        "nquads_sha256": sha(canonical_bytes), "quad_count": len(value.quads),
        "graphs": [{"graph": graph_selector(g), "quad_count": counts[g], "empty": counts[g] == 0,
                    "origins": _dedup_origins(value.graph_origins[g])}
                   for g in sorted(value.graphs, key=graph_key)],
    }


def _trig_bytes(value):
    blocks = []
    grouped = defaultdict(list)
    for quad in value.quads:
        grouped[quad[3]].append(quad[:3])
    for g in sorted(value.graphs, key=graph_key):
        title = "" if g is None else (("_:" + str(g)) if isinstance(g, BNode) else "<" + str(g) + ">")
        triples = sorted(grouped[g], key=native.nt_line)
        # Full native N-Triples statements are a valid TriG body. Using them
        # avoids Turtle numeric shorthand rewriting a retained literal lexeme.
        blocks.append(title + " {\n" + "".join("  " + native.nt_line(t) for t in triples) + "}\n")
    return ("\n".join(blocks)).encode("utf-8")


class _TrackedSink(native._LexicalSink):
    named_candidate = None

    def newGraph(self, identifier):
        if self.named_candidate is not None:
            require(identifier not in RESERVED_GRAPH_NAMES,
                    "An explicit named graph uses a reserved native default-graph identifier")
        graph = super().newGraph(identifier)
        self.graph.store.add_graph(graph)
        return graph


class _LexicalTrigParser(TrigSinkParser, native._LexicalTurtleParser):
    def graph(self, text, start):
        self._store.named_candidate = None
        return super().graph(text, start)

    def labelOrSubject(self, text, start, result):
        previous = len(result)
        end = super().labelOrSubject(text, start, result)
        self._store.named_candidate = result[-1] if end >= 0 and len(result) > previous else None
        return end


class _LocalJSONDataset(Dataset):
    def __init__(self):
        self.observe_names = False
        super().__init__(default_union=False)
        self.observe_names = True

    def get_context(self, identifier, *args, **kwargs):
        if self.observe_names:
            require(identifier not in RESERVED_GRAPH_NAMES,
                    "JSON-LD named graph uses a reserved native default-graph identifier")
        graph = super().get_context(identifier, *args, **kwargs)
        if self.observe_names:
            self.store.add_graph(graph)
        return graph


class _ObservedNQuadsParser(NQuadsParser):
    def parseline(self, bnode_context=None):
        if not getattr(self, "_names_observed", False):
            original = self.sink.get_context
            def named(identifier, *args, **kwargs):
                require(identifier not in RESERVED_GRAPH_NAMES,
                        "N-Quads named graph uses a reserved native default-graph identifier")
                graph = original(identifier, *args, **kwargs)
                self.sink.store.add_graph(graph)
                return graph
            self.sink.get_context = named
            self._names_observed = True
        return super().parseline(bnode_context)


def _collect_store(store, default_identifier, labels=None):
    labels = labels or {}
    graphs = {None}
    quads = set()
    # Store contexts expose registered empty graphs without Dataset.graphs()
    # inventing an extra sentinel context when its default graph was rebound.
    for context in store.contexts():
        identifier = context.identifier
        name = None if identifier == default_identifier else labels.get(identifier, identifier)
        if name is not None:
            require(name not in RESERVED_GRAPH_NAMES, "Ambiguous native default/named graph identity")
        graphs.add(name)
        for s, p, o in context:
            quads.add((labels.get(s, s), p, labels.get(o, o), name))
    return DatasetValue(quads, graphs)


def parse_dataset(raw, fmt, base):
    require(fmt in DATASET_FORMATS, "A declared RDF dataset or graph format is required")
    if fmt in native.RDF_FORMATS - {"json-ld"}:
        graph = native.parse_graph(raw, fmt, base)
        return DatasetValue((s, p, o, None) for s, p, o in graph)
    if fmt == "trig":
        root = Graph(identifier=INTERNAL_DEFAULT)
        joined = ConjunctiveGraph(store=root.store, identifier=INTERNAL_DEFAULT)
        joined.default_context = root
        parser = _LexicalTrigParser(_TrackedSink(joined), baseURI=base, turtle=True)
        parser.loadStream(io.BytesIO(raw))
        return _collect_store(root.store, INTERNAL_DEFAULT)
    if fmt == "nquads":
        root = Graph(identifier=INTERNAL_DEFAULT)
        source = InputSource(base)
        source.setPublicId(base)
        source.setByteStream(io.BytesIO(raw))
        labels = {}
        parsed = _ObservedNQuadsParser().parse(source, root, bnode_context=labels)
        original_labels = {node: BNode(label) for label, node in labels.items()}
        return _collect_store(parsed.store, INTERNAL_DEFAULT, original_labels)
    document = native.load_json(raw)
    native.no_remote_contexts(document)
    parsed = _LocalJSONDataset()
    JsonLDParser().parse(PythonInputSource(document, system_id=base), parsed,
                         base=base, version=1.1, generalized_rdf=False, skolemize=False)
    return _collect_store(parsed.store, parsed.default_graph.identifier)


def attach_catalog(raw_value, raw_nquads, catalogue):
    require(isinstance(catalogue, dict) and catalogue.get("schema") == CATALOG_SCHEMA
            and catalogue.get("data_model") == "dataset", "Unknown companion graph catalogue")
    require(catalogue.get("canonicalization") == CANONICALIZATION,
            "Companion catalogue uses a different canonicalization contract")
    require(catalogue.get("nquads_sha256") == sha(raw_nquads),
            "Companion catalogue does not bind these exact N-Quads bytes")
    require(type(catalogue.get("quad_count")) is int and catalogue["quad_count"] == len(raw_value.quads),
            "Companion catalogue quad count differs from the parsed source")
    rows = catalogue.get("graphs")
    require(isinstance(rows, list) and rows, "Complete companion graph inventory is required")
    names, counts = [], Counter(q[3] for q in raw_value.quads)
    origins = {}
    for row in rows:
        require(isinstance(row, dict), "Invalid companion graph row")
        name = selector_term(row.get("graph"))
        require(name not in names, "Duplicate companion graph identity")
        require(type(row.get("quad_count")) is int and row["quad_count"] == counts[name],
                "Companion graph count differs from its source quads")
        require(type(row.get("empty")) is bool and row["empty"] == (counts[name] == 0),
                "Companion graph empty flag disagrees with its count")
        require(isinstance(row.get("origins", []), list)
                and all(isinstance(o, dict) for o in row.get("origins", [])),
                "Companion graph origins must be retained metadata objects")
        names.append(name)
        origins[name] = row.get("origins", [])
    require(None in names and raw_value.graphs <= set(names),
            "Companion catalogue omits the default graph or represented graph membership")
    raw_value.graphs = set(names)
    for name in names:
        raw_value.graph_origins[name] = origins[name]
    canonical, _, canonical_bytes = canonical_dataset(raw_value)
    require(canonical_bytes == raw_nquads, "Companion requires canonical N-Quads in its recorded byte form")
    canonical_names = [graph_selector(g) for g in sorted(canonical.graphs, key=graph_key)]
    require([r["graph"] for r in rows] == canonical_names,
            "Companion graph inventory is not in its exact canonical identity/order")
    require(catalogue.get("dataset_sha256") == dataset_identity(canonical, canonical_bytes),
            "Companion dataset digest does not bind the complete graph inventory")
    return canonical, canonical_bytes


class Context(native.Context):
    def __init__(self, job, input_paths, output_dir):
        require(isinstance(job, dict) and job.get("schema") == JOB_SCHEMA, "Unknown dataset native job schema")
        require(isinstance(job.get("job_id"), str) and job["job_id"], "A stable job_id is required")
        require(isinstance(job.get("inputs"), list), "Declared inputs are required")
        self.job, self.parameters = job, job.get("parameters") or {}
        require(isinstance(self.parameters, dict) and self.parameters.get("data_model") == "dataset",
                "Dataset jobs require an explicit data_model='dataset'")
        self.inputs, self.raw, self.graphs, self.datasets = {}, {}, {}, {}
        self.files, self.warnings = [], []
        self.output = Path(output_dir)
        self.output.mkdir(parents=True, exist_ok=True)
        require(not any(self.output.iterdir()), "The owned native output directory must be empty")
        for entry in job["inputs"]:
            require(isinstance(entry, dict), "Each input must be a declared object")
            key = entry.get("key")
            require(isinstance(key, str) and key and key not in self.inputs, "Input keys must be unique text")
            require(entry.get("format") in ALLOWED_FORMATS, "Unsupported declared dataset input format")
            require(key in input_paths, "Missing declared original local input: " + key)
            path = Path(input_paths[key])
            require(path.is_absolute() and path.is_file(), "An absolute original input file is required: " + key)
            raw = path.read_bytes()
            require(type(entry.get("bytes")) is int and len(raw) == entry["bytes"],
                    "Original input length changed: " + key)
            require(sha(raw) == entry.get("sha256"), "Original input SHA-256 changed: " + key)
            self.inputs[key], self.raw[key] = dict(entry), raw

    def dataset(self, key, catalog_key=None):
        if catalog_key is None:
            companions = self.parameters.get("source_catalogs", {})
            require(isinstance(companions, dict), "source_catalogs must map source input keys to catalogue input keys")
            catalog_key = companions.get(key)
        cache_key = (key, catalog_key)
        if cache_key not in self.datasets:
            entry = self.entry(key)
            value = parse_dataset(self.raw[key], entry["format"], self.base(key))
            if catalog_key is not None:
                require(entry["format"] == "nquads" and self.entry(catalog_key)["format"] == "json",
                        "A graph catalogue companion belongs to an exact N-Quads source")
                value, raw = attach_catalog(value, self.raw[key], native.load_json(self.raw[catalog_key]))
            else:
                value, _, raw = canonical_dataset(value)
                if entry["format"] == "nquads":
                    self.warnings.append("This N-Quads source has no companion catalogue. Only represented "
                                         "named-graph membership is known; absent empty named graphs cannot be inferred.")
            self.datasets[cache_key] = (value, raw)
        return self.datasets[cache_key]

    def retained_dataset(self, dataset_key, catalogue_key):
        require(catalogue_key is not None, "A retained snapshot requires its graph catalogue")
        return self.dataset(dataset_key, catalogue_key)


def _selection(value, selection, label, *, named_only=False, allow_absent=False):
    if selection == "all":
        return sorted((g for g in value.graphs if not named_only or g is not None), key=graph_key)
    require(isinstance(selection, list), label + " must be 'all' or an explicit graph-selector list")
    names = [selector_term(v, named_only=named_only) for v in selection]
    require(len(set(names)) == len(names), label + " contains duplicate graph selectors")
    if not allow_absent:
        require(set(names) <= value.graphs, label + " selects a graph absent from the retained catalogue")
    return sorted(names, key=graph_key)


def _dataset_summary(value, raw):
    counts = Counter(q[3] for q in value.quads)
    return {"data_model": "dataset", "dataset_sha256": dataset_identity(value, raw),
            "nquads_sha256": sha(raw), "quad_count": len(value.quads),
            "graph_count": len(value.graphs), "named_graph_count": len(value.graphs) - 1,
            "empty_graph_count": sum(counts[g] == 0 for g in value.graphs),
            "canonicalization": dict(CANONICALIZATION)}


def _write_dataset(context, value, raw):
    context.write("dataset.nq", raw, "application/n-quads", "dataset", "Complete canonical RDF dataset")
    context.write("dataset.trig", _trig_bytes(value), "application/trig", "trig",
                  "Complete RDF dataset including empty named graphs")
    catalogue = graph_catalog(value, raw)
    context.json("graph-catalog.json", catalogue, "graph_catalog", "Complete canonical graph inventory")
    return catalogue


def inspect_source(context):
    key = context.parameters.get("input_key")
    entry = context.entry(key)
    if entry["format"] not in DATASET_FORMATS:
        summary = native.inspect_source(context)
        return {**summary, "data_model": "dataset", "source_format": entry["format"]}
    value, raw = context.dataset(key)
    for graph in value.graphs:
        value.graph_origins[graph].append({
            "input_key": key, "source_id": entry.get("source_id"), "revision": entry.get("revision"),
            "sha256": entry["sha256"], "source_graph": graph_selector(graph),
        })
    catalogue = _write_dataset(context, value, raw)
    union = value.ordinary_graph(value.graphs)
    preview = sorted(value.quads, key=nq_line)[:50]
    inspection = {
        "schema": "commons-semantic-dataset-inspection/1",
        "kind": "rdf_dataset", "source": context.source(key),
        **_dataset_summary(value, raw), "graphs": catalogue["graphs"],
        "stats": native.graph_stats(union),
        "preview_quads": [quad_value(q) for q in preview],
        "preview_limited": len(value.quads) > len(preview),
        "stats_scope": "explicit union for descriptive term counts only; quad and graph counts remain separate",
    }
    context.json("inspection.json", inspection, "inspection", "Whole-source dataset inspection and graph selectors")
    summary = {**_dataset_summary(value, raw), "source_format": entry["format"], "native_outcome": "complete"}
    context.report("Retained RDF dataset inspection", summary, [("Complete graph inventory", catalogue["graphs"]),
                   ("Quad preview (first 50; dataset.nq is complete)", inspection["preview_quads"])])
    return summary


def snapshot(context):
    p = context.parameters
    data_keys, mappings = p.get("data_keys", []), p.get("mappings", [])
    require(isinstance(data_keys, list) and all(isinstance(k, str) for k in data_keys)
            and len(set(data_keys)) == len(data_keys), "data_keys must be a unique ordered list")
    require(isinstance(mappings, list) and all(isinstance(m, dict) for m in mappings)
            and (data_keys or mappings), "Snapshot needs selected RDF sources or reviewed CSV mappings")
    require(len({m.get("mapping_id") for m in mappings}) == len(mappings),
            "Mapping IDs must be unique within a dataset snapshot")
    source_graphs = p.get("source_graphs", {})
    companions = p.get("source_catalogs", {})
    require(isinstance(source_graphs, dict) and set(source_graphs) <= set(data_keys),
            "source_graphs must refer to selected RDF input keys")
    require(isinstance(companions, dict), "source_catalogs must be an object")
    merged, sources, original_rows, selected_sources = DatasetValue(), {}, [], []
    skipped, ill_typed = 0, 0
    for key in data_keys:
        source = context.source(key)
        value, source_raw = context.dataset(key)
        selected = _selection(value, source_graphs.get(key, "all"), "Source graph selection")
        selected_set = set(selected)
        sources[key] = source
        companion_key = companions.get(key)
        if companion_key is not None:
            sources[companion_key] = context.source(companion_key)
        identity = _stable({name: source.get(name) for name in ("key", "source_id", "revision", "sha256")})
        prefix = "source" + sha(identity.encode("utf-8")) + "_"
        nodes = {node for q in value.quads for node in q if isinstance(node, BNode)}
        nodes.update(g for g in value.graphs if isinstance(g, BNode))
        scoped = {node: BNode(prefix + str(node)) for node in nodes}
        selected_sources.append({"input_key": key, "source_dataset_sha256": dataset_identity(value, source_raw),
                                 "graphs": [graph_selector(g) for g in selected],
                                 "selection_before_document_scope": True,
                                 "catalogue_input_key": companion_key})
        for graph in selected:
            destination = scoped.get(graph, graph)
            merged.graphs.add(destination)
            origin = {"input_key": key, "source_id": source.get("source_id"),
                      "revision": source.get("revision"), "sha256": source["sha256"],
                      "source_graph": graph_selector(graph)}
            if companion_key is not None:
                origin["catalogue"] = {"input_key": companion_key, "sha256": context.entry(companion_key)["sha256"]}
            merged.graph_origins[destination].append(origin)
        for quad in value.quads:
            if quad[3] not in selected_set:
                continue
            destination = _replace_quad(quad, scoped)
            merged.quads.add(destination)
            merged.quad_origins[destination].append({
                "kind": "rdf", "input_key": key, "source_id": source.get("source_id"),
                "revision": source.get("revision"), "sha256": source["sha256"],
                "source_dataset_sha256": dataset_identity(value, source_raw),
                "source_quad": quad_value(quad), "source_nquads": nq_line(quad).rstrip("\n"),
            })
            if isinstance(quad[2], Literal) and getattr(quad[2], "ill_typed", False):
                ill_typed += 1
        if source["format"] == "json-ld":
            context.warnings.append("JSON-LD uses the original native JSON-to-RDF conversion. "
                                    "JSON numeric token spelling and precision remain in original source bytes; "
                                    "explicit typed string values retain their RDF lexical forms.")
    for mapping in mappings:
        require("destination_graph" in mapping,
                "Dataset CSV mappings require an explicit retained destination_graph")
        destination = selector_term(mapping["destination_graph"])
        require(destination is None or isinstance(destination, URIRef),
                "CSV mapping destinations must be the default graph or an explicit graph IRI")
        key = mapping.get("input_key")
        headers, rows, null_values = native.reviewed_mapping(mapping, context)
        source = context.source(key)
        sources[key] = source
        merged.graphs.add(destination)
        merged.graph_origins[destination].append({
            "input_key": key, "source_id": source.get("source_id"), "revision": source.get("revision"),
            "sha256": source["sha256"], "source_graph": graph_selector(destination),
            "mapping_id": mapping["mapping_id"], "mapping_revision": mapping.get("revision", 1),
            "kind": "reviewed CSV destination",
        })
        for row in rows:
            row_id = mapping["mapping_id"] + ":" + str(mapping.get("revision", 1)) + ":" + str(row["row"])
            original_rows.append({"id": row_id, "mapping_id": mapping["mapping_id"],
                                  "mapping_revision": mapping.get("revision", 1), "input_key": key,
                                  "source_id": source.get("source_id"), "source_revision": source.get("revision"),
                                  "source_sha256": source["sha256"], "headers": headers,
                                  "destination_graph": graph_selector(destination), **row})
            subject = native.template_iri(mapping["subject_template"], row["values"], null_values)
            common = {"kind": "csv", "input_key": key, "source_id": source.get("source_id"),
                      "revision": source.get("revision"), "sha256": source["sha256"],
                      "mapping_id": mapping["mapping_id"], "mapping_revision": mapping.get("revision", 1),
                      "row_id": row_id, "row": row["row"], "physical_line_start": row["physical_line_start"],
                      "physical_line_end": row["physical_line_end"],
                      "subject_template": mapping["subject_template"],
                      "destination_graph": graph_selector(destination)}
            for class_iri in mapping.get("classes", []):
                q = normalized_quad((subject, RDF.type, native.absolute_iri(class_iri), destination))
                merged.quads.add(q)
                merged.quad_origins[q].append({**common, "rule": "declared class", "class": class_iri})
            for field_index, field in enumerate(mapping.get("fields", [])):
                raw_cell = row["values"][field["column"]]
                if raw_cell in null_values:
                    skipped += 1
                    continue
                predicate = native.absolute_iri(field["predicate"])
                if field["kind"] == "iri":
                    obj = (native.template_iri(field["iri_template"], row["values"], null_values)
                           if field.get("iri_template") is not None
                           else native.absolute_iri(raw_cell, "Original IRI cell"))
                else:
                    obj = Literal(raw_cell, datatype=URIRef(field["datatype"]) if field.get("datatype") else None,
                                  lang=field.get("language") or None, normalize=False)
                    if getattr(obj, "ill_typed", False):
                        ill_typed += 1
                q = normalized_quad((subject, predicate, obj, destination))
                merged.quads.add(q)
                merged.quad_origins[q].append({
                    **common, "rule": "declared field", "field_index": field_index, "column": field["column"],
                    "raw_cell": raw_cell, "predicate": field["predicate"], "value_kind": field["kind"],
                    "datatype": field.get("datatype"), "language": field.get("language"),
                    "iri_template": field.get("iri_template"),
                })
    value, node_map, raw = canonical_dataset(merged)
    catalogue = _write_dataset(context, value, raw)
    provenance = {
        "schema": PROVENANCE_SCHEMA, "job_id": context.job["job_id"],
        "data_model": "dataset", "dataset_sha256": catalogue["dataset_sha256"],
        "nquads_sha256": catalogue["nquads_sha256"], "quad_count": len(value.quads),
        "canonicalization": dict(CANONICALIZATION),
        "sources": [sources[k] for k in sorted(sources)], "selected_sources": selected_sources,
        "mappings": copy.deepcopy(mappings), "csv_rows": original_rows,
        "graphs": catalogue["graphs"],
        "blank_nodes": [{"source_scoped": str(old), "snapshot": str(new)}
                        for old, new in sorted(node_map.items(), key=lambda item: str(item[0]))],
        "quads": [{**quad_value(q), "nquads": nq_line(q).rstrip("\n"),
                   "origins": _dedup_origins(value.quad_origins[q])} for q in sorted(value.quads, key=nq_line)],
    }
    context.json("provenance.json", provenance, "provenance", "Complete quad, graph and source-row provenance")
    summary = {**_dataset_summary(value, raw), "source_count": len(sources), "rdf_source_count": len(data_keys),
               "mapping_count": len(mappings), "mapped_rows": len(original_rows),
               "null_fields_skipped": skipped, "ill_typed_literal_occurrences": ill_typed,
               "provenance_complete": True, "native_outcome": "complete"}
    if ill_typed:
        context.warnings.append("Ill-typed literal lexical values are retained for validation; "
                                + str(ill_typed) + " source/mapping occurrences were observed.")
    context.report("Retained semantic dataset snapshot", summary,
                   [("Selected original source graphs", selected_sources),
                    ("Complete graph inventory", catalogue["graphs"])])
    return summary


class _ScopedContext(native.Context):
    """Use the unchanged native graph operations on an explicit selected view."""
    def __init__(self, parent, key, selected_graph, value, raw, scope, prefix=""):
        self.parent, self.data_key, self.selected_graph = parent, key, selected_graph
        self.value, self.raw_dataset, self.scope, self.prefix = value, raw, copy.deepcopy(scope), prefix
        self.job, self.inputs, self.raw = parent.job, parent.inputs, parent.raw
        self.parameters = {**parent.parameters, "graph_key": key}
        self.files, self.warnings, self.output = parent.files, parent.warnings, parent.output
        self.captured = {}

    def graph(self, key):
        return self.selected_graph if key == self.data_key else self.parent.graph(key)

    def _enrich(self, value):
        if not isinstance(value, dict):
            return value
        result = copy.deepcopy(value)
        if "graph_sha256" in result:
            result.pop("graph_sha256")
            result.update({"data_model": "dataset", "dataset_sha256": dataset_identity(self.value, self.raw_dataset),
                           "nquads_sha256": sha(self.raw_dataset), "dataset_scope": self.scope})
        return result

    def write(self, name, body, media_type, role, title):
        return self.parent.write(self.prefix + name, body, media_type, role, title)

    def json(self, name, value, role, title):
        value = self._enrich(value)
        self.captured[name] = copy.deepcopy(value)
        return self.write(name, json_bytes(value), "application/json", role, title)

    def report(self, title, summary, sections=()):
        return native.Context.report(self, title, self._enrich(summary),
                                     [("Explicit retained dataset scope", self.scope), *sections])


def _scoped_quads(value, selected):
    names = set(selected)
    return {q for q in value.quads if q[3] in names}


def _focus_quads(value, selected, finding):
    focus = {native.term_from_json(t) for t in finding.get("original_focus_nodes", [])}
    return [quad_value(q) for q in sorted(_scoped_quads(value, selected), key=nq_line)
            if q[0] in focus or q[2] in focus]


def validation(context):
    p = context.parameters
    key, catalogue_key = p.get("dataset_key"), p.get("catalog_key")
    value, raw = context.retained_dataset(key, catalogue_key)
    scope = p.get("validation_scope")
    require(isinstance(scope, dict) and scope.get("mode") in {"per_graph", "union"},
            "Validation requires explicit per_graph or union scope")
    selected = _selection(value, scope.get("graphs"), "Validation graphs")
    require(selected, "Validation requires at least one explicitly selected graph")
    targets = [[g] for g in selected] if scope["mode"] == "per_graph" else [selected]
    results, findings, files_by_target = [], [], []
    severities = Counter()
    for index, graphs in enumerate(targets, 1):
        target_scope = {"mode": scope["mode"], "graphs": [graph_selector(g) for g in graphs]}
        target_id = "graph-" + str(index).zfill(4) if scope["mode"] == "per_graph" else "union"
        ordinary = value.ordinary_graph(graphs)
        proxy = _ScopedContext(context, key, ordinary, value, raw, target_scope, prefix=target_id + "-")
        before = len(context.files)
        result = native.validation(proxy)
        result = proxy._enrich(result)
        result.update({"target_id": target_id, "validation_scope": target_scope,
                       "selected_quads": len(_scoped_quads(value, graphs)), "selected_triples": len(ordinary)})
        results.append(result)
        files_by_target.append({"target_id": target_id, "files": copy.deepcopy(context.files[before:])})
        captured = proxy.captured.get("findings.json", {})
        for finding in captured.get("findings", []):
            item = {**finding, "target_id": target_id, "validation_scope": target_scope,
                    "source_dataset_sha256": dataset_identity(value, raw)}
            if result.get("validation_phase") == "data":
                item["source_quads"] = _focus_quads(value, graphs, finding)
            else:
                item["source_quads"] = []
            findings.append(item)
        severities.update(result.get("severity_counts", {}))
    complete = all(r.get("report_complete", False) for r in results)
    valid_shapes = all(r.get("shapes_valid", False) for r in results)
    assessed = complete and valid_shapes and all(r.get("data_validation_performed") for r in results)
    conforms = all(r.get("conforms") is True for r in results) if assessed else None
    outcome = ("invalid_shapes" if not valid_shapes else "validation_failure" if not complete
               else "conforms" if conforms else "nonconforming")
    summary = {**_dataset_summary(value, raw), "native_outcome": outcome, "conforms": conforms,
               "validation_scope": {"mode": scope["mode"], "graphs": [graph_selector(g) for g in selected]},
               "targets": len(results), "validation_results": results,
               "data_validation_performed": assessed, "shapes_valid": valid_shapes,
               "root_results": sum(r.get("root_results", 0) for r in results),
               "all_results_including_details": len(findings),
               "severity_counts": dict(sorted(severities.items())),
               "inference": p.get("inference", "none"), "allow_infos": p.get("allow_infos", False),
               "allow_warnings": p.get("allow_warnings", False),
               "report_complete": complete, "implicit_dataset_union": False}
    document = {"schema": "commons-semantic-dataset-findings/1", **summary,
                "sources": [context.source(k) for k in [key, catalogue_key]
                            + p.get("shape_keys", []) + p.get("ontology_keys", [])],
                "reports": files_by_target, "findings": findings}
    context.json("findings.json", document, "findings", "Complete graph-scoped SHACL findings")
    context.report("Explicit dataset SHACL validation", summary,
                   [("Complete graph-scoped findings", findings)])
    return summary


def query(context):
    p = context.parameters
    key, catalogue_key = p.get("dataset_key"), p.get("catalog_key")
    value, raw = context.retained_dataset(key, catalogue_key)
    scope = p.get("query_scope")
    require(isinstance(scope, dict) and scope.get("default_graph") in {"default", "union"},
            "Query requires an explicit default_graph choice")
    named = _selection(value, scope.get("named_graphs"), "Query named graphs", named_only=True)
    selected_default = [None] if scope["default_graph"] == "default" else [None, *named]
    dataset = Dataset(default_union=False)
    targets = {name: dataset.graph(name) for name in named}
    for subject, predicate, obj, graph in value.quads:
        if graph in targets:
            targets[graph].add((subject, predicate, obj))
    for triple in value.ordinary_graph(selected_default):
        dataset.default_graph.add(triple)
    exact_scope = {"default_graph": scope["default_graph"],
                   "named_graphs": [graph_selector(g) for g in named],
                   "default_graph_sources": [graph_selector(g) for g in selected_default],
                   "default_triples": len(dataset.default_graph),
                   "named_quads": len(_scoped_quads(value, named))}
    if any(isinstance(name, BNode) for name in named):
        context.warnings.append("Blank-node graph names remain present in the selected dataset and may be "
                                "returned by GRAPH variables in RDFLib. SPARQL GRAPH constants use IRIs; "
                                "a '_:label' in a query is not a stable graph-name constant.")
    proxy = _ScopedContext(context, key, dataset, value, raw, exact_scope)
    # RDFLib's bound GRAPH branch calls get_context without checking whether
    # that graph belongs to the active dataset. An empty BGP could otherwise
    # match an excluded graph, including the internal default sentinel.
    from rdflib.plugins.sparql import evaluate as evaluator
    original_eval_graph = evaluator.evalGraph
    visible_names = set(named)
    def scoped_eval_graph(query_context, part):
        bound = query_context[part.term]
        if bound is not None and bound not in visible_names:
            return iter(())
        return original_eval_graph(query_context, part)
    evaluator.evalGraph = scoped_eval_graph
    try:
        result = native.query(proxy)
    finally:
        evaluator.evalGraph = original_eval_graph
    result = proxy._enrich(result)
    result.update({"query_scope": exact_scope, "implicit_dataset_union": False,
                   "result_data_model": "graph" if result.get("query_form") in {"ConstructQuery", "DescribeQuery"}
                   else "bindings" if result.get("query_form") == "SelectQuery" else "boolean"})
    context.json("dataset-query-scope.json", {**result, "dataset_source": context.source(key),
                                            "catalogue_source": context.source(catalogue_key)},
                 "query_result", "Exact dataset query scope and result model")
    return result


def provenance_index(context, key, value, raw):
    if key is None:
        return {}, None
    require(context.entry(key)["format"] == "json", "Quad provenance must be retained JSON")
    document = native.load_json(context.raw[key])
    require(isinstance(document, dict) and document.get("schema") == PROVENANCE_SCHEMA,
            "Unknown retained dataset provenance")
    require(document.get("dataset_sha256") == dataset_identity(value, raw)
            and document.get("nquads_sha256") == sha(raw),
            "Provenance does not bind this exact dataset and graph inventory")
    require(type(document.get("quad_count")) is int and document["quad_count"] == len(value.quads),
            "Provenance quad count differs from its selected dataset")
    graph_rows = document.get("graphs")
    require(isinstance(graph_rows, list), "Provenance requires the complete graph inventory")
    expected_catalogue = graph_catalog(value, raw)
    require([{k: r.get(k) for k in ("graph", "quad_count", "empty")} for r in graph_rows]
            == [{k: r[k] for k in ("graph", "quad_count", "empty")} for r in expected_catalogue["graphs"]],
            "Provenance graph identities/counts differ from the selected catalogue")
    rows = document.get("quads")
    require(isinstance(rows, list) and len(rows) == len(value.quads), "Complete retained quad provenance is required")
    index = {}
    for row in rows:
        require(isinstance(row, dict), "Invalid retained provenance quad")
        q = normalized_quad(tuple(native.term_from_json(row.get(name))
                                  for name in ("subject", "predicate", "object"))
                            + (selector_term(row.get("graph")),))
        require(q in value.quads and q not in index, "Provenance has an absent or duplicate quad")
        require(row.get("nquads") == nq_line(q).rstrip("\n"), "Provenance typed terms and N-Quads disagree")
        origins = row.get("origins")
        require(isinstance(origins, list) and all(isinstance(o, dict) for o in origins),
                "Quad origins must be retained metadata objects")
        index[q] = origins
    return index, {"input_key": key, "sha256": context.entry(key)["sha256"],
                   "dataset_sha256": document["dataset_sha256"], "sources": document.get("sources", []),
                   "mappings": document.get("mappings", []),
                   "all_quads_have_origins": all(bool(origins) for origins in index.values())}


def _graph_changes(before, after, selected):
    before_names, after_names = before.graphs & set(selected), after.graphs & set(selected)
    records = []
    for side, kind, value, names in (("before", "removed_graph", before, before_names - after_names),
                                    ("after", "added_graph", after, after_names - before_names)):
        counts = Counter(q[3] for q in value.quads)
        for graph in sorted(names, key=graph_key):
            records.append({"change": kind, "snapshot": side, "graph": graph_selector(graph),
                            "quad_count": counts[graph], "empty": counts[graph] == 0,
                            "origins": _dedup_origins(value.graph_origins[graph])})
    return records


def _ground_membership_changes(before_quads, after_quads):
    indexes = []
    for quads in (before_quads, after_quads):
        index = defaultdict(set)
        for s, p, o, g in quads:
            if not any(isinstance(v, BNode) for v in (s, o, g)):
                index[(s, p, o)].add(g)
        indexes.append(index)
    before, after = indexes
    result = []
    for triple in sorted(set(before) & set(after), key=native.nt_line):
        if before[triple] == after[triple]:
            continue
        result.append({**native.triple_value(triple),
                       "before_graphs": [graph_selector(g) for g in sorted(before[triple], key=graph_key)],
                       "after_graphs": [graph_selector(g) for g in sorted(after[triple], key=graph_key)],
                       "removed_graphs": [graph_selector(g) for g in sorted(before[triple] - after[triple], key=graph_key)],
                       "added_graphs": [graph_selector(g) for g in sorted(after[triple] - before[triple], key=graph_key)],
                       "identity_basis": "same ground RDF triple; only default and IRI-named graphs"})
    return result


def compare(context):
    p = context.parameters
    before, before_raw = context.retained_dataset(p.get("before_dataset_key"), p.get("before_catalog_key"))
    after, after_raw = context.retained_dataset(p.get("after_dataset_key"), p.get("after_catalog_key"))
    scope = p.get("comparison_scope")
    require(isinstance(scope, dict) and scope.get("impact_mode") in {"within_graph", "union"},
            "Comparison requires an explicit within_graph or union impact scope")
    combined = DatasetValue(graphs=before.graphs | after.graphs)
    selected = _selection(combined, scope.get("graphs"), "Comparison graphs")
    require(selected, "Comparison requires at least one selected graph")
    bquads, aquads = _scoped_quads(before, selected), _scoped_quads(after, selected)
    removed, added, common = bquads - aquads, aquads - bquads, bquads & aquads
    changes_to_graphs = _graph_changes(before, after, selected)
    membership_changes = _ground_membership_changes(bquads, aquads)
    bi, bsource = provenance_index(context, p.get("before_provenance_key"), before, before_raw)
    ai, asource = provenance_index(context, p.get("after_provenance_key"), after, after_raw)
    indexes = {"before": bi, "after": ai}
    hashes = {"before": dataset_identity(before, before_raw), "after": dataset_identity(after, after_raw)}
    provenance_complete = bool(bsource and asource and bsource["all_quads_have_origins"]
                               and asource["all_quads_have_origins"])
    if not provenance_complete:
        context.warnings.append("Complete original quad origins were not supplied for both datasets. "
                                "The quad and graph-inventory differences remain complete.")
    context.warnings.append("URDNA2015 blank-node labels are local to each whole dataset, not cross-edition "
                            "business identifiers. A structural edit can relabel other connected blank nodes. "
                            "Canonical quad differences are complete but are not a minimum edit or a claimed "
                            "entity correspondence. Ground triple membership changes are identified separately.")
    if any(isinstance(g, BNode) for g in selected):
        context.warnings.append("A selected blank graph name addresses that dataset's local canonical label; "
                                "matching label text in another edition does not establish graph business identity.")
    predicates = p.get("edge_predicates", [])
    require(isinstance(predicates, list), "edge_predicates must be an explicit list")
    selected_predicates = {native.absolute_iri(v, "Impact edge predicate") for v in predicates}
    depth = native.positive_integer(p.get("depth"), "Impact depth", 2, minimum=0)
    node_limit = native.positive_integer(p.get("node_limit"), "Impact node_limit", 100000)
    exact_scope = {"graphs": [graph_selector(g) for g in selected], "impact_mode": scope["impact_mode"]}
    context.write("additions.nq", "".join(nq_line(q) for q in sorted(added, key=nq_line)),
                  "application/n-quads", "additions", "Complete added quads with after-dataset labels")
    context.write("removals.nq", "".join(nq_line(q) for q in sorted(removed, key=nq_line)),
                  "application/n-quads", "removals", "Complete removed quads with before-dataset labels")
    context.json("graph-changes.json", {
        "schema": "commons-semantic-dataset-graph-changes/1", "comparison_scope": exact_scope,
        "before_dataset_sha256": hashes["before"], "after_dataset_sha256": hashes["after"],
        "graph_inventory_changes": changes_to_graphs, "ground_membership_changes": membership_changes,
        "membership_identity_basis": "Ground RDF terms and default/IRI graph names only. "
                                     "All other membership differences remain in complete quad changes.",
    }, "impact", "Complete graph inventory changes and definite ground triple membership changes")
    node_details, node_origins, node_graphs = {}, defaultdict(dict), defaultdict(set)
    adjacency, predicate_uses, relationships = defaultdict(list), defaultdict(list), {}
    def node_key(node, side, graph):
        require(isinstance(node, (URIRef, BNode)), "Impact resources must be IRIs or blank nodes")
        key = (side, graph_key(graph) if scope["impact_mode"] == "within_graph" else "", native.term_key(node))
        node_details[key] = {"term": native.term(node), "snapshot_scope": side}
        node_graphs[key].add(graph)
        return key
    def node_json(key):
        return {**node_details[key], "graphs": [graph_selector(g) for g in sorted(node_graphs[key], key=graph_key)],
                "impact_mode": scope["impact_mode"]}
    for side, quads in (("before", bquads), ("after", aquads)):
        for q in sorted(quads, key=nq_line):
            s, pred, obj, graph = q
            skey = node_key(s, side, graph)
            rid = side + ":" + sha(nq_line(q).encode("utf-8"))
            origins = indexes[side].get(q, [])
            relationships[rid] = {"id": rid, "snapshot": side, "dataset_sha256": hashes[side],
                                  **quad_value(q), "nquads": nq_line(q).rstrip("\n"), "origins": origins}
            predicate_uses[node_key(pred, side, graph)].append((skey, rid, "predicate-use"))
            for origin in origins:
                node_origins[skey][_stable(origin)] = origin
            if isinstance(obj, (URIRef, BNode)):
                okey = node_key(obj, side, graph)
                for origin in origins:
                    node_origins[okey][_stable(origin)] = origin
                if not selected_predicates or pred in selected_predicates:
                    adjacency[skey].append((okey, rid, "outgoing"))
                    adjacency[okey].append((skey, rid, "incoming"))
    changes, seeds, changed_subjects = [], set(), set()
    for side, kind, quads in (("before", "removed", removed), ("after", "added", added)):
        for q in sorted(quads, key=nq_line):
            subject, _, obj, graph = q
            skey = node_key(subject, side, graph)
            seeds.add(skey)
            changed_subjects.add(skey)
            if isinstance(obj, (URIRef, BNode)):
                seeds.add(node_key(obj, side, graph))
            changes.append({"change": kind, "snapshot": side, "dataset_sha256": hashes[side],
                            **quad_value(q), "nquads": nq_line(q).rstrip("\n"),
                            "origins": indexes[side].get(q, [])})
    ordered_seeds = sorted(seeds)
    visited = {key: 0 for key in ordered_seeds[:node_limit]}
    reasons = {key: [{"kind": "changed quad"}] for key in visited}
    queue = deque(visited)
    observed = set(seeds)
    used_relationships = set()
    truncated = len(seeds) > node_limit
    while queue:
        current = queue.popleft()
        distance = visited[current]
        if distance >= depth:
            continue
        neighbors = adjacency.get(current, []) + predicate_uses.get(current, [])
        for neighbor, rid, direction in sorted(neighbors):
            observed.add(neighbor)
            used_relationships.add(rid)
            if neighbor in visited:
                continue
            if len(visited) >= node_limit:
                truncated = True
                continue
            visited[neighbor] = distance + 1
            reasons[neighbor] = [{"kind": direction, "from": node_json(current), "relationship_id": rid}]
            queue.append(neighbor)
    affected = [{**node_json(key), "distance": visited[key], "changed_subject": key in changed_subjects,
                 "reasons": reasons[key],
                 "origins": [node_origins[key][k] for k in sorted(node_origins[key])]}
                for key in sorted(visited, key=lambda k: (visited[k], k))]
    context.write("changes.jsonl", "".join(_stable(row) + "\n" for row in changes),
                  "application/x-ndjson", "impact", "Complete added and removed quads with source references")
    context.write("impact-relationships.jsonl",
                  "".join(_stable(relationships[k]) + "\n" for k in sorted(used_relationships)),
                  "application/x-ndjson", "impact", "Actual traversed relationships with side and graph")
    bnames, anames = before.graphs & set(selected), after.graphs & set(selected)
    summary = {
        "data_model": "dataset", "native_outcome": "limited_impact" if truncated else "complete",
        "before_dataset_sha256": hashes["before"], "after_dataset_sha256": hashes["after"],
        "before_nquads_sha256": sha(before_raw), "after_nquads_sha256": sha(after_raw),
        "comparison_scope": exact_scope,
        "before_quads": len(bquads), "after_quads": len(aquads), "common_quads": len(common),
        "added_quads": len(added), "removed_quads": len(removed),
        "before_graphs": len(bnames), "after_graphs": len(anames),
        "added_graphs": len(anames - bnames), "removed_graphs": len(bnames - anames),
        "ground_membership_changes": len(membership_changes),
        "equivalent": not added and not removed and bnames == anames,
        "equivalence_scope": "selected canonical quads and graph inventory",
        "quad_difference_complete": True, "graph_inventory_difference_complete": True,
        "changed_subjects": len(changed_subjects), "seed_nodes": len(seeds),
        "impact_nodes": len(affected), "impact_depth": depth, "impact_node_limit": node_limit,
        "impact_truncated": truncated, "impact_total_within_depth": None if truncated else len(affected),
        "observed_candidate_nodes_at_least": len(observed), "traversed_relationships": len(used_relationships),
        "edge_predicates": sorted(str(v) for v in selected_predicates),
        "provenance_complete": provenance_complete,
        "direction": "incoming and outgoing selected resource edges, plus use of a visited predicate IRI",
        "cross_edition_traversal": False,
        "blank_node_comparison": "local whole-dataset canonical labels; no cross-edition business identity",
    }
    context.json("impact.json", {
        "schema": "commons-semantic-dataset-impact/1", **summary, "before_provenance": bsource,
        "after_provenance": asource, "graph_inventory_changes": changes_to_graphs,
        "ground_membership_changes_detail": membership_changes, "nodes": affected,
    }, "impact", "Selected graph-aware impact with complete dataset differences")
    context.report("Dataset comparison and graph-aware impact", summary,
                   [("Graph inventory changes", changes_to_graphs),
                    ("Definite ground triple membership changes", membership_changes),
                    ("Changed quad preview (first 50; changes.jsonl is complete)", changes[:50])])
    return summary


def execute(job: dict, input_paths: dict[str, Path], output_dir: Path) -> dict:
    """Execute one pinned dataset job through the original native operations."""
    versions = native.native_versions()
    installed = importlib.metadata.version("PyLD")
    require(installed == CANONICALIZATION["version"], "Exact PyLD 3.3.0 is required; found " + installed)
    versions["PyLD"] = installed
    with native.native_scope():
        context = Context(job, input_paths, output_dir)
        action = job.get("action")
        operations = {"inspect": inspect_source, "snapshot": snapshot, "validate": validation,
                      "query": query, "compare": compare}
        require(action in operations, "Unknown dataset native action")
        summary = operations[action](context)
        return {
            "schema": SCHEMA, "action": action,
            "summary": {**summary, "engine_versions": versions,
                        "engine_source_sha256": ENGINE_SOURCE["sha256"],
                        "supporting_engine_source_sha256": native.ENGINE_SOURCE["sha256"]},
            "engine_source": dict(ENGINE_SOURCE),
            "supporting_engine_sources": [dict(native.ENGINE_SOURCE)],
            "files": context.files, "warnings": list(dict.fromkeys(context.warnings)),
        }
