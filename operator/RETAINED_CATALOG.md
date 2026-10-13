# Responsive retained-record navigation

The ordinary model API continues to return complete retained records.
`Workspace.overview()`, the default `GET /api/state`, `GET /api/item`, and
`GET /api/task` retain their original full-detail behavior.

The current browser requests `GET /api/state?compact=1` for periodic refresh.
Older servers ignore that optional query and return their existing full state.
The scientific records and source files remain at their original paths.

## Direct item lookup

`Workspace.retained_item(kind, id)` opens only the selected original record.
Immutable source/profile/scenario/observation and other saved JSON kinds still
pass through `_get`, including its original canonical-content identity check.
Grid, run, comparison, delivery and other mutable state kinds use their exact
maintained directories and require the record ID to match the selected ID.
Incomplete or failed records remain inspectable.

The operator preserves its existing type-specific handling after lookup:
source member tickets, original observation files, community-source links,
spatial export inspection and detailed conservation portfolios.
Reading one selected item no longer constructs unrelated source, run or delivery
inventories. An absent selected record returns the existing ITEM_MISSING response.

## Compact polling contract

`Workspace.operator_overview()` uses the same overview assembly with one change:
delivery rows are catalogue projections. All other workspace categories retain
their existing record shapes. Extension state providers continue to receive their
original operator/workspace context.

A delivery catalogue row retains its ID, state, complete selection, dates, error,
package metadata and other top-level metadata. It replaces the detailed maps with
their exact keys, and adds `map_count` and `file_count`. The original
`parcel_priorities.features` count and, when present, the single original
`files.parcel_csv` descriptor remain available to the conservation portfolio
picker. Its selected delivery ID and complete scenario selection still enter the
original native inventory API. All remaining file descriptors, manifest,
priority and parcel feature inventories are opened through the original detail
or dedicated delivery-inspection endpoints. The row carries
`_catalogue.schema = upstate.operator-record-summary/v1` and
`full_record_available = true`.

Compact task polling preserves every original top-level task field: exact
payload, operation/request IDs, workspace/action/state, timestamps, attempts,
errors, transfer origins and handler metadata. Only two known core result
inventories are reduced:

- `delivery.build`: the same delivery catalogue projection.
- `source.import`: original source-collection metadata and ID, plus
  `entry_count`; the full entries remain in the original item/task endpoints.

Every extension task result remains unchanged. Native run request equality,
programme/decision reconciliation, study/economic completion, source-workbench
collection IDs and project-transfer recovery therefore keep their original data.
Task detail remains complete and creates its ordinary selected-result tickets.

## Core source, observation and run catalogues

Compact polling also reuses the original core collection readers through
`model/operator_catalog.py`. All source entries and their original metadata
remain present. The other immutable source/profile/scenario/community/review and
planning records keep their existing shapes. Before a changed immutable file
enters the cache, its canonical content must match the original filename identity,
using the same `digest(value) == id` check as `Workspace._get`.

Observation catalogue rows retain the original metadata, ID and exact
`row_count`; their full `rows` stay available from the ordinary observation
item and model APIs. Native run rows retain selection, runtime, state, artifacts
and the existing `stage_summary` fields: original stage names,
started/completed/reuse timestamps, actual file counts, and each completed stage's
original runtime provenance. Stage runtime remains the execution authority when a
partially completed run resumes under a later runtime; no version is inferred from
its requested model selection. Compact internal stage
presence is retained until the programme catalogue has checked the original native
scope. The browser receives the same stage summary as before.

The programme catalogue still observes the original execution locks, progress and
pause controls on every refresh. Unchanged file metadata is reusable; active
execution state is not inferred from a cached lock. Experiment, parameter-study
and registered extension catalogues retain their existing APIs and complete
extension result shapes.

One additional core cache per Workspace shares the same 8 MiB / 2,048-record
budget across its collections. Source edits, native progress, newly imported
records and deleted files are picked up through the existing paths and signatures.
A record above the cache budget is returned in full through the selected catalogue
contract and simply is not retained in the cache. These bounds control retained
memory, not the number of observations, runs, scientific files or operations.

After updating the maintained application, continue the existing native operator
operation. Refresh an already populated Workspace, open an original source and
observation, and inspect a saved native run. Compare its retained `row_count`
and stage file counts with those exact original records. Full `Workspace.overview()`
and default `/api/state` continue to provide the previous complete model view.
Repeated compact requests should reuse unchanged record projections while actual
native progress and source imports remain visible.

## Task submission and saved views

Task submission keeps a separate bounded catalogue of original task identities,
workspace IDs, request digests, states and creation times. Completed result bodies
are not repeatedly parsed while the global submission lock is held. Candidate
matches retain the original most-recent-first ordering. Before returning any match,
the operator reopens that full original task and checks its workspace, active state
and exact request digest again. The existing operation-ID check, atomic queue
creation, task response, execution, cancellation and recovery remain unchanged.
This request cache retains at most 32,768 metadata records / 16 MiB; larger histories
still work through the original files.

Saving a guided view resolves its selected records directly in the same Workspace.
The original project, source-selection, paired baseline/alternative, comparison and
map-pack checks still run, followed by unchanged optimistic-revision validation,
note-history retention and atomic save. Invalid or absent selections keep the
original JOURNEY_SELECTION response; malformed retained scientific identities still
raise their original validation error. Complete original catalogues remain available
to full model/detail callers.

The existing native continuation should submit an ordinary already-supported action,
retry its same operation identity, and save/reopen the current guided view. Reused
requests must return the same full original task; a deliberately stale saved-view
revision still returns JOURNEY_CHANGED.

## Retained study catalogues

Compact polling also uses the original parameter-study and scenario-experiment
checkpoints. A parameter-study row keeps its complete checkpoint metadata,
selection, model scope, pollutants, progress, errors and artifact descriptors.
Its case array is replaced by the exact original case count already shown by the
operator. The immutable experiment specification is separately content-verified;
the same original model validator binds both full and compact checkpoint reads
to that specification and the current project. A changed specification is checked
even when the checkpoint itself is unchanged.

Scenario-experiment rows retain their entire original checkpoint shape, exact
integer count strings and original updated-time/identity ordering. Their original
schema, identity and project checks are shared with the full model reader.

Each catalogue has an independent default 2,048-entry / 8 MiB cache retention
budget. A large valid checkpoint or specification is read normally when it does
not fit. State replacement invalidates the projection through the existing file
signature; no checkpoint, native case or source edition is rewritten. Global
polling retains the existing saved-checkpoint semantics: opening the selected
parameter study still refreshes its actual native cases through the original
inspect path. Full model lists, selected results and original exports retain
their complete records.

On the same retained native study, compare the parameter/scenario rows from the
original full state request with its compact request while no task is writing.
They should retain the same values and ordering. Continue an actual existing
case and confirm its newly saved checkpoint appears on the next refresh, then
open that study and its original full case/results table. This follows the
existing native programme without creating a replacement scientific dataset.

## Programme activity and project continuity

The original programme activity service persists for the operator lifetime.
Changed programme records pass the same complete identity, selection and run-binding
validation as the full native manager. Its cached projection keeps the original
title, project, baseline and every run key/native selection needed by the activity
view. Global summaries keep only the latest retained attempt per run; the full
programme progress and histories remain in their original files and full APIs.

Programme progress signatures are checked on each summary request. The current
project is checked again after a cache hit, and actual programme/native execution
locks plus pause controls are read on every response. Completion counts still use
the current original run states and selections; cached metadata never stands in
for an active process. The dedicated activity read retains its original full
progress reader and unchanged bindings/request response protocol.

Project continuity caches only its existing five-field transfer list after the
unchanged complete transfer-content and captured-task digest validation. A cache
hit must still belong to the current scientific project. Full inspection,
restoration, input-file verification, capture locking and replay continue through
the original service. The transfer-plan form uses the existing compact task/core
catalogues for the identities, state, selection and origins it already displayed;
selected archived tasks and actual capture inputs are still loaded in full when
the original operation is created.

Both services use the existing independent 2,048-entry / 8 MiB retention budgets.
A record that exceeds its budget remains readable. These projections are local to
the operator process; the complete scientific workspace and transfer editions are
unchanged.

In the existing native operation, refresh a saved programme while an actual case
changes state and a pause request is recorded. Its activity should reflect those
original changes while retaining the same run bindings. Open Project continuity,
inspect an original transfer and create its original plan; compare its counts,
selected task identities and saved view with the full retained source. Continue
the existing capture/receive workflow with the same project and task identities.

## Cache lifetime and bounds

The cache contains canonical JSON bytes of a projection, never a shared mutable
dictionary. Each return decodes a fresh value; adding downloads or changing a
browser-facing row cannot mutate a later response.

Each original file is checked using device, inode, size, nanosecond mtime and
nanosecond ctime. A changed signature triggers a new read. Before/after descriptor
checks detect modification during a read. Atomic replacement leaves a coherent
opened edition; an edition that is no longer current is returned as that
consistent snapshot but is not cached. The next refresh observes the new file.

The cache retains at most 2,048 entries and 8 MiB of serialized projection bytes,
using least-recently-used eviction. These are memory-cache bounds, not limits on
scientific records, sources, alternatives or output files. An oversized projection
is returned normally without being cached. Zero cache limits disable reuse.
Deleted paths are removed when the original directory is enumerated. Caches are
process-local, disappear on restart, and require no workspace index migration.

## Native receiving check

Use the existing operator application and Workspace after updating the complete
component. Open one saved delivery and one original source. Their full details
and selected downloads must remain available. Refresh the normal desktop while
an existing task progresses; observe its original request, state and completion
on the same task and workspace IDs.

A focused cache check can run in the existing Python environment from the
application root. It uses a temporary metadata record and leaves the Workspace
unchanged:

```python
from pathlib import Path
from tempfile import TemporaryDirectory
from model.common import atomic_json
from model.record_catalog import ProjectedFileCache

with TemporaryDirectory() as directory:
    path = Path(directory) / "record.json"
    atomic_json(path, {"id": "original", "state": "queued"})
    cache = ProjectedFileCache(max_entries=2, max_bytes=1024)
    visits = []
    def project(value):
        visits.append(value["state"])
        return value
    first = cache.read(path, project)
    first["state"] = "caller edit"
    assert cache.read(path, project)["state"] == "queued"
    assert visits == ["queued"]
    atomic_json(path, {"id": "original", "state": "active"})
    assert cache.read(path, project)["state"] == "active"
    assert visits == ["queued", "active"]
    cache.retain_paths([])
    assert cache.read(path, project)["state"] == "active"
    assert visits == ["queued", "active", "active"]
```

This check verifies warm reuse, isolation from caller mutation, atomic replacement
invalidation and eviction. Actual catalogue counts, source identities and native
model results come from the receiving Workspace.
