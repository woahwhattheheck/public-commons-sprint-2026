"""Run SHACL over the expanded corpus, and say how much of it was reached.

A SHACL run reports `conforms` whether or not any shape matched anything.
That makes a green result ambiguous, so every run here also reports how many
focus nodes the shapes actually selected. Zero focus nodes and zero
violations is not a pass, it is a miss.
"""

from __future__ import annotations

from pathlib import Path

from pyshacl import validate as pyshacl_validate
from rdflib import RDF, Graph, URIRef
from rdflib.namespace import Namespace

from .roundtrip import expand_file

SH = Namespace("http://www.w3.org/ns/shacl#")


def merge_corpus(files: list[Path], context: dict | None, base: str = "https://example.gov/") -> Graph:
    merged = Graph()
    for path in files:
        graph, error = expand_file(path, context, base)
        if error:
            continue
        for quad in graph.quads((None, None, None, None)):
            merged.add(quad[:3])
    return merged


def coverage(shapes: Graph, data: Graph) -> dict:
    targets = {o for o in shapes.objects(None, SH.targetClass) if isinstance(o, URIRef)}
    present = {o for o in data.objects(None, RDF.type) if isinstance(o, URIRef)}
    matched = targets & present
    focus_nodes = {s for cls in matched for s in data.subjects(RDF.type, cls)}
    return {
        "targetClasses": len(targets),
        "typesInData": len(present),
        "matchedClasses": sorted(str(c) for c in matched),
        "matchedClassCount": len(matched),
        "focusNodes": len(focus_nodes),
        "unmatchedTargetClasses": sorted(str(c) for c in targets - present),
    }


def run(shapes_path: Path, data: Graph) -> dict:
    shapes = Graph().parse(str(shapes_path), format="turtle")
    conforms, results_graph, _ = pyshacl_validate(
        data, shacl_graph=shapes, inference="none", advanced=True, debug=False
    )
    severities: dict[str, int] = {}
    for result in results_graph.subjects(RDF.type, SH.ValidationResult):
        for severity in results_graph.objects(result, SH.resultSeverity):
            key = str(severity).rsplit("#", 1)[-1]
            severities[key] = severities.get(key, 0) + 1
    paths: dict[str, int] = {}
    for result in results_graph.subjects(RDF.type, SH.ValidationResult):
        for path in results_graph.objects(result, SH.resultPath):
            paths[str(path)] = paths.get(str(path), 0) + 1
    return {
        "shapes": str(shapes_path),
        "shapeTriples": len(shapes),
        "conforms": bool(conforms),
        "results": sum(severities.values()),
        "bySeverity": dict(sorted(severities.items())),
        "topPaths": sorted(paths.items(), key=lambda kv: (-kv[1], kv[0]))[:15],
        "coverage": coverage(shapes, data),
    }
