# Observation editions

## Complete scientific workflow in the existing Measurements application

Open **Measured data → Observation editions** in the current operator. This component lets a scientist retain an explicit interpretation of overlapping original observations as a named, reversible edition. It uses the existing Measurements sources, records, review history, exports, HTTP service and portable workspace. It does not create a second observation database.

**Source versions** remains the place to choose between revisions sharing the original logical key. **Observation editions** records relationships between explicitly chosen original records, including records whose publisher identifiers differ. **Source returns** retains its existing source-shaped receiving workflow. The native-observation bridge, daily-flow studies, benchmarks, characteristic interpretation, workbook intake and temporal tools keep their original source and scientific contracts.

A saved observation edition includes its complete original-source closure, every selected normalized record and raw row, all original source occurrences, current review and native-eligibility snapshots, explicit relationship and exclusion choices, and its immutable parent when revised. Original records and existing source-version selections are unchanged.

## Inspect the actual originals

1. Choose the complete retained source editions under **Original sources and scope**. Source titles, hashes and accepted original-row counts come from the existing source catalogue.
2. Apply exact optional station, characteristic, normalized constituent, fraction, unit, censoring code, method, organization, activity and source-date filters. Blank fields impose no restriction. Dates use the original source calendar dates; the filter does not invent a timezone.
3. Select **Inspect selected originals**. The service binds the complete filtered record set and original files to the inspected Measurements revision. The table is paged for readability; the saved edition includes the complete selection.
4. Use **Find within this selection** to locate original identifiers. This local search changes only the displayed table, not the saved scientific scope.
5. Select records with the comparison checkboxes and choose **Compare selected records**. The checkboxes select a comparison, not the rows retained by the edition.

**Inspect original** opens the existing Measurements record inspector. It retains all original fields, source references and review history. Returning to Observation editions restores the unfinished state through the original workspace/person-bound operator memory.

A selection with no matching observation records, or with one original source, is allowed as a source-bound observation edition. It does not establish any cross-publisher equivalence. Missing sampling dates cannot satisfy an explicit source-date filter.

## Define the relationship explicitly

The relationship form offers five meanings:

| Choice | Result in this observation edition |
| --- | --- |
| Same observation published more than once | Keep one explicitly selected original representative. Retain every other representation and its original occurrences in the edition as suppressed duplicate representations. |
| Independent replicate measurements | Keep every original member separately. No averaging, precision weighting or substitution occurs. |
| Related context only | Keep all members separately; the relationship explains context without treating them as one measurement. |
| Distinct observations | Keep all members separately and retain the reason for distinguishing them. |
| Relationship remains unresolved | Retain all originals as unresolved. None of those members enters this edition's calibration-input selection. |

Every relationship requires a scientific rationale and an evidence reference in the retained sources. A relationship is a direct, explicit group of two to 64 original records. A record cannot belong to overlapping groups; the application does not infer transitive sameness across separate pairwise decisions. Independent groups can cover the rest of the complete edition.

The comparison displays original organization, station, activity and result identifiers; source dates, instants, timezone and time precision; characteristic, parameter, fraction, medium and sampling type; method, method context/name, laboratory, speciation and available depth/basis metadata; reported value/unit, normalized value/unit, censoring, detection limits, qualifiers and status; and original station metadata. The complete original field objects and physical source occurrences remain expandable.

A same-observation choice requires a representative and explicit acknowledgment of all displayed differences and missing critical support. Acknowledgment documents the scientist's review; it does not numerically convert or resolve a scientific difference. Empty metadata is shown as unknown support rather than evidence of agreement. Identical dates or values are not automatic duplicate criteria.

Use **Apply relationship to draft** to retain the choice in the unfinished edition. Reopening the same comparison preserves unfinished rationale. Replacing it with a different comparison asks before discarding those edits. **Discard unfinished relationship** closes that specific unfinished form.

An explicit record exclusion also requires a reason. **Restore to edition** reverses the draft exclusion. An excluded record cannot represent a same-observation group: select a different original representative or keep the relationship unresolved.

## Save, revise and recover

Enter the edition title, scientist/reviewer and purpose. **Preview complete selection** downloads a readable full preview without saving an edition. Apply or discard an unfinished relationship before previewing or saving; a partly typed comparison is not silently omitted.

**Save observation edition** saves one immutable edition through the existing exports table and appends an original workspace event. Its deterministic operation identity binds the complete accepted request. A changed Measurements revision or source binding requires reinspection before acceptance.

The **Saved observation editions** list reopens the complete historical edition. It does not replay old decisions over current Measurements reviews. **Revise with current originals** prepares a new draft against current source/review state and retains the exact parent ID and digest. Saving the successor never rewrites that parent.

If a save response is lost, **Retry exact pending save** retains the original operation ID and full request. Repeating that exact request recovers its saved edition; a different request under the same operation ID is rejected. Ordinary form edits do not erase the pending request. If later draft edits exist when the old save is recovered, the recovered original appears in the saved catalogue and the later unfinished draft stays in place.

While a request is pending, a new save, source reinspection or replacement draft cannot silently replace it. **Keep request for recovery and continue editing** explicitly retains that exact request and allows a separate draft/save operation. This also lets a scientist correct a rejected request without being trapped by an uncertain acceptance status. **Recover retained save** retries the selected original payload; it cannot replace a different active pending request. Pending and retained requests travel in the downloaded draft and survive reopening. Recovering an earlier accepted edition preserves later draft choices. Original saved editions remain separate history.

Reinspecting the same exact source scope updates the source/review binding while preserving the reviewed draft choices. Inspecting a different scope explicitly confirms replacement of relationship/exclusion choices.

Refresh reloads the saved catalogue without clearing unfinished choices. Tab navigation retains the draft and pending operation in the original operator's workspace/person memory. Closing the page with unfinished edits requests confirmation. Browser memory is not a durable project backup.

## Editable reopening and complete files

| Control | Complete output and intended use |
| --- | --- |
| Download complete edition JSON | The immutable edition, all original source text, original rows/occurrences, field comparisons, reviewer choices, parent and digest. |
| Download all original-row decisions CSV | One row per original source occurrence, including retained, suppressed, excluded and unresolved records; original decimal strings, source row numbers and raw-field JSON are included. |
| Download readable review | Self-contained HTML with complete selected observation table, relationship explanations, original-field comparisons, embedded full edition JSON, original source downloads and print controls. |
| Download calibration input selection | The maintained upper-savannah-calibration-input/v1 format, with accepted original rows, all exclusions and explicit observation-edition binding. |
| Download editable workspace | The original complete Measurements portable workspace: all sources, records, reviews, source-version selections, saved editions, events and peer exports. |
| Download unfinished draft | Unfinished authored choices, optional open comparison, selected comparison IDs, and every exact pending/retained save request. Original source bytes travel in the complete workspace, not this compact draft. |
| Open unfinished draft | Restores a complete UTF-8 draft up to 8 MiB against its existing original sources. Missing records reject adoption without replacing the current draft. |
| Open Exports & handover | Returns to the existing Measurements project/export workflow. |

The HTML review is a readable historical document, not a second editable database. Open its embedded JSON or original files through its own controls. Printing opens relationship details for the print operation and restores their previous state afterward.

To resume on another machine, receive the complete portable workspace into a new empty Measurements directory using the existing receive command, then open its saved observation edition. Importing only raw CSVs would omit saved history and editions. For unfinished work, receive the complete workspace and open the separately saved draft afterward. A single edition JSON is an evidence document and does not replace the complete original workspace receive operation.

On reopening, the service verifies original source text and descriptors, exact canonical row bodies, full source occurrences, the complete selected-source/filter membership, historical revision membership, calculated comparisons/dispositions/counts and parent/digest bindings. It preserves historical review fields rather than comparing them to newer live decisions.

## Scientific boundaries

The application preserves original identifiers and does not automatically equate different publisher namespaces. EPA's WQX glossary describes Activity identifiers within an organization and distinguishes analytical-method context from the method identifier. It also distinguishes replicate relationships from a single result. These distinctions inform the displayed evidence; the scientist supplies the actual cross-source conclusion.

A representative choice never changes a concentration, unit, fraction, censoring bound, timestamp, coordinate or original record. The component does not average replicates, impute nondetects, invent station matches, infer unreported timezone/depth, or turn SSC/TSS into the same quantity.

The calibration download applies both the edition disposition and the original saved Measurements eligibility result. Suppressed duplicates, explicit exclusions and unresolved groups are excluded. Existing quality-control sample, censoring, missing value, source-revision conflict, reach, unit and review restrictions remain in the exclusion list. Choosing a representative does not waive them.

This is a saved eligibility snapshot, not a new native admission authority. The current native importer, temporal matching, spatial support and selected model still require their own original scientific configuration. The current native-observation source bridge continues to capture one complete original import with its actual source and row bindings; an observation edition does not silently replace that import.

Primary terminology and source documentation:

- EPA WQX glossary: https://cdx.epa.gov/WQXWeb/StaticPages/GlossaryWqx.htm
- Water Quality Portal user guide: https://www.waterqualitydata.us/portal_userguide/

Use the exact retained publisher edition and its actual dictionary. The portal guide includes historical WQX 2.2 documentation; it is not authority to replace the existing current WQX 3.0 source-preparation contracts.

## Maintained HTTP and CLI interfaces

The component mounts below the original Measurements base:

- GET /observation-editions — current source catalogue and saved editions.
- POST /observation-editions/inspect — body {scope, expected_revision?}.
- POST /observation-editions/preview — complete reviewed selection and binding, no saved write.
- POST /observation-editions/editions — complete reviewed selection plus operation_id.
- GET /observation-editions/editions — saved edition list.
- GET /observation-editions/editions/ID — complete saved edition JSON.
- GET /observation-editions/editions/ID/observations.csv — complete original-occurrence CSV.
- GET /observation-editions/editions/ID/report.html — self-contained readable review.
- GET /observation-editions/editions/ID/calibration.json — maintained calibration-input selection.

The existing CLI uses --name value pairs. From the complete current application directory:

~~~sh
node measurement_workspace/engine/cli.mjs observation-edition-catalogue \
  --workspace /ABS/OWNED_RECEIVING_MEASUREMENTS --output /ABS/OWNED/catalogue.json

node measurement_workspace/engine/cli.mjs observation-edition-inspect \
  --workspace /ABS/OWNED_RECEIVING_MEASUREMENTS --file /ABS/OWNED/scope.json \
  --output /ABS/OWNED/inspected-originals.json

node measurement_workspace/engine/cli.mjs observation-edition-preview \
  --workspace /ABS/OWNED_RECEIVING_MEASUREMENTS --file /ABS/OWNED/reviewed-selection.json \
  --output /ABS/OWNED/preview.json

node measurement_workspace/engine/cli.mjs observation-edition-save \
  --workspace /ABS/OWNED_RECEIVING_MEASUREMENTS --file /ABS/OWNED/reviewed-selection.json \
  --output /ABS/OWNED/saved-edition.json

node measurement_workspace/engine/cli.mjs observation-edition-read \
  --workspace /ABS/OWNED_RECEIVING_MEASUREMENTS --id ACTUAL_SAVED_EDITION_ID \
  --output /ABS/OWNED/edition.json

node measurement_workspace/engine/cli.mjs observation-edition-report \
  --workspace /ABS/OWNED_RECEIVING_MEASUREMENTS --id ACTUAL_SAVED_EDITION_ID \
  --output /ABS/OWNED/edition.html

node measurement_workspace/engine/cli.mjs observation-edition-csv \
  --workspace /ABS/OWNED_RECEIVING_MEASUREMENTS --id ACTUAL_SAVED_EDITION_ID \
  --output /ABS/OWNED/observations.csv

node measurement_workspace/engine/cli.mjs observation-edition-calibration \
  --workspace /ABS/OWNED_RECEIVING_MEASUREMENTS --id ACTUAL_SAVED_EDITION_ID \
  --output /ABS/OWNED/calibration.json

node measurement_workspace/engine/cli.mjs portable \
  --workspace /ABS/OWNED_RECEIVING_MEASUREMENTS \
  --output /ABS/OWNED/complete-workspace.json

node measurement_workspace/engine/cli.mjs receive \
  --workspace /ABS/NEW_EMPTY_MEASUREMENTS \
  --file /ABS/OWNED/complete-workspace.json
~~~

scope.json contains an explicit scope object:
~~~json
{"scope":{"source_ids":["ACTUAL_COMPLETE_IMPORT_ID"],"filters":{}}}
~~~

Select actual complete source IDs from the catalogue; never substitute a publisher label for an import identity. The inspect response supplies the exact source_binding and workspace_revision. A reviewed selection contains scope, title, reviewer, purpose, expected_revision, source_binding, groups and exclusions; saving also needs an original operation_id. A revised edition supplies parent_id and parent_digest from the original saved edition. The browser prepares these fields through forms and is the normal scientist-facing editor.

## Complete original receiving course

Continue the existing equipped Measurements receiving operation and current cumulative installation. Do not replace its live application, original database, admitted process or scientific source writer. Use an owned complete receiving copy.

The original completed 533-record/five-source project remains the original 6453 archive and 1361/3320/6496 receiving operation. Its source, review history and saved result must arrive intact. No raw-source reconstruction substitutes for its missing portable state. The equipped /workspace/rfp_readiness/wo46-source source receiver is continuing the original guided-intake operation while that archive is recovered.

On an actual populated receiving workspace:

1. Open Observation editions at desktop width and 390 px. Select actual retained sources and exercise the combined exact filters and table search/paging.
2. Inspect original raw rows, methods/context, fraction, time and source occurrences. Save an edition with no asserted relationships if the actual evidence does not establish an overlap.
3. Where the original evidence supports it, record the scientist's real relationship choice and rationale. Keep independent replicates or unresolved relationships explicit. Do not invent a duplicate claim to produce a demonstration.
4. Open the saved edition, revise it, retain both historical editions, and return through the original Measurements inspector and Exports & handover.
5. Download and open the complete edition JSON, occurrence CSV, readable HTML, calibration input, every original source file and full editable workspace. Check the original zeroes/decimal strings, source counts, qualifiers, censoring and exclusions.
6. Receive the full portable workspace into a new directory, open the same saved edition, and compare exact IDs, original bodies, counts, relationships and history. Reopen an unfinished draft only against its retained originals.
7. Personally view the desktop/390 images and the actual opened outgoing documents and archives. Record the actual producing paths, execution and receiving result; fix any concrete defect in the same maintained source.

The bundled developer course uses two conspicuously authored WQP-style input bodies, the actual original parser/normalizer and eligibility method, and complete engine/editor callbacks under explicit SQL, DOM, FormData and download adapters. It covers four canonical records/five original occurrences, a duplicate representation, an independent field replicate and a censored result. It is source/controller execution, not native SQLite, publisher measurements, browser pixels or the missing 533-record project.

## Current owner instructions

Carry AGENTS.md 2026-10-13.1 and CURRENT_OWNER_DIRECTION.md 2026-10-13.4 with the complete application. Tim's actual files and scientific interpretation remain the purpose of the product. Use the original source/model/receiving owners, preserve completed and running jobs, and compose current shared source rather than replacing a newer peer feature. Producer inspection includes operating the actual outgoing application and personally viewing desktop/narrow output and every attachment. Customer readiness cannot be inferred from source or adapter execution.

No customer message, production source write, external sender action or use of Bryce's reserved local browser is implied by this workflow.
