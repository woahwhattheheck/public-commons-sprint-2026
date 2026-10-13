# Geographic selected-Study operator continuity

This addition preserves existing Programme adoption and saved-opening operations
inside the original selected-Study transfer. It creates no model runs, sessions,
operations, or archive format.

## Active transfer owner integration

Install `model/geographic_operator_transfer.py`. In the maintained
`model/geographic_study_transfer.py`, immediately after the original matched
Programme `closure.need("compute-programmes", key, ...)`, invoke:

```python
from .geographic_operator_transfer import include_programme
include_programme(closure, prepared, key)
```

At the beginning of its existing `lock_paths(closure)`, initialize the same
paths set from the helper's existing-owner session lock:

```python
from .geographic_operator_transfer import lock_paths as operator_lock_paths
paths = set(operator_lock_paths(closure))
```

Keep every other existing geographic lock. The original operation owner lock is
outside Workspace; this helper does not invent a different lock at an unused path.
Complete operation records and receipts retain their actual files through the
maintained closure read/hash/identity checks. The original transfer resolves and
checks the closure again while holding its capture locks.

The same helper runs during restored selected-Study closure verification.
For a direct geographic companion callback, after original adoption verification:

```python
from model.geographic_operator_transfer import verify_programme
continuity = verify_programme(
    restored_workspace, adoption["geographic_id"], adoption["programme_id"])
```

The current ES26 geographic-source capture and original C57E receiving caller
remain authoritative. Compose these two short hooks into their latest source;
do not replace their newer complete modules with older source postimages.

## What travels

Only complete original `geography.adopt-programme` and
`geography.open-programme` records matching the selected project, original
geographic edition and matched Programme are retained. Each opening must retain
its original adoption parent and an `opening.json` exactly equal to the receipt
in its completed operation.

The original global `operator-session.json` travels only when it still matches
the receipt, its selected scientific records match the selected geographic
opening, and no additional regional/community view is active. Existing
`verify_operator_opening` checks the original session bytes, revision, source
adoption and exact requested selection. A matching `preserved_current` receipt
keeps its original status; it does not become an applied opening.

Later edited or wider project views are never replaced with an earlier opening.
Their operation/receipt remains complete historical evidence; a matching current
view outside this selected Study is reported as
`current_view_outside_selected_study` and the global session is omitted.
Use the original full Workspace backup to carry every wider view and its
dependencies. The source Workspace remains untouched.

A study created through the CLI with no operator operations returns
`no_operator_operations` and remains fully usable. On cold reopen the original
Programme remains accessible independently of whether a project opening exists.

## Receiving

Use the existing original regional operation, source hashes and Workspace.
Keep current C57E kernel045be68b / 118c1934 and the five merged4423 operator files;
the earlier nine-file recovery bank must not overwrite the newer kernel.
Preserve the real desktop and390px receiving evidence and inspect all outgoing
maps/reports. This transfer adds no scientific outputs or rainfall/utility claims.
The Ecosystem engineering burst stops at2026-10-13 14:00UTC; preserve current
source, native output and actual receiving state at that boundary.
