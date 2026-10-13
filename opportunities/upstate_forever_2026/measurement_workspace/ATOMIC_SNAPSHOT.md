# Consistent original measurement snapshot

The maintained Measurements service exposes a read-only GET snapshot operation
for consumers that need the complete filtered population and its portable source.

From the existing Python bridge:

~~~python
snapshot = service.json("GET", "snapshot?" + urlencode(filters))
~~~

The response contains:

| Field | Native content |
|---|---|
| revision | Original nonnegative measured-data revision |
| total | Complete filtered record count |
| records | Full original record views in sampled-date descending, ID order |
| portable | Original upper-savannah-measurements/v1 workspace, including all source tables |
| summary | Original store summary plus the native reach list read for eligibility |

Each full record includes the original normalized fields and raw row, source
references, review, station mapping, selected revision, variants, eligibility and
complete event history. The original recordDetail method now supplies both an
individual record read and this snapshot; there is one interpretation of these
fields.

Supported filters are stationId, parameter, fraction, unit, censor, from, to and q.
They use the same existing bound SQL filter implementation as normal measurement
paging. The optional expected_revision query parameter rejects a stale request
with HTTP409 before materializing the full population. It must be an exact
nonnegative safe integer. Pagination keys are rejected because this operation
returns the whole selected population.

## One request and one database snapshot

The Python service resolves and verifies its original native domain once for this
request. The Node store reads the resulting domain once, then uses the existing
readConsistent transaction for revision, full filtered records, source references,
histories, the portable document and summary. All SQLite data therefore comes from
the same read snapshot.

The original portable document body is factored into portableDocument. Standalone
portable() continues to own its own consistent read transaction. The new fullSnapshot
calls the shared body inside its existing transaction, avoiding a nested BEGIN.
Neither read increments the measured revision or creates a saved export.

This replaces a consumer's sequence of one summary read, paged projected records,
one HTTP request per full record, one portable read and another summary read.
The source revision, scientific values, filter behavior, raw source rows and
portable format remain the original producer's. Existing paged browser routes
and individual record routes remain available.

The snapshot returns a complete object; it is intended for a selected scientific
population that the consumer must retain in full. Existing disk-backed intake and
streamed exports remain their original owner's paths.

## Receiving and product inspection

Install both engine/workspace.mjs and engine/http.mjs together. The original
Measurements process loads its modules at startup; use the maintained operator's
normal restart boundary after installing changed source. Keep the same measured
workspace and original source files.

Operate the actual binding inspection on the populated receiving workspace and
confirm the native response revision, total and full source/history fields.
Before the October13 14:00UTC sprint handoff, the producing worker must LOOK at
the resulting desktop and narrow product screens and operate selection, source
inspection, downloads and reopening, then repair any rendering or control defects.
The current owner instruction is repository AGENTS.md version2026-10-13.1.
