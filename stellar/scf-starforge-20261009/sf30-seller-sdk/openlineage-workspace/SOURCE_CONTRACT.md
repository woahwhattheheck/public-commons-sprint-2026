# Original OpenLineage source contract

This application reads original OpenLineage events and retains their complete
source documents. Its operational projection has named, versioned adapters.
The original event and facet bytes remain the source of truth for further
producer-specific interpretation.

## Supported core versions

| Core version | Operational event kinds | Original schema |
| --- | --- | --- |
| 1-0-1 | RunEvent | https://openlineage.io/spec/1-0-1/OpenLineage.json |
| 1-0-5 | RunEvent | https://openlineage.io/spec/1-0-5/OpenLineage.json |
| 2-0-2 | RunEvent, JobEvent, DatasetEvent | https://openlineage.io/spec/2-0-2/OpenLineage.json |

The adapter reads the original HTTPS schema origin, version and event-kind
fragment. The 1-0-1 RunEvent fragment uses /definitions/RunEvent; 1-0-5 uses
/$defs/RunEvent. The maintained upstream fluentd event_full.json declares
1-0-5 with the older /definitions/RunEvent fragment. The application retains
that exact declaration and names its compatibility interpretation
core-1-0-5-legacy-run-pointer in the original event record.

The adapters check the operational fields used for identity, chronology,
boundaries and facet projection: eventTime with a timezone, producer and
schemaURL URIs, namespaced job/dataset identities, native UUID run IDs,
declared lifecycle states, arrays of source datasets, and facet producer/schema
metadata. They retain other upstream and custom properties unchanged in each
parsed original event. A custom facet can be inspected without an installed
semantic graph adapter.

The operational adapter is explicit about the versions and fields it interprets.
Full arbitrary custom-facet JSON Schema evaluation belongs to the producer's
declared schema and is not performed by this dependency-free reader. Unsupported
or malformed operational events remain available with intake diagnostics and
their exact source file.

Official source:
https://openlineage.io/docs/spec/object-model/
https://openlineage.io/docs/spec/facets/

## Original identity and event order

A job or dataset is identified by its exact namespace and name. A run keeps
its native UUID together with the owning job namespace and name. Repeated UUIDs
under different jobs remain separate observations and produce a diagnostic.

Logical event identity is the SHA-256 of its complete canonical JSON value.
This permits a repeated original event in more than one source document while
preserving every source position. It does not collapse all events for a run,
or all events having the same lifecycle state.

Projection follows eventTime, including sub-millisecond fractional ordering,
then original intake sequence for ties. The workspace retains original
timestamps; it does not replace them with local receiving time.

Each source has an SHA-256 over its exact original UTF-8 bytes. Array sources
retain zero-based member indexes; NDJSON sources retain one-based physical
line numbers. Blank NDJSON lines do not alter the remaining physical positions.

## Run lifecycle and metadata supplements

The current core makes eventType optional. When present, the adapter uses the
states declared by that version. START records the first start; COMPLETE,
FAIL and ABORT retain the original first terminal outcome and its timestamp.
A subsequent conflicting lifecycle observation stays in the event history
and adds a run issue. OTHER contributes metadata without resetting the outcome
or duration. A run lacking a lifecycle state remains OBSERVED.

JobType emissionPattern metadata is retained. COMPLETE_SNAPSHOT observations
replace the reported run boundary set; ordinary accumulative observations merge
new input/output identities. OTHER remains a metadata supplement. STREAMING or
SERVICE metadata does not imply that the absence of COMPLETE is a failed run.

Run-specific inputFacets and outputFacets stay with their original run
observations. They do not become global dataset facets.

## Facets and lineage

A later observation of a same-named facet replaces that facet's complete value.
The application does not recursively merge old nested facet fields into a new
producer declaration. A JobFacet or DatasetFacet with _deleted removes that
facet from the relevant current selection while the original event remains
inspectable.

JobEvent declarations remain a distinct job-level input/output structure.
RunEvent observations retain their own run boundaries. A later static job event
does not rewrite the inputs and outputs of an earlier run.

The explicit lineage adapter reads:

- LineageJobFacet entries from the original 1-0-0 LineageFacet schema.
- LineageDatasetFacet inputs and fields for the facet's owning dataset.
- Typed JOB and DATASET references, including a JOB's optional native runId.
- Field inputs, source field names, target field names, transformations, and
  complete original field metadata.
- The maintained ColumnLineageDatasetFacet family as a fallback when an
  explicit lineage declaration for that scope and target is absent.

A JOB reference without namespace/name uses the enclosing job as defined by
the facet. Empty explicit inputs remain an explicit absence of upstream
dependencies. Explicit facet replacement and deletion remove the superseded
relationships from the active graph. observedEdges retains the original
per-event relationship history.

When only event input/output arrays exist, the graph retains dataset-to-run
and run-to-dataset observations. It does not derive a dataset-to-dataset
Cartesian product. Where a run or job carries explicit lineage, its contextual
input/output boundaries remain separately available without allowing traversal
through those boundaries to invent extra dependencies. The lineage response
includes exact source event, facet path, schema and transformation context.

Official explicit facet:
https://openlineage.io/spec/facets/1-0-0/LineageFacet.json
https://openlineage.io/docs/spec/facets/job-facets/lineage/

## Saved editions, reviews and results

An edition captures the original source IDs and logical event IDs currently
present. Later intake leaves those identities unchanged. Edition comparison
reports added/removed/changed entity definitions and added original events.

Reviews record a decision and reason against original entity keys and,
optionally, a saved edition. Review revisions preserve the prior review record.
An attached result requires a real saved edition, existing entity selection,
complete file bytes and a source reference. Original result bytes are addressed
by SHA-256. The source reference and query explain the intended relationship;
the application does not infer a missing upstream execution from an attachment.

## Receiving

The receiver verifies the package payload and each complete object. It parses
every original source again to reconstruct event order, schema interpretation,
member positions and source references. Supplied indexes must agree with those
original bytes. Each edition's event membership must match its original selected
sources. Reviews and results must reference entities that exist in their selected
edition.

The export includes the entire portable application. Receiving verifies its
declared files and installs them into application/; it preserves the original
workspace history and records a new local installation identity. The application
is started explicitly using its included CLI.

Hashes establish complete-byte identity and internal consistency. Source
origin is recorded through the supplied producer/source metadata and original
repository pins.

## Retained upstream examples and schemas

fixtures.json is the complete machine-readable inventory of the unchanged
upstream files, their original paths, source-tree pin, Git blob SHA, byte length
and immutable GitHub API URL. The full source-tree pin is
07864a6b5f5d30b878e157eba8409dda84d68d4f in OpenLineage/OpenLineage.

| Local original | Upstream path | Git blob |
| --- | --- | --- |
| fixture-event-simple.json | proxy/fluentd/events/event_simple.json | 3b6936894172b4fc78f9b385771695fb6e2a8720 |
| fixture-event-full.json | proxy/fluentd/events/event_full.json | d0f19663859955c95afde83bd7bd3fcdffc641e8 |
| fixture-lineage-mixed-sources.json | spec/tests/LineageFacet/mixed-sources.json | b93a3502f5f711aacc52dec765a1e50b635c8a27 |
| fixture-lineage-dataset.json | spec/tests/LineageFacet/dataset-to-dataset.json | 3541805ffabf604f9fb1c8398e0388d0d97e8a67 |
| fixture-lineage-implicit-job.json | spec/tests/LineageFacet/implicit-job.json | 69c153f006d97018d0d41097e9f93579d449cd3b |
| schema-core-1-0-1.json | website/static/spec/1-0-1/OpenLineage.json | 1215bd651abe077924f402ef8854f948a380859d |
| schema-core-1-0-5.json | website/static/spec/1-0-5/OpenLineage.json | 92ba83147885c9b5ae1a1124d8d01d49b9f1d3cc |
| OPENLINEAGE_LICENSE | LICENSE | 261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64 |

RECEIVING.mjs verifies each upstream Git blob identity before its native
application journey. It imports both complete upstream events, saves two editions,
compares them, inspects the original entity and lineage, records a review,
attaches the original mixed-sources field-contract file as a reference,
recovers an existing import response, exports all source and result bytes,
receives a separate workspace, and starts its included application.

Run the one complete programme in a new directory:

    node RECEIVING.mjs /absolute/private/openlineage-receiving

The output includes the actual operation results, complete JSON/CSV/HTML reports,
the complete editable workspace package and its received copy. An interrupted
operation retains the state and its original error for direct continuation and
correction.

The OpenLineage originals are Apache-2.0 licensed. OPENLINEAGE_LICENSE contains
the unchanged upstream license. The application and its own operating programme
are MIT licensed under LICENSE.
