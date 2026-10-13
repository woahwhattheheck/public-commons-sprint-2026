# Native semantic engine and receiving

The operator works with retained local source revisions. RDFLib 7.6.0 parses RDF,
evaluates SPARQL and compares graphs; pySHACL 0.40.1 performs SHACL validation.
The application supervises one job process, binds its original input hashes and
publishes the complete output manifest. The engine does not open a provider,
start a worker or modify the application's records.

The original graph jobs retain version 1 semantics. Version 2 dataset jobs
use the same application and worker, with explicit named-graph selection,
PyLD's URDNA2015 and a declared inventory profile for empty blank graphs.
[DATASETS.md](DATASETS.md) describes that operator workflow;
[DATASET_ENGINE.md](DATASET_ENGINE.md) defines its native contract.

## Original source workflow

1. Inspect the complete selected Turtle, N-Triples, RDF/XML, JSON-LD, CSV or JSON.
   CSV cells remain strings. Inspection lists the exact original header names and
   physical row ranges; it does not infer a schema or trim values.
2. Select graph sources and review each CSV mapping. A mapping names the original
   headers, subject template, classes, fields, datatypes, language and null values.
   Template substitutions are URI-encoded. An empty cell is null only when that
   exact value was declared null. Every emitted statement retains its source and
   mapping references, including the original row and raw field value.
3. Build a snapshot. graph.nt is the complete canonical N-Triples graph;
   graph.ttl is its lexical-preserving Turtle representation. provenance.json
   binds the exact graph SHA-256 and records all original statements, source
   revisions, mapped rows and the original-to-snapshot blank-node correspondence.
4. Select a snapshot, shape files and optional ontology files for validation.
   Inference is an explicit none, rdfs, owlrl or both choice. Native meta-SHACL
   runs on the selected shapes. An invalid or incomplete selected shape set returns its complete
   native meta-validation graph and findings with shapes_valid=false,
   data_validation_performed=false and conforms=null. The findings identify referenced definitions in other declared inputs, so the
   operator can explicitly complete the selected profile. Original bytes stay unchanged.
   The complete report graph, text and findings are retained when data is nonconforming. Nonconformance is a native result,
   not an invented customer requirement or a failed acquisition.
5. Query the selected snapshot with native SELECT, ASK, CONSTRUCT or DESCRIBE.
   SELECT retains typed SPARQL JSON and a CSV whose companion columns distinguish
   bound/unbound values, IRIs, literals, blank nodes, datatypes and language tags.
   A reviewed row limit never rewrites the original SPARQL query. If another row
   exists beyond the limit, the result explicitly states that its total is
   unknown. CONSTRUCT and DESCRIBE retain their complete graph outputs.
6. Compare two exact snapshots. RDFLib's maintained graph_diff produces complete
   additions and removals. Impact follows the reviewed predicates in both
   directions, and follows uses of a changed/visited predicate IRI. It preserves
   source and CSV-row links when the matching original provenance was selected.
   Depth and node limits are explicit. A limited impact traversal does not
   truncate the complete native graph difference.

## RDF terms and graph identity

Literal strings, language tags and datatype IRIs remain distinct terms. Native
Turtle numeric recognition is retained; a small adapter prevents the subsequent
int/Decimal conversion from discarding the original numeric token. A process-local
constructor adapter preserves normalizedString/token lexical whitespace while
retaining RDFLib's parsed value and ill-typed flag. A native TurtleSerializer
subclass quotes literals using the maintained N-Triples literal helper, avoiding
the standard pretty-printer's boolean/decimal/double lexical rewriting.

RDFLib owns blank-node canonicalization. A thin hook records its resulting node
map; it does not replace the canonicalization algorithm. Independent input
documents receive distinct blank-node scopes before their graphs are merged.
Before/after impact uses separate blank-node scopes because canonical labels are
graph-specific. URI identifiers remain comparable across snapshots.

Explicit JSON-LD typed STRING @value forms preserve their RDF lexical strings.
JSON NUMBERS follow RDFLib's native JSON-to-RDF conversion after JSON decoding;
their original numeric spelling and precision remain in the original source
bytes. The tool does not claim those JSON tokens were RDF string lexical forms.

The version 1 native job contract described here accepts RDF graphs. Native JSON-LD graph
selection is intercepted to reject every named @graph, including an empty named
graph and aliases/scoped contexts. Plain default graphs are accepted. Version 2
dataset jobs use the separate [dataset engine](DATASET_ENGINE.md) with explicit
whole-dataset identity and graph scope. They are not flattened into this graph model.

## Local evaluation boundary

Every declared input is checked again against its original byte count and SHA-256.
JSON-LD consumes the same decoded object that was checked for remote contexts and
@import. RDF/XML uses RDFLib's original SAX reader with external entities disabled,
a rejecting entity resolver and a DTD rejection handler. All data, shapes and
ontologies reach native evaluation as already parsed Graph objects.

SPARQL is parsed by RDFLib before evaluation. Native DatasetClause and
ServiceGraphPattern nodes are rejected recursively, including escaped/nested
queries. Updates are not query forms. SHACL SPARQL texts pass the same native
syntax boundary; SHACL-JS and automatic OWL imports are disabled. An owl:imports
statement remains an ordinary original assertion, but no import is fetched.
An isolated-process audit guard also rejects attempted network requests.

## Complete native receiving exercise

Install the declared runtime once, then run:

    PYTHONPATH=/ABSOLUTE/owned-runtime/site-packages \
      python examples/NATIVE_RECEIVING.py \
      --operation /ABSOLUTE/original-native-operation \
      --references /ABSOLUTE/operator/reference

The reference directory contains the unchanged delivered W3C/DCAT-AP sources.
examples/REFERENCE_INPUTS.json pins each original Git blob, byte count and license.
The original upstream notices remain with that complete source closure.

The single journey retains an operation journal and a native file manifest for
every completed job. It inspects original inputs, compares the actual published
Turtle and JSON-LD examples without assuming equality, derives a complete
Practice CSV by a recorded native query, maps it explicitly, expands the source
selection with published metadata, retains the native diagnosis of an incomplete
DCAT-AP selection and generated main/ranges pair, then explicitly selects the
separate unchanged official DCAT-AP 3.0.1 module family recorded in the reference
manifest. No source link is removed and no original constraint is rewritten. It runs all four query forms, compares source-linked changes and demonstrates a
reviewed limited impact view. It then copies the original graph and provenance
into an independent receiving directory and supplies those receiving paths to
a fresh native comparison. No original source path is required by that receiving
job. The original graph also crosses the native RDF/XML reader and an empty
default JSON-LD graph is accepted. The final lexical exercise is explicitly
authored Practice input.

Rerunning the same command verifies and reopens completed job manifests. An
interrupted computation gets a new owned output generation under the same
original job identity; its partial files are preserved. No customer or provider
operation is present. NATIVE-RESULT.json is written only after the whole original
journey completes. The surrounding application additionally owns encrypted
workspace receiving, authorization and browser lifecycle.

The source corpus is public reference material. Published CSIRO/Genoa metadata
does not assert current endpoint availability, a private SAIC ontology, a
customer system deployment or acceptance of a particular validation profile.

## Loaded engine identity

Every new native result includes `engine_source` with the SHA-256, Git blob SHA-1 and byte count of `rdf_engine.py` captured when the module loads. `summary.engine_source_sha256` carries the same identity for application displays. Publishing a later source file cannot relabel an existing worker. Earlier accepted native generations keep their original records and manifests.

## DCAT-AP source selection

The delivered 3.0.1 release contains two different shape families. The generated
constraint-ID family under `shacl/` is retained with its actual meta-validation
findings. It is not silently rewritten or mixed with the separate executable
module family to conceal an unresolved reference.

The release index identifies `html/shacl/shapes.ttl`, `range.ttl` and
`mdr-vocabularies.shape.ttl` as its modular profile. The native journey selects
exactly those three unchanged files for a new validation job. Their internal
namespace/version statements are preserved, including older version strings.
The source manifest records the exact release commit, file blobs and selected
W3C DCAT 3 ontology. It retains the optional recommended-properties and deprecated
URI profiles separately. Vocabulary import manifests are original acquisition
references: no vocabulary is fetched during a native job. Results describe the
selected retained graph and ontology; they do not claim that unselected remote
vocabulary assertions were present. An operator can capture additional reviewed
vocabularies as source revisions and select them explicitly for a later job.
