"""Build every artefact and measure the result in one pass."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .audit import audit
from .context import build_context, context_stats
from .roundtrip import load_examples, measure, scan_bare_values
from .schema import load_classes, load_namespaces
from .shapes import build_shapes
from .validate import merge_corpus, run as run_shacl

SHAPES_BASE = "http://resources.data.gov/shapes/dcat-us#"
REPO = Path(__file__).resolve().parents[2]


def _write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def build(upstream: Path, out: Path, namespaces_file: Path) -> dict:
    classes = load_classes(upstream / "definitions")
    namespaces = load_namespaces(namespaces_file)
    examples = load_examples(upstream / "examples")

    report = audit(classes, namespaces)
    bare = scan_bare_values(examples, classes)

    declared = build_context(classes, namespaces)
    observed = build_context(classes, namespaces, lenient_terms=set(bare["terms"]))
    shapes = build_shapes(classes, namespaces, SHAPES_BASE)

    _write(out / "dcat-us-3.0.context.jsonld", json.dumps(declared, indent=2) + "\n")
    _write(out / "dcat-us-3.0.observed.context.jsonld", json.dumps(observed, indent=2) + "\n")
    _write(out / "dcat-us-3.0-shapes.ttl", shapes)
    _write(out / "audit.json", json.dumps(report, indent=2) + "\n")

    corpus_published = merge_corpus(examples, None)
    corpus_bound = merge_corpus(examples, observed)
    _write(out / "corpus.expanded.ttl", corpus_bound.serialize(format="turtle"))

    generated_shapes = out / "dcat-us-3.0-shapes.ttl"
    legacy_shapes = REPO / "vendor" / "dcat-us_3.0_shacl_shapes.recovered.ttl"
    validation = {
        "legacyShapesOverPublishedCorpus": run_shacl(legacy_shapes, corpus_published),
        "legacyShapesOverBoundCorpus": run_shacl(legacy_shapes, corpus_bound),
        "generatedShapesOverBoundCorpus": run_shacl(generated_shapes, corpus_bound),
    }

    measurements = {
        "baseline": measure(examples, None),
        "declared": measure(examples, declared),
        "observed": measure(examples, observed),
    }
    result = {
        "upstream": upstream.name,
        "examples": len(examples),
        "audit": report,
        "bareValues": bare,
        "contextStats": {"declared": context_stats(declared), "observed": context_stats(observed)},
        "measurements": measurements,
        "validation": validation,
        "corpusTriples": {"asPublished": len(corpus_published), "withBinding": len(corpus_bound)},
    }
    _write(out / "measurements.json", json.dumps(result, indent=2) + "\n")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="dcat-us-binding", description=__doc__)
    parser.add_argument("--upstream", type=Path, required=True,
                        help="path to the GSA/dcat-us jsonschema/ directory")
    parser.add_argument("--out", type=Path, default=REPO / "build")
    parser.add_argument("--namespaces", type=Path, default=REPO / "namespaces.json")
    args = parser.parse_args(argv)

    result = build(args.upstream, args.out, args.namespaces)
    counts = result["audit"]["counts"]
    print(f"classes {counts['classes']}  properties {counts['properties']}  "
          f"bound {counts['propertiesWithIri']}  unbound {counts['propertiesWithoutIri']}")
    for name, m in result["measurements"].items():
        print(f"{name:9} triples {m['triples']:6}  predicates {m['distinctPredicates']:4}  "
              f"dcat {m['dcatNamespaceTriples']:4}  empty {m['zeroTripleFiles']:3}  "
              f"errors {len(m['failures'])}  invented-iris {m['manufacturedIriCount']:4}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
