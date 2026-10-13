# Catalogue semantic validation

The DCAT catalogue workspace can retain a local JSON-LD context and SHACL shape
profile, validate an exact original catalogue or reviewed migration candidate
with the existing Commons RDFLib/pySHACL worker, inspect the complete native
findings, and record an operator decision. Profiles, catalogue inputs, native
reports and decisions travel in the original whole-workspace archive.

Open **Semantic validation** in the catalogue browser. The same operations are
available through the installed `dcat` command and merchant MCP tools. The
workspace continues to own one active operation, cancellation, the project
lease and its private retained files.

## Prepare the native interpreter

The semantic worker source is retained unchanged under
`vendor/semantic-operator/`. Its original source is
[Commons semantic_interoperability_operator](https://github.com/woahwhattheheck/commons/tree/db959ff77f113d3344a155835693c7021fc5823d/revenue/semantic_interoperability_operator).
The complete original source inventory is in `source-manifest.json`; the
installed runtime subset is in `selected-runtime.json`. The bridge checks both
inventories and the actual selected source before starting a native run.

Use the installed `dcat semantic-runtime-prepare` command to create a separate
private environment from the retained original requirements, then inspect its
complete receipt and export the exact private environment selection. Follow
[SEMANTIC_RUNTIME.md](SEMANTIC_RUNTIME.md) for preparation, complete retained
wheels and hash lock, offline reuse, interruption recovery and Applications.

The original requirements pin RDFLib 7.6.0, pySHACL 0.40.1, cryptography 50.0.1
and PyLD 3.3.0. A manually prepared interpreter with those same requirements
remains supported. The original RDF engine also checks its RDFLib/pySHACL
versions when it loads.

Set `SCF_DCAT_SEMANTIC_PYTHON` to that interpreter's absolute executable path.
If absent, the bridge uses `SCF_DCAT_PYTHON`, then `python3` from the selected
environment's PATH. The original migration interpreter selection still applies
to catalogue conversion; `PORTABLE_RUNTIME.md` describes its explicit Python
3.12 profile. Separate semantic and migration interpreters can share the same
catalogue project.

Applications uses the saved private environment JSON and selected source
manifest. The catalogue launcher and installed distribution include the semantic
modules, native runtime subset, optional profile sources and this guide. Normal
project opening and report inspection use retained files; a new semantic run
starts the selected interpreter. Dependency preparation belongs to deployment;
the workspace never downloads packages during validation. When a prepared runtime
is selected, its exact receipt and interpreter binding are retained in each new
native request and rechecked before every actual worker phase. Historical
inspection and replay remain independent of today's interpreter installation.

## Import an explicit profile

A profile is immutable. An update creates another profile and may identify
`supersedesProfileId`; older runs continue to reference the exact earlier
profile and its SHA-256.

| Setting | Meaning |
| --- | --- |
| Label | A useful name for this exact profile edition. |
| Base IRI | Explicit absolute IRI used to resolve relative identifiers in the catalogue, shape files and ontology files. Choose the intended contract value. |
| Context | One local JSON document whose only root property is `@context`. Preserve its complete original bytes. |
| Shapes | One or more original shape files; explicitly select Turtle, N-Triples, RDF/XML or JSON-LD. |
| Ontologies | Optional original RDF inputs in the same supported formats. |
| Source audits | Optional original notes, audit results and other files retained with the profile. |
| Class IRIs | Up to 256 explicit classes whose presence will be counted in the original catalogue graph. |
| Parameters | Inference mode and the original pySHACL informational/warning acceptance settings. |

Select the context policy deliberately:

- **Require absent** adds the retained context to a derived copy only when the
  catalogue has no root `@context`.
- **Replace root** replaces the root context in a derived validation copy and
  records the original selection separately.
- **Preserve** keeps the catalogue's existing local context and requires it to
  equal the explicitly imported profile context. Both selections remain retained.

Semantic preparation accepts UTF-8 JSON, including a UTF-8 byte-order mark. The original migration converter's other supported encodings remain separate. The selected native RDF graph engine also requires an ordinary graph; named JSON-LD graphs belong to the existing dataset-engine workflow.

The native preparation step rejects remote JSON-LD contexts and context imports,
including nested ones. A string IRI used as an ordinary vocabulary term is
different from a remote context request. Original catalogue bytes remain
unchanged; the prepared JSON-LD copy is an additional run artifact.

The browser accepts nonempty profile files up to 16 MiB each, 32 MiB in total,
with up to sixteen selections in each file group. CLI and MCP profile import
support up to 64 total files, 64 MiB each and 128 MiB in total. The native
semantic catalogue and each native RDF input must fit 64 MiB. The migration
workspace's larger catalogue intake limit remains available for its original
operations.

### Retained optional DCAT-US examples

The optional examples use the original source from
[Fabio Rovai's dcat-us-binding](https://github.com/fabio-rovai/dcat-us-binding/tree/4f7b991708313a205a83a04c37d6b19a2f8573ec).
The complete retained vendor source and license files preserve its authorship.
These generated contexts and shapes are an explicit third-party profile. Read
the retained `build/audit.json` and upstream README when choosing their scope.

| Profile input | Catalogue treatment | Context selection |
| --- | --- | --- |
| `semantic-profiles/dcat-us-faithful-current.json` | Requires no root context | Original faithful generated context |
| `semantic-profiles/dcat-us-observed-current.json` | Requires no root context | Original observed-resource coercion context |
| `semantic-profiles/dcat-us-faithful-legacy.json` | Explicitly replaces the root context in a derived copy | Original faithful generated context |

Each example supplies the complete original SHACL file, retained audit
attachment, declared class IRIs, and exact file lengths and SHA-256 digests.
Their `https://data.gsa.gov/` base IRI is an explicit operator-selected example
for the GSA catalogue programme. Review it before using the example with a
different catalogue. Keep a changed input file beside the original examples or
use absolute local paths, so its relative file selections stay unambiguous.

The source-faithful and observed-resource contexts make different resource
coercion choices. They should be imported as distinct profiles and their
complete results reviewed separately. The upstream audit also identifies
unbound or unresolved schema/property selections. A conforming report under
one of these retained profiles expresses that profile's actual scope.

## Select a catalogue and run

Choose exactly one retained original catalogue or one migration review
candidate. The request includes its exact source SHA-256 and the exact profile
SHA-256. A changed selection is rejected before a new run starts.

The complete native operation has three phases:

1. Build an RDF snapshot from the prepared retained catalogue using the
   unchanged original worker.
2. Run an original SPARQL query counting the declared classes in that catalogue
   graph.
3. Run the original full SHACL validation with the retained shapes, optional
   ontologies and chosen parameters.

The native worker performs shape validation and retains complete text,
machine-readable findings and RDF report artifacts. The bridge also retains
source copies, preparation description, original jobs, selected engine source
identity, native logs and output manifests. Artifact downloads expose exact
lengths and SHA-256 digests. Complete retained native output is limited to
2 GiB per run.

Default phase limits are 120 seconds and 1024 MiB. CLI and MCP may explicitly
select 5–600 seconds and 256–4096 MiB for the original worker. These are native
phase limits; one complete run includes preparation and three native phases.
Cancellation uses the original project operation and waits for the child to
drain before releasing the project lease.

A stopped or failed attempt keeps its saved outcome and available original
files. A new run creates a new immutable attempt. Opening a project after an
owner interruption reconciles retained native output; it does not silently
restart the earlier operation.

### Read the result with graph coverage

The run record contains `snapshotTriples`, `emptyGraph`, declared class counts,
and the original validation outcome. Review them together.

Class presence shows whether the chosen context produced the intended kinds
of catalogue resources. It does not enumerate every SHACL target mechanism.
The complete native report records actual findings and shape validation.
Check graph content and selected shapes when a report conforms unexpectedly,
especially when a context or profile has just changed.

Findings retain all RDF terms, original focus nodes, source statements,
constraint components, messages, details and nested results. The browser
shows pages of 50 results; CLI and HTTP support pages up to 500, and MCP supports pages up to 100. Search
and severity filters apply to the saved complete findings file. Follow
`page.nextOffset` until it is null when receiving a complete filtered set.

Severity values are the full SHACL IRIs, for example
`http://www.w3.org/ns/shacl#Violation`. The browser presents readable labels
while sending those exact values.

JSON source numbers are retained as their original tokens in the prepared
copy. The preparer checks whether the unchanged engine's JSON interpretation
can preserve the corresponding numeric value. Values beyond that parser's
representation require an explicit reviewed RDF representation before this
semantic workflow can process them.

## Record the operator decision

A terminal run can receive append-only operator reviews. Each review pins the
run SHA-256 and the exact previous review SHA-256, so a concurrent later
decision cannot be silently replaced.

- **Acknowledge** records that an attempt and its outcome have been reviewed.
- **Changes required** records the correction requested after a completed run.
- **Accept** records the intended use and any accepted exceptions after a
  completed run.

Write a concrete note identifying the intended use, relevant coverage and any
accepted exception. Failed, cancelled or interrupted attempts support
acknowledgement; complete native runs support all three decisions.

A semantic decision remains part of the project history. Catalogue release
selection and rollback use their original explicit migration actions. Existing
following-edition review continues to compare complete JSON catalogue editions
and their migration/identity changes alongside these semantic runs.

## CLI workflow

Commands below run from a maintained source checkout. For an installed package,
replace `node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-cli.mjs`
with `starforge dcat`.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-cli.mjs semantic-profile-import \
  --workspace /absolute/private/catalogue \
  --input stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/semantic-profiles/dcat-us-faithful-current.json

node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-cli.mjs status \
  --workspace /absolute/private/catalogue

node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-cli.mjs semantic-profile \
  --workspace /absolute/private/catalogue --profile PROFILE_ID

node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-cli.mjs semantic-run \
  --workspace /absolute/private/catalogue \
  --profile PROFILE_ID --profile-sha256 PROFILE_SHA256 \
  --catalog CATALOG_ID --source-sha256 ORIGINAL_SHA256

node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-cli.mjs semantic-inspect \
  --workspace /absolute/private/catalogue --run RUN_ID

node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-cli.mjs semantic-findings \
  --workspace /absolute/private/catalogue --run RUN_ID --offset 0 --limit 500 \
  --severity http://www.w3.org/ns/shacl#Violation

node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-cli.mjs semantic-review \
  --workspace /absolute/private/catalogue --run RUN_ID --run-sha256 RUN_SHA256 \
  --expected-review none --decision CHANGES_REQUIRED --note "Describe the actual required correction."

node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-cli.mjs semantic-export \
  --workspace /absolute/private/catalogue --kind artifact --id RUN_ID \
  --key ARTIFACT_KEY --out /absolute/private/exports/validation-report.json
```

Use the IDs and exact hashes returned by the actual saved project. To select a
migration candidate, replace `--catalog CATALOG_ID` with `--review REVIEW_ID`
and supply its candidate SHA-256. Export accepts `profile`, `profile-file`,
`run`, `review` or `artifact`; file exports are create-only, streamed for
large artifacts, and verified before their final name appears.

A profile input JSON file uses local file descriptors. Paths are resolved
against that JSON file's directory. Optional `bytes` and `sha256` fields bind
an expected original source; disagreement prevents import. Source files can
be ordinary readable regular files, and imported copies use the project's
private storage.

## HTTP and MCP

The original authenticated catalogue server exposes:

| Method | Path | Operation |
| --- | --- | --- |
| POST | `/api/dcat/semantic/profiles` | Import a complete profile |
| GET | `/api/dcat/semantic/profiles/:id` | Read a profile |
| POST | `/api/dcat/semantic/runs` | Start an exact selected run |
| GET | `/api/dcat/semantic/runs/:id` | Read a run and decision history |
| GET | `/api/dcat/semantic/runs/:id/findings` | Page saved findings |
| POST | `/api/dcat/semantic/reviews` | Append an operator decision |
| GET | `/api/dcat/semantic/files/:kind/:id?key=KEY` | Download the complete selected file |
| GET | `/api/dcat/semantic/guide` | Read this guide |

HTTP profile descriptors carry exact original bytes as base64 with their
length and SHA-256. Semantic control requests use ordinary JSON numbers;
original catalogue uploads keep their separate exact-number parser.

Merchant MCP tools use the `merchant_ckan_dcat_semantic_` prefix with
`status`, `profile_import`, `profile`, `run_start`, `run`, `findings`,
`review`, `files` and `file_read`. Mutations retain the original workspace
operation guard. Profile source files use retained host input selectors with
expected SHA-256. Profile file keys are explicit role keys such as `context`
and `shape-0`; native artifact keys identify full retained native paths.
Continue file reads to the returned complete length, then release the original
retained file handle.

## Transfer and reopen

Finish or cancel active operations, then use the original **Workspace** transfer
screen or `dcat archive`. Receive that archive into a new private directory
with its exact SHA-256 using `dcat receive`. The archive includes all retained
profile inputs, semantic run files, native result records and append-only
reviews. Opening the received project validates their existing identities.

Inspect the received profile and run, page its saved findings, download its
original files and confirm its review history. A new receiving host only needs
the prepared semantic interpreter when starting another native run. Keep the
whole project archive with the source/application distribution for continued
customer operation.

## Compare saved snapshots

Use **Compare editions** to select two retained native snapshots, inspect complete RDF additions/removals and source-linked relationship impact, and record a scoped operator decision. [Saved catalogue snapshot comparison](SEMANTIC_COMPARISONS.md) describes the ordered source selection, traversal limits, full files and independent receiving workflow.
