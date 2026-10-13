"""Every headline figure in the report is asserted here.

If the upstream repository changes, these fail loudly rather than letting the
report drift away from the corpus it describes.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from rdflib import Graph

from dcat_us_binding.audit import audit
from dcat_us_binding.context import build_context
from dcat_us_binding.roundtrip import load_examples, measure, scan_bare_values
from dcat_us_binding.schema import load_classes, load_namespaces
from dcat_us_binding.shapes import build_shapes
from dcat_us_binding.validate import merge_corpus, run

REPO = Path(__file__).resolve().parents[1]
UPSTREAM = REPO / "upstream" / "jsonschema"
SHAPES_BASE = "http://resources.data.gov/shapes/dcat-us#"

pytestmark = pytest.mark.skipif(
    not UPSTREAM.exists(), reason="run `make upstream` to fetch GSA/dcat-us first"
)


@pytest.fixture(scope="module")
def parts():
    classes = load_classes(UPSTREAM / "definitions")
    namespaces = load_namespaces(REPO / "namespaces.json")
    examples = load_examples(UPSTREAM / "examples")
    bare = scan_bare_values(examples, classes)
    return {
        "classes": classes,
        "namespaces": namespaces,
        "examples": examples,
        "bare": bare,
        "declared": build_context(classes, namespaces),
        "observed": build_context(classes, namespaces, lenient_terms=set(bare["terms"])),
    }


def test_corpus_size(parts):
    assert len(parts["examples"]) == 115


def test_schema_carries_the_binding(parts):
    counts = audit(parts["classes"], parts["namespaces"])["counts"]
    assert counts == {
        "classes": 26,
        "classesWithRdfClass": 26,
        "properties": 270,
        "propertiesWithIri": 231,
        "propertiesWithoutIri": 39,
        "distinctTerms": 119,
        "termsWithIriConflict": 4,
        "termsWithShapeConflict": 10,
    }


def test_every_curie_resolves(parts):
    assert audit(parts["classes"], parts["namespaces"])["unresolvablePrefixes"] == []


def test_conflicts_are_the_four_we_documented(parts):
    conflicts = audit(parts["classes"], parts["namespaces"])["iriConflicts"]
    assert {c["term"] for c in conflicts} == {"conformsTo", "mediaType", "publisher", "title"}
    document = {c["term"] for c in conflicts
                if any(o["class"] == "Document" for o in c["overrides"])}
    assert document == {"conformsTo", "mediaType", "publisher"}


def test_concept_and_identifier_have_no_bound_properties(parts):
    for name in ("Concept", "Identifier"):
        cls = parts["classes"][name]
        assert cls.properties, f"{name} declares properties"
        assert not any(p.bound for p in cls.properties.values())


def test_published_corpus_reaches_no_dcat(parts):
    m = measure(parts["examples"], None)
    assert m["triples"] == 76
    assert m["distinctPredicates"] == 1
    assert m["dcatNamespaceTriples"] == 0
    assert m["zeroTripleFiles"] == 38
    assert len(m["failures"]) == 1


def test_declared_binding_reaches_dcat_and_invents_iris(parts):
    m = measure(parts["examples"], parts["declared"])
    assert m["triples"] == 1508
    assert m["dcatNamespaceTriples"] == 228
    assert m["failures"] == []
    assert m["manufacturedIriCount"] == 98


def test_observed_binding_invents_nothing(parts):
    m = measure(parts["examples"], parts["observed"])
    assert m["triples"] == 1510
    assert m["manufacturedIriCount"] == 0


def test_bare_values(parts):
    bare = parts["bare"]
    assert bare["termCount"] == 22
    assert bare["occurrenceTotal"] == 100
    assert "accessRights" in bare["terms"]


def test_generated_shapes_parse_and_cover_every_bound_class(parts):
    ttl = build_shapes(parts["classes"], parts["namespaces"], SHAPES_BASE)
    graph = Graph().parse(data=ttl, format="turtle")
    assert len(graph) > 1500
    data = merge_corpus(parts["examples"], parts["observed"])
    path = REPO / "build" / "dcat-us-3.0-shapes.ttl"
    path.parent.mkdir(exist_ok=True)
    path.write_text(ttl)
    result = run(path, data)
    assert result["coverage"]["matchedClassCount"] == result["coverage"]["targetClasses"] == 24
    assert result["coverage"]["focusNodes"] == 191


def test_deleted_shapes_pass_vacuously_then_fire(parts):
    legacy = REPO / "vendor" / "dcat-us_3.0_shacl_shapes.recovered.ttl"
    published = run(legacy, merge_corpus(parts["examples"], None))
    assert published["conforms"] is True
    assert published["coverage"]["focusNodes"] == 0
    assert published["results"] == 0

    bound = run(legacy, merge_corpus(parts["examples"], parts["observed"]))
    assert bound["conforms"] is False
    assert bound["coverage"]["focusNodes"] == 228
    assert bound["results"] == 287


def test_context_is_deterministic(parts):
    first = json.dumps(build_context(parts["classes"], parts["namespaces"]), indent=2)
    second = json.dumps(build_context(parts["classes"], parts["namespaces"]), indent=2)
    assert first == second
