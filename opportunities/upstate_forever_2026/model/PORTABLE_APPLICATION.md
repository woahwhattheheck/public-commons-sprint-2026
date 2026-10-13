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

## Saved database state

The project-local investigation database at `workspace/intelligence/investigations.sqlite3` is captured with SQLite's online backup API after opening a read transaction. This includes committed transactions still in a write-ahead log. Each archived database opens independently; its live WAL, shared-memory and rollback-journal companions are omitted.

The archive manifest's `database_snapshots` records identify these captures. The database is transactionally consistent at its capture point. The existing workspace lock also coordinates the product's ProjectStore writes. A persistently locked database reports its capture error without retaining archive locks indefinitely; a large snapshot that is making progress has no total-duration cutoff. A concurrent application installation or a replaced database causes capture to stop with its specific source path.

Content-addressed source objects, source editions, model runs, grids, delivery products, GeoPackages and unknown SQLite files retain their original bytes. Their checksums and scientific identities keep their existing meaning.

## Existing archives

The archive format remains `upstate.scientific-workspace-archive/v1`. Earlier archives without database snapshot records still open through the same restore command. Explicit archive inspection verifies each member against its retained length and SHA-256. Restore checks the complete manifest first, then verifies each member while extracting it, so large rasters do not need an extra decompression pass. Completed native result descriptors are bound to those verified member hashes and lengths. Saved scientific selections and their existing receiving validators are retained.

Receiving reads from one opened archive edition and records its SHA-256 before publishing the new directory. An archive that changes in place during receiving stops the operation and removes its owned staging directory. Capture also records the finished archive's identity before publication. Restore publishes into a new receiving directory and preserves existing destinations.
