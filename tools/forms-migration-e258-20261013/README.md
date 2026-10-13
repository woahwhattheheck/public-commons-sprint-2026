# Cohort discovery and metric reconciliation

This standard-library Python workbench receives complete authorized CSV exports, records their exact original bytes, profiles every row through SQLite, and calculates explicitly defined reporting cohorts. It is a delivery tool for source discovery and reporting design: the operator can inspect the source register, field mapping, quality issues, outcome counts and an edition comparison from the same saved case.

## Start

Python 3.11 or newer is required. There are no third-party packages, network calls, database servers or cloud subscriptions.

    python discovery_cli.py run --manifest fixtures/demo-a/manifest.json --output /private/discovery/demo-a
    python discovery_cli.py run --manifest fixtures/demo-b/manifest.json --output /private/discovery/demo-b
    python discovery_cli.py compare --left /private/discovery/demo-a/report.json --right /private/discovery/demo-b/report.json --output /private/discovery/comparison.json
    python discovery_cli.py pack --run /private/discovery/demo-b --output /private/discovery/demo-b-handover.zip
    python discovery_cli.py receive --archive /private/discovery/demo-b-handover.zip --output /private/discovery/received
    python /private/discovery/received/workbench/discovery_cli.py run --manifest /private/discovery/received/manifest.receiving.json --output /private/discovery/reproduced

Choose a new output path for each run. An existing edition or archive is never silently overwritten. The original CSV files are copied into the new case while hashing them; source changes during receiving or a mismatch with a declared hash stop that edition.

The two supplied fixtures are invented demonstration records. Their six-and-seven-character identifiers, programmes and amounts have no customer provenance. The college's public 2,316/1,698/198/420 table is retained separately as a published aggregate reference. It is not expanded into invented student records.

## Complete output

| File | Operational use |
| --- | --- |
| manifest.original.json | Exact authored input manifest bytes |
| manifest.json | Readable canonical edition and source definitions |
| manifest.receiving.json | Editable definitions pointing at the retained exact CSV snapshots |
| inputs/*.csv | Complete original CSV files, without row sampling |
| cohort.sqlite | Full local typed/raw working store for this edition |
| report.json | Every profile, key/reference check, cohort definition, denominator, outcome and source identity |
| report.md | Readable edition and outcome report |
| metric-outcomes.csv | Counts, their denominators and explicitly rounded percentages |
| quality-issues.csv | Full duplicate/reference totals and the first 50 typed-row locations |
| source-register.csv | Source ownership, extraction, refresh, access, retention and dependency register |
| mapping-register.csv | Proposed/accepted field mapping decisions and original references |

The handover ZIP contains the complete editable case and operator source. SQLite is rebuilt from the exact original snapshots, avoiding a second large copy of derived data. The archive manifest names and hashes every member; receiving verifies the complete member set and every byte before publishing the received directory.

A run has a source identity derived from its original manifest, actual input hashes and engine identity. Reproduction from the received manifest produces a new run identity because the received manifest has its own explicit paths and hashes. Original input hashes, the semantic metric definition hashes, profiles and outcomes remain comparable. The handover manifest retains the originating identity.

## Calculation behavior

* CSV records are streamed into SQLite with an 8 MB page cache and file-backed temporary operations. Full-file counts, distinct values, primary-key groups and foreign-key checks are computed from that store.
* Column types are text, integer, decimal, ISO calendar date and boolean. Integer and decimal values retain exact base-ten meaning; no binary floating-point conversion is used for financial values or percentages.
* Null tokens, trimming, required fields, enumerated values, headers and column order are explicit. A malformed UTF-8/CSV source stops receiving. Width/type problems remain in full totals and row locations.
* Metrics declare the source table, cohort filter, unit (rows or distinct named keys), invalid-row treatment, outcome filters and rounding.
* The default invalid-row policy is reject: a table with invalid typed rows leaves the metric denominator uncomputed. Explicit exclude records the entire excluded-invalid-row count in the result.
* Distinct units with missing keys are uncomputed. Repeated rows for the same unit do not inflate its denominator. If different records put that unit in different outcomes, overlap is visible.
* A required partition with overlapping or unclassified units returns PARTITION_REVIEW. The engine does not force the outcome sum to agree.
* Zero denominators produce no percentage. Rounded outcomes can total 99.9 or 100.1 even when exact counts conserve.
* Complete primary-key comparison reports inserted, removed, changed and unchanged logical records. Duplicate/invalid keys are excluded on both sides and remain explicit ambiguity; null/unusable keys remain separately counted. Cold handovers rebuild the complete key store from their exact original snapshots.
* Comparison preserves both denominators. Changed metric definitions or column type/null policies are classified DEFINITION_CHANGED and receive no automatic rate delta.

A COMPLETE metric describes a completed calculation. Overall quality_status includes typed rows, keys, references, partition results and unresolved mapping decisions. Review the exact issues and source meaning before treating an edition as an agreed reporting definition.

## Operating boundaries

The engine reads local files under the selected input root. It makes no service connections, changes no source system and submits no report externally. Original record content remains in the private case and its handover ZIP. Summary issue locations contain row numbers and field names; typed numeric/date extrema are included in the private profile.

This package implements local discovery and reconciliation. Source-system extractors, scheduled pipelines, tenant access, production metric approval and target-platform deployment belong to the commissioned delivery scope. A source register records those responsibilities and dependencies without presenting an old implementation plan as current deployed infrastructure.

Read OPERATOR_GUIDE.md for the complete manifest contract, correction workflow and handover procedure. Run receiving.py once to operate the full two-edition demonstration, exact round-trip archive, changed-definition handling and explicit invalid-data policies.
