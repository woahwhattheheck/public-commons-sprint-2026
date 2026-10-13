# Reopen the complete scientific application

The scientific workspace archive carries its retained workspace and the installed application. The receiving directory has two siblings: `application/` and `workspace/`. Launch the received application's own server with the received workspace, so its saved investigations, scenarios and scientific results use the same supplied modules.

## Capture and reopen

Run the existing workspace commands from the installed application's directory:

```sh
python -B -m model.cli --workspace /ABSOLUTE/WORKSPACE backup /ABSOLUTE/DELIVERY/workspace.zip
python -B -m model.cli restore /ABSOLUTE/DELIVERY/workspace.zip /ABSOLUTE/RECEIVED
python -B /ABSOLUTE/RECEIVED/application/model/cli.py --workspace /ABSOLUTE/RECEIVED/workspace overview
python -B /ABSOLUTE/RECEIVED/application/operator/server.py --workspace /ABSOLUTE/RECEIVED/workspace
```

The operator prints the local address to open. Use its workspace selector to confirm the original project, select a saved programme or investigation, inspect a saved result, and continue work. The original source, grid, run, comparison and project identities remain in the archive.

## Application components

Capture includes the core model and operator, source tools and source material, shared run reuse modules, singular `integration/` and plural `integrations/` packages, `eco_intelligence/`, the installed documentation, receiving tools and supporting command-line tools. Existing top-level setup scripts and environment requirements are retained. Optional components are included when installed; capture does not download a different application edition.

Python bytecode, package caches, active lock files and temporary native recovery reserves are omitted. Ordinary application source is checked again before publication so an installation changing during capture cannot silently produce a mixed application.

## Concurrent capture

Each backup invocation owns an exclusively created temporary archive. A second
capture that cannot acquire the original Workspace locks cleans up only its own
temporary file, preserving the first writer's progress. The completed archive
is still published with an exclusive link to the chosen new destination; an
archive created there by another operation is preserved. This uses the existing
source selection, full native inventory and original lock order.

## Saved database state

The project-local investigation database at `workspace/intelligence/investigations.sqlite3` is captured with SQLite's online backup API after opening a read transaction. This includes committed transactions still in a write-ahead log. Each archived database opens independently; its live WAL, shared-memory and rollback-journal companions are omitted.

The archive manifest's `database_snapshots` records identify these captures. The database is transactionally consistent at its capture point. The existing workspace lock also coordinates the product's ProjectStore writes. A persistently locked database reports its capture error without retaining archive locks indefinitely; a large snapshot that is making progress has no total-duration cutoff. A concurrent application installation or a replaced database causes capture to stop with its specific source path.

Content-addressed source objects, source editions, model runs, grids, delivery products, GeoPackages and unknown SQLite files retain their original bytes. Their checksums and scientific identities keep their existing meaning.

## Existing archives

The archive format remains `upstate.scientific-workspace-archive/v1`. Earlier archives without database snapshot records still open through the same restore command. Explicit archive inspection verifies each member against its retained length and SHA-256. Restore checks the complete manifest first, then verifies each member while extracting it, so large rasters do not need an extra decompression pass. Completed native result descriptors are bound to those verified member hashes and lengths. Saved scientific selections and their existing receiving validators are retained.

Receiving reads from one opened archive edition and records its SHA-256 before publishing the new directory. An archive that changes in place during receiving stops the operation and removes its owned staging directory. Capture also records the finished archive's identity before publication. Restore publishes into a new receiving directory and preserves existing destinations.

## Resume the same completed receiving task

Receiving now publishes `receiving-complete.json` beside `application/` and
`workspace/` in the same final directory rename. The record retains the complete
original result: the archive, project, destination and selection; original
database and acquisition records; implementation and parameter-study metadata;
saved source-context bindings; and the received delivery/navigation paths.
An interruption after that rename but before the operator saves its task result
therefore resumes the original receiving operation.

The maintained Python continuation is:

```python
from model import portable

result = portable.resume_restore(
    original_archive, original_receiving_directory,
    expected_archive_sha256=original_upload_sha256,
)
```

Use the same task, archive and destination. The optional expected digest is the
original upload or saved archive descriptor. The helper checks the original
archive and complete result binding, current project identity and destination.
It returns the original complete result with `reused_completed_output: true`.
It does not restore over the receiver, rerun a model, regenerate a report or
discard receiver-only edits. The ordinary `restore` command continues to require
a new destination; callers explicitly select the continuation helper when the
original receiving directory is already present.

For earlier receiving directories without this record, continuation first
verifies the original archive and all original received members. It recognizes
the specific saved delivery registration made by native receiving: the original
selection, fields and files, the same retained enclosing archive, and the
additive received-navigation inventory and its verified file descriptors.
Original completed delivery records remain unchanged. It applies the same
native Workspace, source, implementation, parameter-study and source-context
validators used during first receiving, then saves the recovered complete
result. Unrelated changes to an older unrecorded original member produce its
specific conflict instead of overwriting work. New recorded receiving can
resume acknowledgment after later receiver edits because its original complete
receive result was already preserved at publication.

Completed scientific report continuation composes with this archive step:
reuse the original saved preview/edition/task through the maintained
`source/observed-report-20261013/receive_operator.py` and
`model.scientific_report_editions`. Installing current rendering source does
not replace a completed original report or its selected sources. Explicitly
request a new report edition when a changed rendering is intended.

## Inspect the exact outgoing product

The producing peer opens and looks at the exact outgoing populated application
and its actual PDF/HTML reports before declaring the delivery ready. Operate the
important controls, selected-source/report views, downloads, complete archive
receiving and reopened receiver; check the actual screenshare width and relevant
narrow width (including 390 px). Inspect available empty, loading and error
states. View the real screens or captured screenshots yourself, repair clipping,
overflow, unreadable tables or broken controls, and retain the original source,
study and task identities. Use plain industrial layout and focused corrections.
Code inspection and successful HTTP or native execution do not replace this
actual rendered-product inspection. These are the owner's October 13 instructions,
as persisted in the application's current owner-directed inspection guides.

For the completed SOL13/7b7a lake-arm course, keep the original project beginning `99ae4422`,
edition `d2f1e12f9194b9a881253542f0b9a714205bec533b750ceac88e790416b1fb04`
and the original 600,289-byte archive with SHA-256
`6088fcae75b19ec2066ff524bb7209088295d2933b3cef71f836edbaeab52d7b`.
Adopt continuation at its current source boundary, reopen that original completed
result and preserve the receiver-only note; the original producing/Integration
owner retains its 390 px presentation fix and final rendered review.
