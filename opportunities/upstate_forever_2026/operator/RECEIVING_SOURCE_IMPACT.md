# Receiving source impact

TokenJunkieLabs / Ecosystem Sciences

## Review a saved source edition against existing water studies

Open **Receiving source impact** in the original operator. Choose a saved Source
Updates plan, then choose **Saved plans** or **Saved analyses**. The desk works
with both the maintained edition format and the original roots format through
the existing Source Updates façade.

Each page inspects at most ten original study records by default. A page can
contain no matching studies and still have a next page: continue with **Next
records**. The count explicitly reports inspected records, related records on
that page and total saved records. It does not claim a whole-workspace affected
total. Unreadable or oversized records are listed separately and are never
counted as unrelated.

**Inspect** opens the selected study's exact source bindings and saved change
reasons. **Open original plan** or **Open original analysis** returns to the
existing Receiving desk, where the original revision forms preserve complete
requested selections. No source, feature ID, analysis selection or native run
is changed by this impact desk.

A source edit may deserve review without changing geography or model values.
Body hashes, companion hashes, native reader layout, computational metadata
and lineage metadata are shown separately using the original saved refresh
assessment. Original and replacement collection IDs and source IDs stay
explicit. Removed/unmapped originals stay visible.

## Consumed inputs and retained context

The Receiving plan's original `identity.selection` is authoritative:

- Every receptor's `source` is consumed to prepare receptor geometry.
- `catchments` is consumed only when at least one original relationship uses
  `upstream_huc`.
- `identity.source_identities` records sources actually consumed by the
  original preparation. Its compact body identity and feature count are
  displayed separately; it also admits an actual compiled consumed source
  absent from the expected structural selector locations.
- Other explicit source selectors retained inside intake metadata,
  classification, evidence or an unused optional catchment selection are
  **context/provenance**. They remain traceable, but their presence alone does
  not assert a geometric or numerical dependency.

The impact desk does not carry native feature IDs into a replacement source.
The original feature chooser and full-selection revision form remain the
place to inspect a replacement layer and deliberately select its native
features. A changed container hash is not an assertion of geographic gain or
loss. The original plan-comparison workflow can compare saved editions after
an operator prepares one.

## Existing analyses and current successor records

For each analysis, the service validates the immutable original analysis
record and its exact plan-record SHA. It follows every retained original run's
actual grid, profile and scenario definitions:

- grid input sources and reporting/model-domain masks;
- the profile's biophysical source;
- original scenario patch-mask sources.

These current dependencies are inspected even when a run was created after
the saved refresh snapshot or is outside an original roots-format selection.
The desk labels whether the original run appeared in the saved refresh
assessment. It does not rewrite that historical assessment.

The refresh state's run mapping is a recorded relationship, not evidence that
execution finished. On **Inspect**, the service reads the actual target run,
validates its original selection identity and completed-model record, checks
that its grid/profile/scenario IDs agree with the saved refresh mappings, and
uses the Receiving engine's original `_validate_runs` to check the current
baseline/alternative grid, profile and land-cover cohort.

The displayed result is specifically a **run-selection check**. It is not an
assertion that a new receiving analysis has been computed or that its raster
support, requested pollutants, physical quantities or executed model-version
cohort have been verified by this view. Those remain the original analysis
engine's authority. A missing mapping, unfinished target, unavailable original
or incompatible cohort is explicit. Unaffected original runs can remain
unchanged.

Even when the record check passes, this desk does not seed a successor
selection or queue a run. The original analysis remains bound to its original
plan and cohort until the operator explicitly chooses a revision.

## Downloads, reopen and changing workspaces

**Download this impact record** asks the server to serialize the scoped
selected-record result as UTF-8 JSON. This preserves original numeric metadata
rather than round-tripping it through browser numbers. The artifact schema is
`upstate.receiving-source-impact/v1`; its filename is
`receiving-source-impact-<plans|analyses>-<original-id-prefix>.json`.
It retains the saved refresh snapshot, original study identity, matching
source bindings, original change reasons and the current run-selection result
when applicable. It is a read-only inspection artifact, not a new scientific
report edition or a revised study.

The selected refresh/study IDs are remembered per workspace in session storage.
Reopening reads the original records again. **Reload current records** takes
a fresh saved-refresh snapshot and returns pagination to the beginning.
Pagination and details use an expected refresh fingerprint; a changing refresh
operation requires reload instead of silently combining mappings from different
points in time. The saved-study ID inventory is similarly checked across pages.

Requests are guarded by the original workspace and mounted-view generation.
Changing workspace, selecting another refresh or closing the desk invalidates
pending results and downloads. Polling the host state does not repeatedly
scan the saved study folders; reload and navigation drive bounded reads.

## Maintained interfaces

The registered extension is `receiving-source-impact`. It exposes:

```js
host.openExtension('receiving-source-impact', 'openForRefresh', {
  workspace_key: CURRENT_WORKSPACE,
  refresh_plan_id: ORIGINAL_SAVED_REFRESH_PLAN_ID
});
```

`openExtension` instantiates the registered controller. The method explicitly
uses the existing host's `navigate` capability to open its view. It does not
install a second controller. The original Source Updates owner can put this
small navigation hook beside a saved refresh plan; the impact desk also has
its own selector and does not require that optional hook to operate.

The existing authenticated extension registry owns the read route:

```text
GET /api/receiving-source-impact?workspace=<key>&action=catalog&offset=0&limit=25
GET /api/receiving-source-impact?workspace=<key>&action=page&refresh_plan_id=<id>&kind=plans&offset=0&limit=10
GET /api/receiving-source-impact?workspace=<key>&action=detail&refresh_plan_id=<id>&kind=analyses&id=<id>&snapshot=<expected>
GET /api/receiving-source-impact?workspace=<key>&action=download&refresh_plan_id=<id>&kind=analyses&id=<id>&snapshot=<expected>
```

Model entry points are `catalog`, `page` and `detail` in
`model/receiving_source_impact.py`. The provider adds the original workspace
key and serializes the download. No operator action or background task is
registered. No file ticket, source snapshot, cache file or new native job is
created.

Default study pages inspect ten records; the API maximum is 25. One analysis
may contain at most 64 retained runs in this bounded view. A larger analysis
is explicitly listed as uninspected and remains available in the original
Receiving desk. Folder enumeration reads names, not every record body. A
64-entry in-memory LRU retains only compact projections and checks file size,
mtime and ctime before reuse; it never holds geometry or opens/materializes
source views. Actual run completion is re-read for the selected detail.

The component fragment `receiving-source-impact.json` retains the complete
new family and requires the actual `source-updates` and
`receiving-waters` families. It adds no reverse edge to either owner.
The existing portable capture recursively retains model, operator and
integration source; no workspace data folder or capture lock is introduced.

## Original browser course and rendered acceptance

Stable selectors for the existing native browser course:

- `[data-receiving-source-impact]`: desk root, current `data-refresh`,
  `aria-busy` while a page/catalog is loading;
- `[data-rwi-refresh]`: original saved refresh selector;
- `[data-rwi-action="plans"]` / `analyses`: source-plan/native-analysis tabs;
- `[data-rwi-action="detail"][data-id]`: inspect exact original study;
- `[data-rwi-detail][data-id]`: ready original detail; loading uses
  `aria-busy="true"`;
- `next`, `previous`, `more-refresh`, `more-bindings`, `more-runs`,
  `reload`, `download`, `open-original`, `open-plan`, `close-detail`:
  scoped `data-rwi-action` controls;
- error regions use `role="alert"`; the bounded page loading status uses
  `[data-rwi-loading]`.

AGENTS 2026-10-13.1 requires opening the exact outgoing app, looking at its
actual rendered desktop and narrow screenshots, and operating relevant
populated, empty, loading, error, download and reopen controls. Source checks
and API review alone do not establish client readiness. Continue the existing
E8D9/SOL61 receiving course, using actual saved refresh/study IDs when present;
do not create a substitute native job or invented source refresh to manufacture
acceptance.
