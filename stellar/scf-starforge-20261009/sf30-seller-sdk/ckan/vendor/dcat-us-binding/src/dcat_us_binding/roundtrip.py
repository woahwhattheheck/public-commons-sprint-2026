"""Expand the published examples and measure what reaches RDF.

The measurement is the point. A context that is never run against the corpus
is a claim; a context that is run and counted is evidence.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from rdflib import Dataset as RDFDataset
from rdflib import URIRef

from .audit import binding_of
from .schema import ClassDef

ABSOLUTE_IRI = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*:")
DCAT_NS = "http://www.w3.org/ns/dcat#"
RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
DEFAULT_BASE = "https://example.gov/"


def ranked(counter: Counter, limit: int) -> list:
    """Counter.most_common with ties broken on the key.

    Insertion order varies with filesystem iteration, so an unsorted tie makes
    the committed measurements differ between machines for no reason.
    """
    return [list(item) for item in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]]


def load_examples(examples_dir: Path, quality: str = "good") -> list[Path]:
    return sorted(Path(examples_dir).glob(f"*/{quality}/*.json"))


def expand_file(path: Path, context: dict | None, base: str = DEFAULT_BASE):
    """Expand one example, optionally injecting a context. Returns (graph, error)."""
    doc = json.loads(path.read_text())
    if context is not None:
        if isinstance(doc, dict):
            doc = {**context, **{k: v for k, v in doc.items() if k != "@context"}}
        else:
            doc = {**context, "@graph": doc}
    graph = RDFDataset()
    try:
        graph.parse(data=json.dumps(doc), format="json-ld", base=base)
    except Exception as exc:  # noqa: BLE001 - the failure itself is a result
        return None, f"{type(exc).__name__}: {exc}"
    return graph, None


def verbatim_strings(node, out: set[str] | None = None) -> set[str]:
    """Every string the document actually contains, at any depth.

    An IRI in the output that appears here came from the data. One that does
    not was assembled by the processor out of a label.
    """
    out = set() if out is None else out
    if isinstance(node, list):
        for item in node:
            verbatim_strings(item, out)
    elif isinstance(node, dict):
        for key, child in node.items():
            if isinstance(key, str):
                out.add(key)
            verbatim_strings(child, out)
    elif isinstance(node, str):
        out.add(node)
    return out


def measure(files: list[Path], context: dict | None, base: str = DEFAULT_BASE) -> dict:
    """Expand every example and count what survives.

    `manufacturedIris` are object IRIs under the expansion base that the
    document never declared. They are identifiers the processor invented from
    a plain string, which is the failure mode a JSON-only pipeline cannot see.
    """
    triples = 0
    zero_files: list[str] = []
    failures: list[dict] = []
    predicates: Counter = Counter()
    types: Counter = Counter()
    manufactured: Counter = Counter()
    manufactured_files: set[str] = set()

    for path in files:
        graph, error = expand_file(path, context, base)
        if error:
            failures.append({"file": path.name, "error": error})
            continue
        written = verbatim_strings(json.loads(path.read_text()))
        count = 0
        for subject, predicate, obj, _ in graph.quads((None, None, None, None)):
            count += 1
            predicate_iri = str(predicate)
            predicates[predicate_iri] += 1
            if predicate_iri == RDF_TYPE:
                types[str(obj)] += 1
            elif isinstance(obj, URIRef) and str(obj).startswith(base) and str(obj) not in written:
                manufactured[str(obj)] += 1
                manufactured_files.add(path.name)
        triples += count
        if count == 0:
            zero_files.append(path.name)

    return {
        "files": len(files),
        "triples": triples,
        "distinctPredicates": len(predicates),
        "dcatNamespaceTriples": sum(v for k, v in predicates.items() if k.startswith(DCAT_NS)),
        "zeroTripleFiles": len(zero_files),
        "zeroTripleFileNames": zero_files,
        "failures": failures,
        "topPredicates": ranked(predicates, 15),
        "typeValues": ranked(types, 30),
        "manufacturedIris": ranked(manufactured, 20),
        "manufacturedIriCount": sum(manufactured.values()),
        "manufacturedIriFiles": len(manufactured_files),
    }


def _binding_index(classes: dict[str, ClassDef]) -> tuple[dict[str, tuple], dict[str, dict[str, tuple]]]:
    from .audit import resolve_term, term_bindings

    dominant: dict[str, tuple] = {}
    scoped: dict[str, dict[str, tuple]] = {}
    for term, owners in term_bindings(classes).items():
        dom, overrides = resolve_term(owners)
        dominant[term] = dom
        for cls_name, binding in overrides.items():
            scoped.setdefault(cls_name, {})[term] = binding
    return dominant, scoped


def scan_bare_values(files: list[Path], classes: dict[str, ClassDef]) -> dict:
    """Find IRI-coerced terms whose published values are not IRIs.

    These are the properties where the JSON carries a label and the schema
    promises a resource. Under a faithful context they become relative IRIs
    resolved against the base, which is how a catalogue silently invents
    identifiers that nothing else in the world uses.
    """
    dominant, scoped = _binding_index(classes)
    offenders: dict[str, Counter] = {}
    per_file: dict[str, set[str]] = {}

    def binding_for(term: str, enclosing_type: str | None):
        if enclosing_type and term in scoped.get(enclosing_type, {}):
            return scoped[enclosing_type][term]
        return dominant.get(term)

    def walk(node, enclosing_type: str | None, filename: str):
        if isinstance(node, list):
            for item in node:
                walk(item, enclosing_type, filename)
            return
        if not isinstance(node, dict):
            return
        node_type = node.get("@type") if isinstance(node.get("@type"), str) else enclosing_type
        for key, value in node.items():
            if key.startswith("@"):
                continue
            binding = binding_for(key, node_type)
            values = value if isinstance(value, list) else [value]
            for item in values:
                if isinstance(item, (dict, list)):
                    walk(item, node_type, filename)
                elif isinstance(item, str) and binding and binding[1] == "@id":
                    if not ABSOLUTE_IRI.match(item):
                        offenders.setdefault(key, Counter())[item] += 1
                        per_file.setdefault(filename, set()).add(key)

    for path in files:
        walk(json.loads(path.read_text()), None, path.name)

    return {
        "terms": {
            term: {"occurrences": sum(counter.values()), "examples": [v for v, _ in counter.most_common(3)]}
            for term, counter in sorted(offenders.items())
        },
        "termCount": len(offenders),
        "occurrenceTotal": sum(sum(c.values()) for c in offenders.values()),
        "affectedFiles": len(per_file),
    }
