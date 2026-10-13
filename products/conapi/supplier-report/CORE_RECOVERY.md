# CONAPI supplier core recovery

Operation: original 70CB supplier-report complement in CONAPI sales thread 1791835049.973109. Target: products/conapi/supplier-report/supplier-report.mjs in the existing native supplier workflow.

This complete source implements the retained CLI and UI contracts after the original author's session failed before publishing its core. It is a recovery implementation, with its own replayable workspace representation under the retained conapi-supplier-report/version 1 envelope. Its source is distinct from the unavailable original root bytes. The current CLI, review shell, browser UI, supplier attachment adapter, and catalogue coverage module remain the existing component consumers.

## Working behavior

The module has no runtime dependency or import. It exports ReportError, canonicalJSON, sha256, parseCSV, createEdition, reconcile, decide, decideMany, finalize, serializeWorkspace, reopenWorkspace, exportCSV, exportHTML, and exportSQL. SHA-256 uses the original Commons connected_sha256.cjs implementation with its upstream license retained in the module.

CSV parsing retains complete original CSV, all original columns, ordinal row numbers and physical starting lines; quoted multiline cells and escaped quotes follow strict CSV parsing. Structured editions retain complete explicit columns and rows. Every edition binds exact original source content, identity, timestamps, and source metadata to deterministic digests.

Rules use keyFields and fields. Every field explicitly maps each source side through an exact column name, a {constant:string|null} object, or null. Canonical values are strings or null. Text trimming, case conversion, null tokens and alias dictionaries are explicit. aliases is an object from exact source strings after configured trim/case conversion to canonical strings or null. allowedValues contains canonical strings/null. Numeric limits and tolerances are decimal strings. Decimal arithmetic uses BigInt coefficients and scales, never binary floating price calculations. Decimal source strings permit an optional sign and decimal point, and reject grouping separators, currency symbols and exponent notation. Source noninteger numeric JSON values require an exact-token structured reader before import. Dates use valid YYYY-MM-DD dates; booleans use true/false or explicit aliases.

Items cover additions, removals, changes, unchanged values and exceptions. Duplicate or invalid keys retain all original source rows; Choose source selects an exact side and row number. Numeric deltas are suppressed whenever configured comparison-basis fields are missing or disagree. Field type and value constraints stay visible at the original row and item.

Every review decision requires item ID, action, reason, reviewer and expected revision. Supported actions are use_candidate, keep_baseline, exclude, replace, choose_source. A replacement provides every canonical field. Batches validate all requested decisions first, then apply one history event and revision per item, with a final summary refresh. Corrections that create duplicate output keys remain explicit output conflicts.

The report is deeply immutable and decisions return a new report. Unchanged items accept their candidate row automatically. Complete reviewed output includes configured canonical columns, accepted rows, source lineage and a digest. serializeWorkspace preserves a checksum and the complete source/report payload. reopenWorkspace verifies both source edition content and ordered decision replay, then compares all derived state.

## Export semantics

Accepted CSV contains exactly the configured canonical columns; nulls become empty CSV cells and remain distinct in the workspace and SQLite export. CSV preserves source values, so spreadsheet import should explicitly retain text columns when opening untrusted supplier data. The changes CSV includes every reviewed change/exception and complete original row JSON. The self-contained HTML report contains summary, rules, accepted rows when review is complete, every review item, both full source editions and all decision history, in a clean grayscale layout.

The SQL export creates a new SQLite TEXT snapshot table plus __lineage and __metadata tables inside a transaction. It uses quoted identifiers and string values, preserving arbitrary-precision values as text. Existing names cause an error. Run it in an executor that stops and rolls back on error; choose unused table names for the new snapshot. It does not infer updates to an existing customer's production table.

## Receiving

Keep the existing CLI export command and manifest contract. This core supplies all metadata consumed by the CLI's full workspace/source/report/rules/changes exports, accepted CSV/SQL, and lineage JSON. The existing native Python helper validates actual delivery files and attaches them as sibling artifacts. The catalogue coverage module imports parseCSV, sha256 and canonicalJSON directly from this file.

The actual Elite Digital Agency published-pricing and services-catalogue files are complementary current source datasets. Use catalogue coverage for their origin/path join, retaining all original rows and the documented source URLs/license. A supplier temporal price comparison requires real editions from the same declared source or an explicit source-to-target mapping; the two public datasets alone are not dated historical price editions.

## Current complete source and real-data exercise

The reviewed successor keeps the original output contract and adds a single indexed history replay with one final summary computation, direct paired-surrogate validation instead of hashing each JSON string, and a concrete SQLite ASCII-case column collision check. Source edition integrity, complete per-event previous-decision comparison and final reconstructed-report comparison remain enforced.

The complete original Elite source was imported into an explicitly empty destination, producing 23 additions. All 23 original-source decisions were recorded; the resulting workspace reopened to the same accepted result digest. Its actual accepted destination was then compared with the unchanged original publisher CSV, yielding 23 unchanged records and identical canonical rows. The separate original catalogue produced 12 matched price rows across seven services, four services with multiple price tiers, 11 unmatched price rows and 22 unpriced catalogue rows, with zero parsing or matching exceptions. Full source, workspace, canonical outputs, lineage, manifests and readable reports are in the examples directory. See examples/ELITE_SUPPLIER_WORKFLOW.md for the complete operating sequence and source interpretation.

Execution used the actual module body in strict session V8, preserving ESM strict behavior while removing only export declarations for invocation. The current installed native Node/browser receiving path consumes the unchanged ESM exports. The retained CLI and browser components import this same ESM interface.
