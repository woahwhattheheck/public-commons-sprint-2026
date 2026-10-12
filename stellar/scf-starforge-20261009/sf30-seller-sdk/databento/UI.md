# Databento operator interface

Open the operator URL printed by the original Databento workbench. The interface is served at /databento-migration/ by the existing Python workspace server, with the same workspace token, source store, revision history and preview lifecycle.

## Working sequence

1. Select a retained edition. Overview shows its actual dataset, schema, symbols, time field, gateway and captured-at timestamp. Summary counts come from a completed full-source inspection.
2. In Sources, inspect or download each complete original capture. Source descriptors include compressed and uncompressed identities, corpus membership and complete partition bounds. Definitions and status can be reference sources outside the primary session window.
3. Add original CSV, DBN JSON Lines, JSON metadata or gzip files. Every file is hashed before attachment. Choose the actual format, encoding and source role. Import the acquisition client's complete edition descriptor when it supplies corpus and completeness details. Existing reviewed source inputs remain attached to their original edition; create a new edition for changed inputs.
4. Inspect records, instruments, sessions, findings, changes or sources. The core scans all selected data and returns a presentation page. Page size and offset never determine the assessment totals. Explicit byte-limited pages continue at the returned nextOffset.
5. Select source, instrument, finding or edition targets and append a named Accept, Revisit or Exclude decision. Last-event order applies to the exact edition and target. Inspect/build after saving to see the resulting exact customer and exclusion counts.
6. Configure customer column names and JSON-pointer paths. Open an original record to see exact mapped values and select any supported nested source field. Missing values, undefined sentinels, original nanoseconds and atomic prices retain their core representation.
7. Build operator or customer report files. The UI verifies the complete retained output and each generated file against the original byte count and SHA256 before offering downloads.
8. Use the full export command for complete mapped CSV/NDJSON. It binds the selected completed operator build and saved revision to the original workbench handoff. Operator audience adds source, private decisions, the portable workspace and retained operation. Customer audience contains only customer files.
9. Export the complete workspace and reopen it through the same create-only import command. History can reopen original saved results or restore a source revision as a new revision.

## Complete data export

The Delivery form emits the exact original workbench command:

    node <source-root>/stellar/scf-starforge-20261009/sf30-seller-sdk/databento/workbench.mjs handoff --source-root <source-root> --dir <workbench-directory> --preview <completed-build-preview-id> --out <new-directory> --audience operator

The workbench directory contains the original workspace/ store. It is not the nested store itself. The output directory must be new. Optional --python selects the executable used by the same complete standard-library processor. The interface downloads the selected command; it does not imply a terminal command ran merely because it was prepared.

The small native report does not include the full mapped dataset. The handoff calls the same processor on the selected immutable saved source, streams all included primary records, and publishes a complete output manifest only on success. Its output identities and counts remain the source of truth for the completed delivery.

## Original sources and exact comparisons

The four prepared native editions are complete, distinct MBP-1 and MBO premarket/after-hours sessions from the actual published XNAS NVDA corpora. They retain original capture and full-corpus metadata. Public-sample reference editions do not become historical-production baselines automatically.

The Migration comparison screen selects an explicit baseline and displays matching scope fields. Eligibility and actual changes come from the original core: matching requested dataset/schema/symbols/symbology/window/time field, historical versus preview gateway, and explicit edition roles. Instrument-ID migration, the winter after-hours hour, UTC-midnight snapshots and batch receiving are assessed separately for the actual dates and sources.

## Drafts, concurrency and recovery

The original local-draft-store retains configuration edits, imported exact-byte files, review targets and working UI fields across navigation/reload. Saves name the expected original head; concurrent source changes are merged in History. Independent edition changes can merge. Competing decisions for the same target require an explicit selection with both original configurations retained.

Mutation requests are retained before dispatch. After a lost response, recovery first looks for the original operation ID or saved revision and file hashes. It reopens completed work without another preview or save. Historical inspection is read-only; restore appends a new revision.

The browser uses the original /api/state, /api/file, /api/revision, /api/revisions, /api/restore, /api/preview, /api/preview-output, /api/preview/cancel and /api/export routes. All preview functions and generated records follow CORE_CONTRACT.md. The engineering editor remains available through the original root URL.

## Account and capture workflow

The Sources account controls retain a profile label, credential environment-variable name, existing operation ID and exact reviewed scope. Credential values remain in the original private acquisition client. Run that client's account/quote/batch/download workflow, then import its actual complete source descriptors. Account fields in this interface are preparation inputs; they do not claim a provider request, payment or acquisition took place.

Native source limits remain 8 MiB per file and 32 MiB per revision. Binary gzip is preserved as base64 in the original workspace file format. Complete named partitions and compressed originals fit those limits; standalone full-corpus processing uses the same core and full original files.

## Interface source

The three web files have no external font, charting or JavaScript dependency. They use text DOM construction, the existing native token header, exact saved output checks and the original draft store. Layout uses grayscale, responsive tables, labeled form controls, visible focus and status announcements.
