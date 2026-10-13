# Working with named-graph datasets

The dataset workflow uses the same Sources, Mappings, Snapshots, Validation,
Queries, Changes, Jobs and Receiving views as the original graph workflow.
Saved graph jobs keep their version 1 contract. Dataset jobs use version 2 and
retain the complete graph catalogue alongside their canonical quad bytes.

## Retain and inspect the original source

In **Sources**, choose **TriG dataset** or **N-Quads dataset** and retain the
original file with its reference, edition and license. Local JSON-LD can also
be inspected as a dataset. **Inspect dataset** performs an original native job
and exposes the graph catalogue, including the default graph, named graphs,
quad counts and empty graphs. Open the completed job and preview its catalogue.

The public reference collection includes the unchanged W3C
`w3c/examples/conformance-standards.trig`. It has a default graph describing
quality and provenance and a named `https://dcat.example.org/testResult`
graph. These are public reference data, with their original source and license
in `reference/SOURCE-MANIFEST.json`.

N-Quads cannot encode the existence of an empty graph. When importing an
exported `dataset.nq`, attach its matching `graph-catalog.json` using
**Optional graph catalogue companion**. The source revision retains both
original artifacts. Their byte identities are checked together before the
native job reconstructs the dataset. An external N-Quads file without a
catalogue supplies only the graph membership represented in its bytes.

A TriG or JSON-LD source is parsed as one dataset, so a blank node shared
between graphs remains shared. Separate source documents retain separate
blank-node scope. A graph selector shown after inspection belongs to that
exact source edition.

## Build an explicit dataset snapshot

Select the original RDF data and CSV mapping revisions in **Snapshots**, then
set **Snapshot model** to **Dataset with named graphs**.

For each RDF source, select **All graphs** or choose individual graph
identities from its completed inspection. Sources without a completed dataset
inspection can still be included in full. Inspect them first when selecting
individual graphs.

For each CSV mapping, select a **Default graph** or enter a **Named graph IRI**
as its destination. This choice belongs to the snapshot; it does not revise
the original mapping or infer a graph name from table contents. Each generated
statement retains its source row, original lexical cell and mapping edition.

A completed dataset snapshot has these independent downloadable files:

| Artifact | Purpose |
| --- | --- |
| `dataset.nq` | Complete canonical N-Quads, with graph membership |
| `dataset.trig` | A readable dataset serialization |
| `graph-catalog.json` | Every graph identity and empty-graph presence |
| `provenance.json` | Original source, source graph and mapped-row lineage |
| `report.html` | Native operation summary and selected source context |

Canonicalization uses **URDNA2015 implemented by PyLD 3.3.0**, with the declared
`commons-semantic-dataset-inventory/1` profile. When an empty graph has a blank
name, that identity participates in the same labeling operation through
collision-free temporary membership statements. The engine removes those
statements before emitting RDF. The catalogue records the profile with the
algorithm and implementation version, so another consumer can reproduce the
same labels from the complete dataset and catalogue.

The N-Quads SHA-256 describes the emitted quad bytes under that declared
profile. The dataset SHA-256 additionally binds the ordered graph inventory,
so an empty graph can change dataset identity without changing the N-Quads
bytes. Source provenance remains separate from semantic identity. Keep the
N-Quads and catalogue together when reproducing an identity that includes
empty blank graphs.

Canonical blank-node labels describe the structure of one snapshot. They do
not establish that a node in another edition is the same business entity.
Use stable source IRIs when that cross-edition identity is required.

## Validate a graph or a selected union

Choose the dataset snapshot and exact SHACL and ontology revisions in
**Validation**. The extra **Validation graph mode** controls whether the
engine validates each selected graph separately or creates an explicit union
of selected graphs for that run.

Per-graph validation can produce different results from validation of a
union: a required relationship may be in another graph. Select the intended
scope and inference mode as engineering inputs. The native worker constructs
the selected graph explicitly before calling pySHACL, avoiding an implicit
dataset-wide union.

The saved result retains the selected graph identities, findings, conformance
information, shape-source editions and full native reports. Invalid shapes
remain an explicit outcome. A review decision pins the exact validation
record, not the current source heads.

## Query the selected dataset view

In **Queries**, choose:

- **Retained default graph only**, or **Default plus selected named graphs**;
- all named graphs, or the exact named graphs available to `GRAPH`.

A default union joins the retained default graph with precisely the selected
named graphs. It does not add unselected graphs. `GRAPH` retains the selected
named-graph view.

For the bundled W3C dataset, a local query can inspect the named result graph:

```sparql
SELECT ?s ?p ?o
WHERE {
  GRAPH <https://dcat.example.org/testResult> { ?s ?p ?o }
}
ORDER BY ?s ?p ?o
```

SELECT results preserve URI, blank-node, literal, datatype, language and
unbound distinctions. The existing row limit remains explicit. FROM, SERVICE,
remote contexts and external imports cannot fetch unretained data. Dataset
catalogues remain authoritative for graph identity, including empty graphs;
a query result is an observation of its selected SPARQL view.

## Compare editions and review the change

Choose two dataset snapshots in **Changes**. Select graph scope, relationship
predicates, traversal depth and the impact node limit. **Impact traversal
scope** chooses relationships within each graph or across the selected union.

The complete comparison retains additions and removals as quads. Moving a
statement from one graph to another is a membership change even when its
subject, predicate and object stay the same. Graph inventory changes are
separate, so adding or removing an empty graph stays visible. The impact
limit applies to the traversal; it does not truncate the complete quad
difference.

A graph snapshot and a dataset snapshot have different models. Build two
snapshots in the same model before comparing them. Revise the original source
or mapping, build a new dataset snapshot, compare it to the previous one,
then record the decision against that exact comparison revision.

## Handoff, reopen and continue

Use the original **Receiving** handoff and encrypted **Recovery** workflows.
Dataset files, companion catalogues, source editions, pinned native jobs,
attempts, results and decisions travel with the same SQLite workspace and
content-addressed artifacts.

The receiving application understands graph job version 1 and dataset job
version 2. An older graph-only receiver rejects dataset jobs instead of
flattening them. Keep the complete current application and its pinned
dependencies with the handoff. The source packager includes both engines and
the native dataset controls.

The original worker owns cancellation and continuation. **Continue original**
uses the same pinned source bytes and scope, retaining earlier attempts. A
source correction is a new source revision and a new operation; it never
rewrites a completed job.

See [DATASET_ENGINE.md](DATASET_ENGINE.md) for the native parameter and artifact
contract, [OPERATING_GUIDE.md](OPERATING_GUIDE.md) for the shared controls and
[RECEIVING.md](RECEIVING.md) for the original completed graph receiving.

## Continue the dataset operation from its retained inputs

`examples/DATASET_RECEIVING.mjs` operates the original application using the
exact dataset input manifest from the engine operation. It requires an
existing Python environment with the pinned dependencies, an existing
Playwright module and an existing Chromium binary.

```sh
node examples/DATASET_RECEIVING.mjs \
  --workspace=/absolute/new-dataset-workspace \
  --operation=/absolute/dataset-operation \
  --inputs=/absolute/receiving-inputs.json \
  --python=/absolute/existing/python \
  --playwright=/absolute/existing/playwright-module \
  --chromium=/absolute/existing/chromium
```

The operation retains its step journal and exact original downloads outside
the workspace. Resume with the same arguments after an interruption. It
reads saved operation identities before submitting a command and continues
accepted native jobs through the original job controls.

Its journey includes the unchanged W3C source, explicit graph choices,
the separately labeled authored baseline and correction, SHACL in each
selected scope, cross-graph query results, full quad and graph-inventory
comparison, a source-bound internal review, complete handoff into a new
receiving parent, independent reopening of that received workspace, and
catalogue-preserving reuse of emitted N-Quads. The authored inputs are
development observations; they do not stand for SAIC data or acceptance.

`DATASET-STATE.json` records resumable progress. A completed
`DATASET-RESULT.json` names the actual received workspace, original file
hashes and complete handoffs. It is only marked closed after the original
host and browser have exited.

To deliver the complete source together with that finished workspace, pass
the completed result to the existing release builder:

```sh
python BUILD_RELEASE.py --output=/absolute/Complete-Semantic-Operator.zip \
  --source-commit=FULL_PUBLISHED_COMMIT \
  --dataset-result=/absolute/dataset-operation/DATASET-RESULT.json
```

The builder verifies the original handoff hash, every original archive member
and its received workspace identity. The resulting package contains
`receiving/Dataset-Workspace.zip`, the exact result and `receiving/START.txt`
beside the full operator source. Omitting `--dataset-result` keeps the
source-only packaging workflow.
