# Measurements in a complete scientific Workspace handover

The original full scientific Workspace backup now captures
`measurement-observations/measurements.sqlite` through the maintained SQLite online
backup mechanism in `model/portable_databases.py`. This is the database opened by
the original managed Measurements service. Its writer uses WAL and can remain open
while the outer Workspace exporter holds its own lock.

## What the recipient receives

The archive contains a self-contained SQLite snapshot at the original relative
path. SQLite reads committed WAL transactions into that snapshot; the exporter does
not package the live `-wal`, `-shm` or `-journal` beside it. The donor database is
not checkpointed, rewritten or shut down by this capture.

The snapshot contains the original database tables, including committed source
imports and streamed source chunks, canonical measurement IDs, source-line links,
complete rejections, station metadata and explicit assignments, review decisions,
selected source versions, event history and saved-export records. All committed
tables are captured together at one SQLite read transaction. An edit committed
after that transaction begins belongs to a later backup.

Other retained Workspace files continue through the existing portable inventory
and hash checks. This includes original domain bindings and saved measurement
population files when present. An unrelated changing companion file can still stop
capture; this change does not excuse source or artifact changes. In-progress
uploads and export working directories follow the original portable directory
selection rules rather than becoming new scientific records.

The manifest's `database_snapshots` entry for
`workspace/measurement-observations/measurements.sqlite` identifies
`sqlite-online-backup` and a self-contained journal. The original archive member
bytes and SHA-256 checks remain authoritative during restore. The receiver restores
that file under its independent Workspace root, and the existing Measurements
service reopens it normally. Later edits use the original review/import operations
and advance the receiving project independently.

This exact path is application-owned. An arbitrary source SQLite file, a similarly
named database elsewhere, and scientific source editions retain the original
byte-preserving archive behavior. No extension-wide filename pattern was added.

## Continue the existing receiving course

Use the original full Workspace backup and restore controls with the current
application. Keep the existing project's identity, source selections and native
run history. After independently restoring:

1. Open Measured observations and compare the retained revision, source identifiers
   and complete record count with the captured donor revision.
2. Open an actual result and its original source, physical row references, censoring
   bounds, units, review rationale and selected-version history.
3. Reopen a retained population edition and its complete downloads. Make any
   authorized review change in the independent recipient through the original
   control, then reopen it to confirm continuation; preserve the donor.
4. Inspect the actual outgoing project and attachments at desktop and narrow width.
   Open and use downloaded originals and the extracted archive. A source review or
   HTTP response is not visual acceptance.

This closes the outer scientific Workspace boundary. The Measurements-only
large-file `project.zip` continues to use its original Node SQLite backup and
semantic receive validation. Its original native 800-record and 350,000-row
receiving results belong to that author; they are not a runtime result for this
outer-export change. The existing native receiving owner should exercise this
boundary within the same accepted course. No denied browser or socket route needs
to be retried.

## Source and receiving dependencies

Use the current cumulative application. Preserve the original Measurements 4081
large-file feature, DD6B's source-chunk hydration in `portableDocument()`, and the
current Chemistry native binding and browser companion. This small portable fix
does not install or downgrade those separately owned sources.

The exact path was checked against
`measurement_workspace/extension.py::_directory` and
`measurement_workspace/engine/workspace.mjs::MeasurementWorkspace`.
The existing `snapshot_databases` implementation already uses a read-only source
connection, an explicit read transaction and `sqlite3.Connection.backup`, followed
by a self-contained target and original source-inode verification. Only the exact
Measurements member is newly admitted to that maintained mechanism.

## Current owner direction carried unchanged

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Direct owner instructions

> do the simulated model

> just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it

> just checking dont pause anythi g

> and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.
