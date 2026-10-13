# Continue original USDA and FEMA acquisitions after a source update

Saved acquisitions retain the original query domain, source selections, requests,
response bytes, and imported source editions. Continue reuses those original
requests with the currently installed derivation code.

## Operator and CLI

Open the saved acquisition in Conservation source capture and choose Continue.
The existing queued action remains `conservation.sources.capture` with
`{"operation_id":"<saved acquisition ID>"}`. A saved running state can be resumed
after its process exits; the acquisition lock identifies an actually active
operation.

From the application root:

```sh
python -B -m source_tools.soil_floodplain_sources --workspace WORKSPACE overview
python -B -m source_tools.soil_floodplain_sources --workspace WORKSPACE resume ORIGINAL_ID --retry-failed
python -B -m source_tools.soil_floodplain_sources --workspace WORKSPACE inspect RETURNED_ID
```

Use the returned ID. If the installed source hashes are unchanged, it is the
original acquisition. If they changed, it is a current successor whose immutable
selection contains `continued_from`. Repeating Continue from the same original
and installed edition selects the same successor.

The successor preserves the original resolved source choices. It does not select
a newer imported polygon edition automatically. Original domains and source
bindings are reopened and checked before work begins. Its geometry, hydric
classification, certainty coverage, FEMA classes, and imported criteria are
derived again with the current implementation.

## Exact request reuse

The continuation helper traverses the validated predecessor chain. An acquisition
interrupted across multiple source upgrades can reuse requests from any earlier
edition. The target and all donors are locked in sorted order during capture.

USDA requests match their complete original form, URL, HTTP method, request SHA,
and response-size limit. FEMA requests match URL, HTTP method, body SHA and exact
parameters. A code change that changes a query produces a different request and
uses the ordinary original-source client.

A matching latest failed response is retained along with Retry-After. It is not
replaced by an older successful response. The original clients decide when a
failed request can be tried again. Completed, byte-verified responses are consumed
without another HTTP request.

Copied cache folders are published atomically after independent file copies,
stored-byte checks, and decompressed response-byte checks. Exact donor receipts
remain separate immutable companions even when the native client later finalizes
a working receipt. Derived family checkpoints are never copied from an earlier
implementation.

## Retained provenance and exports

Each successor retains:

- `selection.json`, with the current implementation and immediate predecessor ID.
- `continuation.json`, with both implementation maps, original request/domain
  identities, the predecessor selection body and its actual descriptor.
- One immutable reuse record for every published response transfer, naming the
  actual donor acquisition and original relative request directory.
- A content-addressed `continuation-ledger-<sha>.json` snapshot in result downloads
  and the original source manifest.
- Original request/response files and copy-origin companions. Partial imports also
  retain reused response companions from unfinished families.
- A small `continuation-reuse.json` polling summary, separate from immutable lineage.

When an original SDA geometry capture was selected by an external host path,
continuation resolves its byte-identical complete copy under the current or
predecessor acquisition. Every native page must retain the same query, complete
successful receipt, packed bytes and decompressed body. Missing original pages
are surfaced before native reading; the resolver does not replace them with new
HTTP capture. Same-directory copies are skipped on a relocated resume. The
immutable original path and source metadata stay in the selection and manifests;
only the effective read path changes.

Whole Workspace backup retains both original and successor acquisitions. Existing
imported source editions and results remain available. Source exports carry the
successor selection, immutable predecessor provenance, ledger, and actual relevant
response companions.

`inspect` and `overview` return `implementation_changed`, live `continuation`
counts, and `continued_as` successors, including for completed acquisitions.
Status polling reads each acquisition's compact state once per overview and shares
that snapshot for predecessor and successor navigation. New continuations retain a
small `continuation-metadata.json` index that omits the predecessor selection body;
older continuations derive the same navigation from retained state. Polling reads
the small reuse summary without loading query WKT, full selection documents, or
embedded predecessor bodies. Full immutable provenance remains in exports.
Successor discovery does not rewrite old records.

The counters `reused_requests`, `reused_bytes`, `reused_stored_bytes`,
`successful_responses` and `retained_failures` are also grouped by family.
`reused_bytes` counts original HTTP wire-body bytes: SDA's recorded body before
content decoding and FEMA's wire-byte identity. `reused_stored_bytes` counts all
copied request and receipt companions. Counts advance only after a verified,
atomically published transfer and remain stable when that transfer is reopened.

The helper uses the standard library and `model.common`. Native SDA and FEMA
clients remain the shared original-source implementations. The helper source
hash participates in acquisition implementation identity.
