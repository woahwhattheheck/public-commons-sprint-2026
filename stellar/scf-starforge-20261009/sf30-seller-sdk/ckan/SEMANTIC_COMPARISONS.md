# Saved catalogue snapshot comparison

Open **Semantic validation → Compare editions** to compare two retained native
RDF snapshots in the existing catalogue project. The original engine computes
the full added and removed statements and traces relationship impact within an
explicit selected scope. The same results, decisions and original files are
available through the CLI, authenticated HTTP and merchant MCP tools.

The comparison uses the unchanged Commons
[semantic operator source](https://github.com/woahwhattheheck/commons/tree/db959ff77f113d3344a155835693c7021fc5823d/revenue/semantic_interoperability_operator).
Its RDFLib graph comparison and blank-node canonicalization remain the original
implementation. The workspace manages selection, execution, retained files and
receiving around that engine.

## Choose the ordered pair

Each side selects an existing terminal semantic run with a completed native
snapshot. Its exact run SHA-256, source catalogue or migration candidate,
profile, base IRI, native receipt, graph and original provenance are retained
with the comparison.

The selected snapshot can remain useful if a later class query or SHACL phase
failed. Eligibility comes from the completed original snapshot and its complete
receipt. A running attempt or an absent snapshot cannot be selected.

Before starting, inspect both side panels:

| Retained selection | Purpose |
| --- | --- |
| Catalogue or candidate identity and SHA-256 | Identifies the exact source bytes. |
| Saved run and its SHA-256 | Identifies the immutable attempt that produced this snapshot. |
| Profile and its SHA-256 | Identifies the original context, shapes, parameters and attached audit. |
| Context SHA-256 and treatment | Shows which local context interpretation produced the RDF. |
| Base IRI | Shows the explicit relative-identifier interpretation. |
| Graph and provenance files | Binds the exact completed native snapshot and original source references. |

Different profiles or bases can be selected deliberately. Their changes may
contribute to the graph difference, so the result should be described in terms
of both source selections. Selecting the same snapshot twice is also valid and
provides an explicit unchanged-source comparison.

Each selected graph and provenance file must fit 64 MiB. This input limit is separate from the interactive row-reader and complete-output limits.

The workspace copies four original files into the comparison input set: before
graph, before provenance, after graph and after provenance. It verifies each
against the saved source run, its exact original snapshot generation and native
receipt. The engine validates the provenance against the selected graph and
typed statement inventory.

## Set relationship impact scope

The complete RDF graph difference is computed for the ordered pair. Relationship
impact is a separate traversal with explicit settings:

| Setting | Default | Supported selection |
| --- | ---: | --- |
| Predicate IRIs | Empty list | Up to 256 distinct absolute IRIs; an empty list follows all resource edges. |
| Depth | 2 | 0 through 20. |
| Visited-node limit | 100,000 | 1 through 100,000. |
| Native phase time | 120 seconds | 5 through 600 seconds. |
| Native phase memory | 1,024 MiB | 256 through 4,096 MiB. |

Selected predicate IRIs constrain incoming and outgoing resource-edge traversal.
The original engine also follows uses of a visited predicate IRI. Depth zero
retains selected changed seed nodes without further traversal. The node limit
can limit even the initial seed selection.

These settings and their exact values remain in the saved comparison.
Changing the scope starts a new comparison; it does not rewrite an earlier
result. A retry can explicitly link the same pair and parameters to an earlier
attempt.

The existing semantic interpreter selection and pinned native requirements
apply. See [Catalogue semantic validation](SEMANTIC_CATALOGS.md) for setup,
native source selection, supported input representations and original project
operation ownership.

## Interpret the complete difference and selected impact

A completed native result contains the original summary and complete output
files. The browser presents graph difference and relationship impact separately.

Graph difference includes before/after/common triple counts, exact additions
and removals, and the original equivalence result. Its
`graph_difference_complete` field remains the authority for completeness.

Relationship impact includes visited nodes, traversed relationships, selected
depth/predicates/node limit, and the original truncation result. When
`impact_truncated` is true:

- The native graph additions and removals are still complete.
- `impact_total_within_depth` is unknown.
- `observed_candidate_nodes_at_least` is a lower bound.
- Some retained traversed relationships may reach a node excluded by the
  visited-node cap.

Preserve those relationships when receiving or analysing the result. A view of
only the visited nodes cannot replace the original relationship file.

IRIs are shared identifiers across snapshots. Blank nodes remain scoped to
before and after graph identity. The original RDFLib comparison handles graph
equivalence and blank nodes; a textual N-Triples or JSON difference would have
different semantics.

Equivalent graphs can produce zero changes and zero impact nodes. An empty
display can also result from a filter, an unavailable native result, or a file
that requires direct download. The interface labels these states explicitly.

## Read the original rows and files

Three row sections are available:

| Section | Original file | Contents |
| --- | --- | --- |
| Changes | `changes.jsonl` | Every added or removed typed RDF statement, its snapshot and original origins. |
| Nodes | `impact.json` | Visited typed nodes, snapshot scope, distance, reasons, changed-subject flags and original origins. |
| Relationships | `impact-relationships.jsonl` | Every relationship actually traversed under the selected scope. |

The complete additions and removals are also retained in N-Triples and Turtle.
Native HTML/report artifacts, jobs, source receipts, logs and failure output
remain downloadable with their exact lengths and SHA-256 digests.

Browser pages contain 50 rows. CLI and HTTP pages support up to 500; MCP pages support up to 100. Follow
`page.nextOffset` until null to receive the complete filtered result. Text
search uses the original typed row data. The change filter applies to added or
removed statements; the snapshot filter applies to changes and relationships.
Nodes carry their own native snapshot scope.

The interactive row reader handles original files up to 64 MiB. Larger files
return `DOWNLOAD_REQUIRED` with the exact original artifact descriptor and
unknown displayed total. Download the complete file to inspect it. Complete
native files use the original retained-file reader and streamed CLI export;
the full comparison output limit remains 2 GiB.

For immutable reports, the browser reuses the already inspected record while
paging. A new review hash refreshes its decision history. Individual row and
file reads verify their selected original bytes; full inspection and workspace
archive validation still verify the full retained inventory.

## Record an operator decision

A decision pins the exact comparison SHA-256 and exact latest review SHA-256.
The first decision explicitly selects a null previous review. Concurrent
decisions are detected, and reviews are append-only.

A completed comparison supports **Accept**, **Changes required** or
**Acknowledge**. Failed or interrupted attempts support acknowledgement.
Record the intended use and the actual selected scope in the note. A completed
comparison with limited relationship impact retains that qualification in its
result and decision history.

A semantic comparison decision remains independent of catalogue migration
release selection. Existing JSON catalogue comparison, conservation review,
SHACL results, cutover and rollback remain available in the same project.

## CLI

Run the following from a source checkout. The installed equivalent replaces
the long Node entrypoint with `starforge dcat`.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-cli.mjs semantic-compare \
  --workspace /absolute/private/catalogue \
  --before BEFORE_RUN_ID --before-sha256 BEFORE_RUN_SHA256 \
  --after AFTER_RUN_ID --after-sha256 AFTER_RUN_SHA256 \
  --depth 2 --node-limit 100000

node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-cli.mjs semantic-comparison \
  --workspace /absolute/private/catalogue --comparison COMPARISON_ID

node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-cli.mjs semantic-comparison-rows \
  --workspace /absolute/private/catalogue --comparison COMPARISON_ID \
  --section changes --offset 0 --limit 500 --change added

node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-cli.mjs semantic-comparison-rows \
  --workspace /absolute/private/catalogue --comparison COMPARISON_ID \
  --section relationships --snapshot after --offset 0 --limit 500

node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-cli.mjs semantic-comparison-review \
  --workspace /absolute/private/catalogue \
  --comparison COMPARISON_ID --comparison-sha256 COMPARISON_SHA256 \
  --expected-review none --decision ACKNOWLEDGE \
  --note "Describe the reviewed graph changes and relationship scope."

node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-cli.mjs semantic-comparison-export \
  --workspace /absolute/private/catalogue --kind artifact --id COMPARISON_ID \
  --key ARTIFACT_KEY --out /absolute/private/exports/changes.jsonl
```

Use the actual saved IDs and hashes. Optional `--predicates IRIS.json` selects
a complete local UTF-8 JSON array of predicate strings; the default is an empty
array. `--timeout-seconds` and `--memory-mib` explicitly set native resource
limits. `--retry-of` links an earlier saved comparison with the same pair and
scope.

Export supports `comparison`, `review` and `artifact`. Use the selected
review ID when exporting a decision. Exports are create-only and stream large
files to a private temporary path, verify their identity, then publish the
complete destination filename.

## HTTP and MCP

The original authenticated catalogue listener exposes:

| Method | Path | Operation |
| --- | --- | --- |
| POST | `/api/dcat/semantic/comparisons` | Compare an exact ordered run pair. |
| GET | `/api/dcat/semantic/comparisons/:id` | Inspect the full retained comparison and reviews. |
| GET | `/api/dcat/semantic/comparisons/:id/rows` | Page a selected original result section. |
| POST | `/api/dcat/semantic/comparisons/reviews` | Append an operator decision. |
| GET | `/api/dcat/semantic/comparisons/files/:kind/:id` | Download a complete selected file; artifact requests include `key`. |
| GET | `/api/dcat/semantic/comparisons/guide` | Read this guide. |

Merchant MCP tools use the prefix
`merchant_ckan_dcat_semantic_comparison_` with `status`, `start`,
`inspect`, `rows`, `review`, `files` and `file_read`. Mutations
retain the existing `expectedOperationId` guard. Source run hashes and
comparison/review hashes remain explicit arguments.

MCP pages preserve typed original rows. If an individual row exceeds response
capacity, its position and complete-file continuation remain explicit. File
reads use the original retained-file SHA-256, read ID, offset and release
mechanism.

## Portable receiving and continuation

Finish or cancel active operations, then export the original whole catalogue
workspace. The archive retains source catalogues and candidates, profiles,
validation runs, ordered comparison selections, all native files and both
decision histories.

Receive it into a new private project directory using the archive SHA-256.
The original immutable semantic namespace keeps its recorded historical
identities during destination relocation. Inspect the received comparison,
page every required section and download its original files. Close and reopen
the receiving project to continue using the retained results.

A receiving-side review appends to local history. Export a following archive
after local changes; the sender remains unchanged. The existing comparison
customer continuation exercises the two original GSA catalogue snapshots,
the same-snapshot path and an explicit small impact cap, then full independent
receiving and cold reopen using this same workflow.
