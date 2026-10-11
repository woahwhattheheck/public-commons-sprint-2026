# Nine-case training journey

These supplied training records let an operator run the complete retained workflow. The fields are illustrative export headings mapped explicitly to the original comparator. Names use Demo reviewer labels; the files form a self-contained training population.

1. In setup, use cohort `training-permits-2026-10-11`, USD, currency scale 2 and the scope note/scenarios in `settings.json`. Adopt the two source recipes, keeping their configured departments and statuses.
2. Upload `source-permits.csv` and `candidate-permits.csv`. Use an explicit export capture timestamp, such as `2026-10-11T18:00:00Z` for both training snapshots. Use the canonical-to-original columns in `source-mapping.json` and `target-mapping.json`. Source payments use decimal values; target payments use integer minor units. Related identifiers use a pipe separator.
3. Upload `case-crosswalk.csv`, with the `source_id,target_id` headings. The target's `T-` identifiers map to the authoritative original case IDs.
4. Preview the normalized target and run the initial comparison. Nine cases produce six findings: status changes on B-101/E-101, changed attachment count on E-101, changed payment on L-101, and changed Fire reviewer/due date on F-102.
5. Inspect the Building/Fire scenario: B-101 is finalized while F-101 remains open. Inspect the open-review scenario: F-102 has lost its assigned reviewer. Record the exact case correction work. Accept the intentionally selected E-101 status transition with a training explanation; mark the other discrepancies for correction.
6. Upload `corrected-permits.csv`, confirm the target mapping and run again. Five findings disappear; E-101 remains with its prior review available. The Building/Fire check examines three linked parents and the open-review check examines four reviews, with zero violations in the corrected candidate.
7. Reconfirm the current E-101 decision. Record each required scenario observation and the selected cutover decision. Download the private handoff and full workspace backup, then reopen that backup into a new database path.

The first export and its original decisions remain available after the corrected run. Editing a ready run's finding/scenario decision reopens its cutover decision for explicit reconfirmation.
