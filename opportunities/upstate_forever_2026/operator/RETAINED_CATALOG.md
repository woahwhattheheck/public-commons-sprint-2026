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
their exact keys, and adds `map_count` and `file_count`. Full file descriptors,
manifest, priority and parcel-priority inventories are opened through the original
detail or dedicated delivery-inspection endpoints. The row carries
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
