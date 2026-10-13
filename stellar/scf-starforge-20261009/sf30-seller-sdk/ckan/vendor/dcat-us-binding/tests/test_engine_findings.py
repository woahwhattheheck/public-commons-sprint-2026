"""Minimal repros for the two engine defects the build surfaced.

Both are filed upstream. They live here so a fix can be detected the moment it
lands, and so the report's cross-engine table is not an unsupported claim.
"""

from __future__ import annotations

import pytest
from rdflib import Graph

REPRO_DATA = """
@prefix ex: <https://example.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex:a a ex:Thing ;
    ex:size  "1024"^^xsd:nonNegativeInteger ;
    ex:count "7"^^xsd:integer ;
    ex:name  "x"^^xsd:string ;
    ex:ratio "1.5"^^xsd:decimal .
"""

REPRO_SHAPES = """
@prefix ex: <https://example.org/> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex:ThingShape a sh:NodeShape ; sh:targetClass ex:Thing ;
    sh:property [ sh:path ex:size  ; sh:datatype xsd:nonNegativeInteger ] ;
    sh:property [ sh:path ex:count ; sh:datatype xsd:integer ] ;
    sh:property [ sh:path ex:name  ; sh:datatype xsd:string ] ;
    sh:property [ sh:path ex:ratio ; sh:datatype xsd:decimal ] .
"""


def test_pyshacl_accepts_correctly_typed_literals():
    """The reference behaviour the Rust engine is measured against."""
    from pyshacl import validate

    conforms, _, _ = validate(
        Graph().parse(data=REPRO_DATA, format="turtle"),
        shacl_graph=Graph().parse(data=REPRO_SHAPES, format="turtle"),
    )
    assert conforms is True


def test_rdflib_crashes_on_a_scalar_jsonld_document():
    """rdflib 7.6.0 raises UnboundLocalError instead of a parse error.

    `jsonschema/examples/Identifier/good/minimal_string_example.json` is the
    JSON document `"dataset-12345"`. JSON-LD expansion of a scalar yields an
    empty array, so an empty graph is the correct outcome. rdflib's parser
    handles only list and dict, leaving `resources` unassigned at
    plugins/parsers/jsonld.py:242.
    """
    with pytest.raises(UnboundLocalError):
        Graph().parse(data='"dataset-12345"', format="json-ld", base="https://example.gov/")
