# dcat-us-binding

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22307001.svg)](https://doi.org/10.5281/zenodo.22307001)

**The live DCAT-US 3.0 repository ships no RDF binding. Its 115 published examples
expand to 76 triples, one predicate, and zero DCAT. The binding needed to fix that is
already sitting in the JSON Schema, unpublished: 26 of 26 classes and 231 of 270
properties record the RDF term they stand for. This repository generates a JSON-LD
context and SHACL shapes from those records, and measures what changes.**

A JSON-LD context for DCAT-US 3.0 does exist, in a repository that is now deprecated.
It is not the source this measurement is against, and it carries two of the namespace
defects reported below. See
[Where the published context lives](#where-the-published-context-lives).

| Expansion of the same 115 files | Triples | Predicates | DCAT triples | Empty files | Errors |
| --- | --: | --: | --: | --: | --: |
| As published today | 76 | 1 | **0** | 38 | 1 |
| With the generated binding | **1,510** | **123** | **228** | 10 | 0 |

Nothing in the corpus is edited. The only thing added is a context that says what the
JSON keys already mean, derived from the schema rather than written by hand.

## Why generation rather than a second file

[DCAT-US 3.0](https://github.com/GSA/dcat-us) dropped SHACL in
[PR #120](https://github.com/GSA/dcat-us/pull/120) for a good reason, stated by its
maintainers: the project inherited a website, a JSON Schema and a SHACL definition that
were out of sync, with nobody left who knew which was authoritative. Collapsing to one
source of truth was the right call, and the documentation is now built from the schema.

The objection that follows is the real one: a standard implementable two ways, validated
by two artefacts that disagree, is not a standard. That is an argument for **deriving**
the artefacts, not for having fewer of them. A context and a shapes file generated from
the schema cannot drift from it, because there is nothing to drift; regenerate and the
divergence is gone. The source of truth stays exactly where DCAT-US put it.

## What it produces

| Artefact | What it is |
| --- | --- |
| `build/dcat-us-3.0.context.jsonld` | JSON-LD 1.1 context, faithful to the ranges the schema declares |
| `build/dcat-us-3.0.observed.context.jsonld` | The same, relaxed for the keys the corpus publishes as labels |
| `build/dcat-us-3.0-shapes.ttl` | SHACL shapes, 24 node shapes, 231 property shapes |
| `build/audit.json` | Where the schema disagrees with itself |
| `build/measurements.json` | Every figure quoted anywhere in this repository |
| `reports/REPORT.md` | The evidence, written from `measurements.json` |

## What the measurement found

- **The binding is already there.** 231 of 270 properties carry an RDF IRI in their
  `_oldDocs.uri`, retained when SHACL was retired. A context is a projection of the
  schema, not a new artefact to maintain.
- **Four JSON keys map to two different RDF properties**, depending on the class.
  Three of the four sit in `Document.json`, and one of those maps `conformsTo` to
  `dcterms:identifier` where five other classes map it to `dcterms:conformsTo`.
- **`Concept` and `Identifier` have no bound properties at all.** Between them they are
  the most frequently instantiated objects in the corpus. `prefLabel`, `definition`,
  `inScheme` and `notation` on a `skos:Concept` have obvious SKOS equivalents; nothing
  in the repository records them, so neither class can be given a shape.
- **22 keys are declared with a resource range and published as prose**, 100 times.
  A faithful expansion turns them into 98 invented identifiers. Whole sentences of
  `accessRights` and `provenance` become IRIs. JSON Schema cannot see this, because the
  value is a string and a string is what it expects.
- **The deleted shapes were never given anything to validate.** Run over the corpus as
  published they select zero focus nodes and report `conforms = True`, a pass that means
  nothing. Run over the same corpus once it has a binding, the same file, unchanged,
  selects 228 focus nodes and reports 287 violations.

Full working in [`reports/REPORT.md`](reports/REPORT.md).


## Where the published context lives

A reader who searches for a DCAT-US JSON-LD context will find one, so this section
records exactly what exists and why it is not what is measured here. Checked 4 September
2026.

| Repository | Description | RDF binding | Status |
| --- | --- | --- | --- |
| [`GSA/dcat-us`](https://github.com/GSA/dcat-us) | Data Catalog Standard, United States Profile (DCAT-US 3.0), Chief Data Officers Council. A fork of `infopolicy/dcat-us`. | none outside `DEPRECATED/` | live, last pushed 3 Sep 2026 |
| [`DOI-DO/dcat-us`](https://github.com/DOI-DO/dcat-us) | Chief Data Officers Council and Federal Committee on Statistical Methodology | `context/dcat-us-3.0.jsonld`, 48,311 bytes, plus Turtle serialisations of every example | **deprecated**, README points to <https://resources.data.gov/resources/dcat-us3/> |

`GSA/dcat-us` is the source this repository measures, pinned at `7a6e803`. Re-checked at
`main` on 4 September 2026: it still publishes no context, JSON-LD, SHACL or Turtle
artefact outside the `DEPRECATED/` tree, and every commit since the pin is a
`transform.py` fix. So a publisher following the live source has nothing to expand
against, which is the condition this repository measures.

The deprecated context is worth reading rather than ignoring, because it is the control
case for the argument in the previous section. It is hand-maintained, and it has drifted:

- `"dcat-us": "http://data.resources.gov/ontology/dcat-us#"` and
  `"dcat-us-shp": "http://data.resources.gov/shapes/dcat-us#"`. The host does not
  resolve, and the working name is `resources.data.gov`.
- `"org": "http://www.w3c.org/ns/org#"`. The canonical namespace is
  `http://www.w3.org/ns/org#`. A browser follows the `w3c.org` redirect, so the error is
  invisible to a human reader while minting different IRIs for every term.

Both are reported independently in `namespaces.json` here, from the schema rather than
from that file. A context generated from the schema cannot acquire either defect, because
there is no second artefact in which a hostname can be typed by hand. That is the whole
argument, and the deprecated context is the evidence for it rather than a counterexample
to it.

**Not yet done:** a property-by-property comparison of the deprecated context against the
generated one. That measurement would quantify the drift instead of naming two instances
of it.

## Reproducing

```sh
pip install -e '.[dev]'
make build      # clones GSA/dcat-us at 7a6e803, generates build/
make report     # rewrites reports/REPORT.md from build/measurements.json
make test       # asserts every headline figure above
```

The test suite pins the numbers. If upstream changes, the tests fail rather than letting
the report drift away from the corpus it describes.

## Relationship to GSA/dcat-us

This repository is not a fork and proposes no change to the upstream one. It reads the
published schema, generates artefacts from it, and reports what they measure. Everything
here can be consumed, ignored, or reimplemented upstream without a pull request from
anyone. The discussion that prompted it is
[GSA/dcat-us#163](https://github.com/GSA/dcat-us/issues/163).

Upstream is CC0 1.0, a work of the United States Government. The generated artefacts in
`build/` are dedicated to the public domain under CC0 on the same basis. The generator
code is MIT.

## Verification

Every RDF figure is produced twice, by rdflib 7.6.0 and by the
[Open Ontologies](https://github.com/fabio-rovai/open-ontologies) Rust engine, and every
SHACL figure by pySHACL and the same engine. Where they disagree, the disagreement is
reported rather than resolved in favour of the convenient answer. Two of the gaps found
this way are defects in the Open Ontologies engine and are queued against it; a third is
in rdflib. The repros are in
[`tests/test_engine_findings.py`](tests/test_engine_findings.py).
