# Dataset engine contract

This module extends the existing retained-input semantic operator with explicit RDF dataset semantics. The operator workflow is documented in [DATASETS.md](DATASETS.md). This document specifies the deterministic engine, source boundaries, artifact identities, query and validation scopes, and the meaningful source operation.

The original graph-mode job schema and graph artifacts remain supported by the original engine. Dataset jobs select their data model explicitly. They never silently flatten named graphs into an ordinary graph.

## Native implementation and source boundary

The dataset module uses RDFLib **7.6.0** for TriG, N-Quads, Turtle, N-Triples, RDF/XML, local JSON-LD, SPARQL parsing and evaluation; pySHACL **0.40.1** for SHACL; and PyLD **3.3.0** for **URDNA2015**. It reuses the original engine's CSV parser, reviewed mapping validation, literal-lexeme handling, graph parsers, query guard, query result serialization, and SHACL implementation. It does not provide a replacement RDF grammar, SPARQL evaluator, or SHACL validator.

Canonicalization metadata is:

    {
      "algorithm": "URDNA2015",
      "implementation": "PyLD",
      "version": "3.3.0",
      "profile": "commons-semantic-dataset-inventory/1"
    }

The inventory profile is described below. It is a declared Commons extension for complete graph inventory; it is not a claim to implement RDFC-1.0 or to produce unmodified URDNA2015 N-Quads when empty blank graph membership affects labeling.

Every input is an already retained, absolute local file, declared with a unique key, format, exact byte count and SHA-256. The module verifies all declared original bytes before an operation. It preserves source IDs, revision metadata and original bytes through the existing caller. Its only writes are files in the caller's fresh, owned result directory.

The original native scope disables network access while a job executes. JSON-LD contexts must be local inline values; remote contexts and imports are refused. RDF/XML external entities and DTDs stay disabled. OWL import statements remain data and do not authorize fetching an ontology. SHACL uses the original explicit inference profile, with advanced features, JavaScript and OWL imports disabled.

Primary implementation sources:

- [RDFLib 7.6.0 graph and Dataset API](https://rdflib.readthedocs.io/en/7.6.0/apidocs/rdflib.graph/)
- [Pinned TriG parser](https://github.com/RDFLib/rdflib/blob/7.6.0/rdflib/plugins/parsers/trig.py)
- [Pinned N-Quads parser](https://github.com/RDFLib/rdflib/blob/7.6.0/rdflib/plugins/parsers/nquads.py)
- [Pinned JSON-LD parser](https://github.com/RDFLib/rdflib/blob/7.6.0/rdflib/plugins/parsers/jsonld.py)
- [Pinned SPARQL evaluation](https://github.com/RDFLib/rdflib/blob/7.6.0/rdflib/plugins/sparql/evaluate.py)
- [Pinned SPARQL query context](https://github.com/RDFLib/rdflib/blob/7.6.0/rdflib/plugins/sparql/sparql.py)
- [PyLD 3.3.0 release](https://pypi.org/project/PyLD/3.3.0/)
- [Released URDNA2015 implementation](https://github.com/digitalbazaar/pyld/blob/3ac1987d9be3648c09b7c7e34865ce82d637e742/lib/pyld/canon.py)
- [pySHACL 0.40.1 release](https://pypi.org/project/pyshacl/0.40.1/)
- [Pinned pySHACL validator](https://github.com/RDFLib/pySHACL/blob/0.40.1/pyshacl/validator.py)

## Job and result envelopes

The callable is:

    execute(job, input_paths, output_dir) -> result

Dataset jobs use schema **commons-semantic-native-job/2** and parameters.data_model equal to **dataset**. The action remains one of inspect, snapshot, validate, query or compare. Each input entry uses the existing key, format, bytes, sha256 and optional source metadata fields. input_paths maps those keys to the actual original local files.

The result uses schema **commons-semantic-native-engine-result/2** and retains the existing action, summary, files and warnings structure. Each file descriptor has path, media_type, role and title. The existing worker hashes and adopts these files into the original Store.

The result captures the module's exact source bytes at import, including SHA-256 and Git blob identity. It also records the supporting original RDF engine source identity and the actual installed dependency versions. A pinned-version mismatch refuses execution.

### Graph selectors

A graph is selected by one of these exact objects:

    {"type": "default"}
    {"type": "uri", "value": "https://example.org/graph"}
    {"type": "bnode", "value": "c14n0"}

The blank-node value excludes the _: prefix. It must come from the retained whole-source inspection or snapshot catalogue. A label from another parser invocation, document or edition does not establish identity.

The URIs urn:x-rdflib:default and urn:commons:semantic:dataset-default are reserved only as native graph identifiers. An input naming a graph with either URI is rejected explicitly. Their appearance as ordinary RDF subject, predicate or object IRIs does not turn that term into the default graph.

### Formats

TriG, N-Quads and local JSON-LD can retain named graphs. The declared format names are trig, nquads and json-ld. Original turtle, nt and xml graph inputs enter the dataset's default graph. CSV and JSON inspection retain the original behavior; CSV becomes RDF only through an explicitly reviewed mapping.

Native parser hooks register empty TriG and JSON-LD graph declarations. N-Quads has no statement for an empty graph, so an external N-Quads file alone cannot supply that inventory. The engine reports this limitation. A retained N-Quads snapshot is paired with its graph catalogue.

Only RDF 1.1 subject, predicate, object and graph terms are accepted. Generalized predicates, quoted triples and other RDF-star/RDF 1.2 term extensions are outside this profile. Simple literals and explicit xsd:string denote the same RDF 1.1 value representation, and language tags use lower case for identity. Numeric typed lexical values are preserved; "050.0" is not rewritten to "50". Original source bytes preserve source spelling and syntax.

## Canonicalization and complete graph identity

Each original RDF document is parsed and canonicalized as a whole **before** graph selection. Blank nodes shared between that document's graphs remain one node. The source's entire blank-node map, including graph names, then receives a document scope derived from the declared input key, source ID, revision and original SHA. Different input documents are never joined merely because they use the same blank-node label.

Selected source quads and reviewed CSV output are merged and canonicalized as one dataset. Graph names participate in the same blank-node mapping as subjects and objects.

PyLD's pinned canonicalizer mutates its supplied RDF term dictionaries and treats its own canonical prefix specially. The module supplies copied dictionaries and first changes all input blank labels to a temporary namespace, including labels from previously canonical N-Quads. It verifies the native issuer map against the native serialized result.

### Empty blank graph labeling profile

Ordinary quad canonicalization cannot distinguish two quad-symmetric blank nodes when only one names an empty graph. Assigning empty graph inventory after quad labeling could therefore give isomorphic datasets different catalogue identities.

The inventory profile supplies an auxiliary statement for **each empty blank graph** to the same native URDNA2015 labeling problem. Its subject is that graph's blank node. Its predicate, object and graph are fresh internal IRIs, chosen deterministically to avoid every actual RDF IRI, graph IRI and literal datatype in the input. The URI family is urn:commons:semantic:empty-graph-inventory:N with suffixes :member, :Graph and :graph, using the first collision-free nonnegative N.

These statements are used only to determine the native blank-node labels. They are removed before every N-Quads, TriG, catalogue count, provenance record, query, validation and comparison. No auxiliary graph is added to the retained graph inventory. Isolated empty blank graph names are included by the same mechanism. No second canonicalization algorithm is implemented.

If no empty blank graph requires an auxiliary statement, the quad labeling is ordinary PyLD URDNA2015. Otherwise, emitted N-Quads use the declared inventory profile's labels. Consumers must use the recorded profile and catalogue to reproduce the complete dataset identity.

### Dataset digest

dataset.nq contains the complete sorted canonical quad bytes under the recorded profile. nquads_sha256 hashes those exact bytes.

dataset_sha256 hashes this exact byte concatenation:

    b"commons-semantic-dataset-identity/1\n"
    + canonical_nquads_bytes
    + b"\0"
    + json_bytes(ordered_graph_selectors)

json_bytes is the original engine's UTF-8 JSON encoding: ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False, followed by one newline. Graph selectors are ordered by their compact, sorted-key, Unicode JSON representation.

The ordered inventory always includes the default graph, even when empty. It also includes every selected named graph, including empty URI and blank graphs. Dataset identity excludes origins, input filenames, source revisions and other provenance metadata. Those are independently retained and hashed in their original artifacts.

Two artifacts with the same quad bytes can therefore have different dataset identities because their empty graph inventory differs. Conversely, a changed source filename or origin record does not change an otherwise identical semantic dataset.

### Catalogue and companion validation

graph-catalog.json uses schema **commons-semantic-graph-catalog/1** and contains data_model, canonicalization, dataset_sha256, nquads_sha256, quad_count and an ordered graphs array. Each graph row contains graph, quad_count, empty and origins. Inspection and snapshot rows retain input_key, original sha256, source_graph, source ID and revision where supplied.

A companion catalogue must match the exact selected N-Quads byte hash, parsed quad count, complete graph inventory, per-graph counts, empty flags, canonical graph order and dataset digest. Duplicate graph names, omitted represented membership, altered canonical bytes or a different profile are refused.

The catalogue can add only graphs that are absent from the N-Quads and have zero quads. It cannot invent a nonempty graph or reassign a source quad. Restoring or reusing a snapshot must retain the pair; the existing portable handoff includes both.

## Inspect and snapshot

Inspect parameters include input_key and optional source_catalogs, an object mapping the N-Quads source key to its declared JSON catalogue key.

RDF inspection writes dataset.nq, dataset.trig, graph-catalog.json, inspection.json and report.html. inspection.json uses **commons-semantic-dataset-inspection/1** and contains kind=rdf_dataset, the exact source entry, dataset and N-Quads hashes, graph and quad counts, complete graph rows, descriptive term statistics, and a limited typed quad preview. The statistics explicitly describe a union for descriptive counts only; they do not change query or validation scope.

Snapshot parameters are:

    {
      "data_model": "dataset",
      "data_keys": ["selected"],
      "source_graphs": {"selected": "all"},
      "source_catalogs": {},
      "mappings": []
    }

A source_graphs value may instead be a graph-selector list. An omitted entry means all. The selection must refer to graphs from that exact whole-source inspection. Selecting only named graphs still leaves the dataset's required empty default graph.

Reviewed CSV mappings keep their existing parser and field contract. Every dataset mapping additionally records destination_graph explicitly. The destination may be default or a named IRI, and is retained even if the CSV has no data rows. A blank graph name is not accepted as a CSV destination. Null handling uses only the entered null_values; values, identifiers, datatype and language declarations are not inferred.

Snapshot artifacts are:

| File | Role | Meaning |
| --- | --- | --- |
| dataset.nq | dataset | Complete canonical quads under the recorded profile |
| dataset.trig | trig | Same RDF dataset, including explicit empty graph blocks |
| graph-catalog.json | graph_catalog | Complete canonical graph identities and counts |
| provenance.json | provenance | Complete quad, graph, input and CSV-row origins |
| report.html | report | Summary, selected sources and complete graph inventory |

Provenance uses **commons-semantic-dataset-provenance/1**. Each quad includes typed terms, graph selector, exact canonical N-Quads line and original origins. RDF origins bind the selected source SHA and whole-source canonical quad. CSV origins retain raw cells, logical and physical row locators, mapping edition, field rule, datatype, language and destination. Source selection and blank-node scope maps are explicit. This is source traceability, not verification that an imported source's assertions are true.

## Explicit SHACL scope

Validation parameters name dataset_key, catalog_key, shape_keys, ontology_keys, inference, allow_infos, allow_warnings and:

    {"validation_scope": {"mode": "per_graph", "graphs": [graph_selector]}}
    {"validation_scope": {"mode": "union", "graphs": [graph_selector, graph_selector]}}

graphs may be all. At least one selected graph is required.

For per_graph, the module builds one ordinary RDFLib Graph for each selected catalogue graph, including an empty selected graph. Each is validated independently. For union, it builds one ordinary Graph from exactly the selected graphs. It does **not** pass an RDFLib Dataset to pySHACL, whose pinned validator otherwise enables default_union.

Shape and ontology inputs use the original graph-only source parser and original reviewed composition. A shape dataset is not silently flattened. Explicit inference remains none, rdfs, owlrl or both. Invalid shape composition and native validation failure remain distinct from nonconforming data.

The module retains each original text/RDF/findings report under a target prefix and writes aggregate findings.json with schema **commons-semantic-dataset-findings/1**. Every finding has target_id, the exact validation scope, source dataset identity, native finding fields and relevant source quads with graph membership. Empty scopes cannot produce a vacuous compliance result. Overall conforms is null when data could not be assessed.

## Explicit SPARQL scope

Query parameters name dataset_key, catalog_key, query, row_limit and:

    {
      "query_scope": {
        "default_graph": "default",
        "named_graphs": "all"
      }
    }

default_graph is default or union. named_graphs is all or an explicit list of named URI/blank selectors; the default selector is not accepted there.

- default reads the retained default graph only for ordinary basic graph patterns.
- union copies the retained default graph and **only the selected named graphs** into an explicit query default graph.
- GRAPH sees only the selected named graphs. Empty selected named graphs remain registered.

The query Dataset has default_union=False. The original parsed query guard rejects FROM and SERVICE and allows SELECT, ASK, CONSTRUCT and DESCRIBE. No text rewrite adds a LIMIT, changes a GRAPH name or invents a graph selection.

A query-local guard around the pinned native evalGraph checks actual bound graph membership before delegating. This includes names supplied through VALUES. It prevents an empty pattern from matching a missing or excluded graph and prevents the native default sentinel from being exposed as a named graph. The original function is restored in finally; graph-mode jobs are unaffected.

RDFLib can return a blank graph name through a GRAPH variable. SPARQL GRAPH constants use IRIs; a query _:label is not a stable way to select that retained blank graph. Use the catalogue selection and a variable.

The original typed SELECT JSON/CSV, ASK and complete graph-result serializers are reused. SELECT observes at most row_limit plus one row to report truncation; when truncated the total remains unknown. CONSTRUCT and DESCRIBE are ordinary graph results by their query semantics and are labeled accordingly. dataset-query-scope.json binds the exact scope, original dataset/catalogue sources and result model.

## Comparison and impact

Comparison requires before_dataset_key, before_catalog_key, after_dataset_key and after_catalog_key. Optional before_provenance_key and after_provenance_key select exact retained provenance. The parameters also record edge_predicates, depth, node_limit and:

    {
      "comparison_scope": {
        "graphs": "all",
        "impact_mode": "within_graph"
      }
    }

The graph list can select graphs present on either side, so a removed graph remains comparable. impact_mode is within_graph or union.

The complete selected canonical quad difference and complete graph-inventory changes are always retained. A moved statement is not hidden because its union triple remains present. A separate ground-membership report identifies definite membership changes for equal nonblank RDF triples in default/IRI-named graphs.

Canonical blank labels are local to a whole dataset. Changes can relabel connected nodes. Matching c14n text across editions does not establish business identity, and the canonical quad difference is not a minimum-edit or common-subgraph matching claim. The warning applies to blank graph names as well. A reviewed source identifier or explicit application mapping is needed for business identity.

Impact traversal preserves before/after sides separately, even for equal IRIs. within_graph remains inside each original graph. union allows traversal across the selected graphs within the same snapshot; every relationship still includes its actual graph and side. Traversal uses incoming and outgoing selected resource edges, plus uses of a visited predicate IRI. Empty graph changes are reported directly without inventing an RDF edge.

depth and node_limit bound impact only. Complete additions/removals and graph-inventory changes are not truncated by those limits. Unknown total impact remains null when limited. Provenance, when selected, is validated against the full dataset and catalogue and every typed quad before use.

Outputs include additions.nq, removals.nq, graph-changes.json, changes.jsonl, impact-relationships.jsonl, impact.json and report.html. Added/removed N-Quads keep their respective snapshot labels; they are change fragments, not independently canonicalized standalone snapshots.

## One meaningful source operation

[examples/dataset-inputs/receiving-inputs.json](examples/dataset-inputs/receiving-inputs.json) pins the exact shared inputs used by the deterministic operation and the native UI/receiving continuation. It names the unchanged previously shipped W3C conformance-standards.trig separately from the explicitly authored development derivation.

The authored pair has a measurement node shared across named graphs; an activity spanning default and named graphs; a blank graph name also used as an object; empty IRI and blank graphs; an exact decimal lexeme; and a corrected edition that changes a value, moves graph membership and renames an empty IRI graph. The shapes demonstrate a failing single-graph check and a conforming explicit selected union. Additional small authored files cover separate-document blank labels, inline JSON-LD, CSV destination mapping and the quad-symmetric empty-graph identity case.

Run the pure operation with an existing pinned runtime:

    python3 examples/DATASET_ENGINE_OPERATION.py --output /absolute/new-operation

Use --resume for its retained journal after an interruption. The script uses the same source files and original execute entry point, records actual results as it progresses, and starts no browser, provider, worker service or second Store. Expected assertions in the input manifest are not observed outcomes until the operation returns its actual result.

The full native continuation uses examples/DATASET_RECEIVING.mjs with the same input manifest and the original operator's source, snapshot, scope, review and receiving paths. Its actual saved receipts establish which parts completed; source publication alone does not imply that a run or external client acceptance occurred.
