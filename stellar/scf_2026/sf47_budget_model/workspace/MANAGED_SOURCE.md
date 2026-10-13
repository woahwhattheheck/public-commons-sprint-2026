# Managed Grant source selection

The Grant application's **Review → Save → Start → Open** path uses one explicit
source inventory: [managed-source.json](managed-source.json). Both the Node
reviewer and the original Python process read that file from their own source
directory. The immutable distribution builder includes the same complete
inventory in a selected Grant package.

## Continue an existing installation

Keep the original workspace, scenario, Python executable and saved application.
A running release continues using its original installed source. Installing a
new source edition does not rewrite its launch record or saved application.

When deliberately adopting the new installed source, use the existing
Applications review and save controls, then start that reviewed edition. The
manifest bytes and every listed file enter the existing source hash map. A
changed manifest, missing file or changed executable source requires the normal
source review. Existing launch, selection, process, listener and private access
bindings keep their current schemas and comparisons.

The selected source and executing source are separate. Python's managed launch
reads the reviewed directory supplied by the original command, then independently
reads its executing directory. Node performs the equivalent execution comparison
when receiving the actual startup. Both roots must contain the identical
manifest and complete file hashes before that launch can be accepted.

## Add a complete source capability

1. Add each new runtime module, mounted browser asset and required original input
   to the ordered **files** array in managed-source.json. Keep the existing names
   and order. Paths are relative to this workspace; the existing explicit
   leading ../ paths retain their original repository locations.
2. Keep the manifest itself, both launchers, managed_source.py and the shared
   distribution reader in that inventory. Do not maintain a second list in launch.mjs or managed_launch.py.
3. Keep the capability's normal application, browser-route, command and product
   registrations. The managed inventory selects complete files; those existing
   registrations determine what the application exposes.
4. Build the original selected product from the intended immutable commit using
   the existing distribution build command and grant-operations selection. Its
   declared managedSourceManifests registration makes every inventory member a
   required package file. Missing, excluded, nonregular or oversized members
   fail in the existing source/build boundary.
5. Receive that edition through the existing owned Applications/native workflow.
   Review the original selected private workspace, start, reopen and retain the
   real result with its source identity.

There is no automatic directory expansion. Names must be normalized explicit
paths, unique, and remain within the selected repository after resolving leading
parent segments. The manifest is complete JSON up to 1 MiB; each managed source
keeps the original 1 MiB runtime limit. The private launch record keeps its
existing 256 KiB bound.

## Package and source identities

The registration is owned by
[grant-workspace.json](../../../scf-starforge-20261009/distribution/contributions/grant-workspace.json).
The shared
[managed-source.mjs](../../../scf-starforge-20261009/distribution/managed-source.mjs)
validates the committed manifest for both the Node launcher and distribution.

The builder reads the manifest from its selected Git snapshot before assembling
the package. Every member participates in the ordinary package manifest with its
original path, Git blob, size and SHA-256. Explicit package exclusions still
apply. An installed registration read validates the manifest's original bytes
and the presence of every declared member in the installed package manifest;
managed startup independently hashes the actual executable source.

The selection's sourceSha256 keys retain the original relative names.
sourceFiles follows the manifest's explicit order. Canonical selection hashing
continues to sort object keys; array order is kept for the returned source
inventory. The new manifest and reader are ordinary source changes, so they
produce a new reviewed source identity rather than silently changing a prior
selection.

## Retain required dependencies with their original entrypoints

The managed inventory includes the original module dependencies and native
helpers used by its selected entrypoints, as well as the browser assets and
guides that the existing Grant server serves. This includes the original
Support readers, buyer accounting and recovery helpers, merchant planning and
ROZO source readers, and the Merchant Grant adapters imported by the retained
case-planning receiving entrypoint. Their existing paths and engines remain
authoritative.

A copy containing only an entrypoint is incomplete when that file imports
another original module or launches a paired native helper. When preparing a
source edition, retain those complete original files in the same repository
layout. Keep Python sibling modules, module-relative worker files and the
original CLI dependencies with their calling source. Browser URL aliases still
resolve through the existing server registration; retain the registered source
filename, including downloadable operating guides such as DESK_LOADING.md.

The existing Node and Python launchers now hash these dependencies through this
same inventory. The ordinary distribution builder, installed registration,
Risk source preparer and Engagements source preparer receive them through their
existing manifest readers. No runtime directory scan or download occurs during
source selection. A missing dependency therefore fails while receiving the
selected source, before a later operator action tries to open that module.

For a future capability or dependency update, inspect the imports, paired
native helper paths and served source of the exact outgoing edition. Add every
new required original file explicitly alongside the entrypoint. Preserve all
existing entries and unrelated concurrent additions; do not replace the
inventory with a feature-specific list. Reuse original source identities when
assembling the complete receiving packet, then run the existing product and
saved-case course under the rendered-product instruction below.

## Existing source preparation and receiving

The Delivery Risk source preparer and execution owner, and the Engagements source
preparer, read this same manifest through the pure managed_source.py admission
helper. They inspect the selected Python launcher's literal manifest declarations
without importing or executing that selected application. Their existing complete
source bytes, hashes, path boundaries and publication checks still apply. The
manifest itself is captured and checked with the rest of the source selection.

Previously pinned editions with a literal BOOT_FILES declaration keep their
original admission path. Their retained source, requests and receiving operations
remain reproducible. A new manifest edition uses the original receiving owner and
workspace; it does not replace an already selected native operation in flight.

## Recovery

A changed manifest during reading returns GRANT_SOURCE_MANIFEST_CHANGED. Reopen
the intended stable installed edition and use the original review. A selected
source differing from the executing release still returns
GRANT_EXECUTED_SOURCE_CHANGED. The original request, private workspace and launch
history remain available for the same operation.

For installation, source transfer and private case receiving, use the existing
[Grant Operations guide](../../../../products/grant-operations/OPERATING.md).
