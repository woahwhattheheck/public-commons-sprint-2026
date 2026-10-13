# Customer and job migration — operator guide
Version: October 13, 2026

## What this workspace delivers
Use this local workspace to commission an agreed transfer of customer, site and job records. It retains the exact originals, explicit field and identity mapping, every reviewed row decision, immutable receiving editions and observed target outcomes. The full working JSON reopens all of this together.

MEPflow's public homepage offers assistance moving existing customer and job data and a full export on exit: https://www.mepflow.app/. It already provides scheduling, estimates, invoices, costing and texting. This commissioning worksheet prepares source data and reconciles results around that existing product. It does not supply a published MEPflow import schema, call a native API, schedule work, send messages or post financial transactions. The receiving team must provide its actual fields and acceptance evidence.

All six company examples are public source contexts. Their actual customer records, software export headers and operational decisions are not public. The worked programme uses clearly labelled fictional customer/site/job values and simulated receiving IDs. Never describe its demonstration receipt as a real import.

## 1. Create a company programme
Choose one company in Programmes, enter a meaningful title, and name the actual receiving system and version or agreed schema. The company binding remains fixed after save. Once a handover exists, its receiving system is also fixed; create a separate programme to commission another target. Start another programme for a different company; do not merge operators because their trade or town matches.

The Recorded by field identifies the operator in subsequent changes. Use a real operator label when doing actual commissioning. Each accepted action increments the working revision and keeps history. A rejected action leaves the saved workspace unchanged and keeps the form available for correction.

## 2. Retain the original exports
Obtain authorized source exports from the operator. Keep customer, site and job files as separate entity sources. Select CSV or JSON in Original exports; enter source system, capture time with timezone, entity and source kind. A source data file is an input to mapping. A target-result file is evidence returned by the receiving system.

A selected file is pending until Save original succeeds. Files are limited to 8 MiB and 10,000 data rows per original. For JSON, supply the array path as a JSON array of object keys, for example ["export","jobs"]; use [] only for a top-level array. Records must be flat. The original JSON numeric tokens are retained as exact strings, including long identifiers, decimals and exponent notation. Mapping exponent notation to a decimal field requires an explicit translation into the agreed decimal string; no automatic arithmetic or rounding is performed. The original source text remains unchanged.

The complete original text, including BOM and line endings, remains downloadable under its original filename. CSV headers are trimmed for mapping and must be unique after trimming; original headers and fields are retained. Do not rewrite the input just to make an unclear row disappear.

When an export is corrected, add the changed original with its earlier source edition selected. Repeated identical source bytes within the same company/entity/kind point to the original instead of creating a duplicate.

## 3. Build an immutable mapping
Select the original source in Mappings. Name the profile and choose an explicit required text key field. That key is the source record's identity, not a name-based guess.

For each mapped field, enter:
- A stable mapped key and readable label.
- The exact source header or a deliberately chosen constant.
- Type: text, decimal, integer, boolean, date or datetime.
- Required, trim and empty-value choices.
- An optional exact value translation list, such as [{"from":"Booked","to":"scheduled"}].
- An optional customer, site or job relationship.
- The actual receiving column name, if this field should be in target files.
- Whether a relationship exports its source key or an accepted native identifier.

Decimal and integer transformations retain exact strings. Dates are explicit YYYY-MM-DD values; datetimes need a timezone. A translation map accepts only the listed original values. Do not map "quote sent" to "approved" unless the operator confirms that meaning.

Target column names are entered from the receiving team's actual instructions. No automatic vendor mapping is implied. A field with no target column remains in the staged source record but is excluded from target columns. Native ID mode is meaningful only for a relationship and requires an accepted related record before handover.

Every profile is immutable and bound to one source edition. Copy for revision creates another profile; it does not rewrite an earlier committed batch.

## 4. Decide every row
Choose a mapping in Row decisions, name the batch and review it. Expand the original, mapped values, changed fields and relationship details for each row.

The recommendation is a suggestion only. Choose one explicit decision for every row:
- Create a new staged record.
- Update a selected existing record, retaining previous fields and source history.
- Link to an existing record without changing it. Explain any differing mapped values.
- Exclude with a reason. The original row remains in the batch report.

Choose an existing record by its exact key and ID for updates or links. Review duplicate source keys and aliases carefully. A similar customer name is not sufficient evidence to merge records, and two properties belonging to one customer remain separate sites.

Review the completed decisions again. Commit is enabled only for a current issue-free review. Changing a decision invalidates that review. An unresolved required relationship prevents a create or update. Commit retains the exact reviewed mapping, original rows, decisions and record revisions. An exact repeated commit returns the saved edition rather than creating another.

## 5. Prepare the receiving handover
Select a committed batch in Handovers. Enter its title and receiving instructions, then inspect actual columns, rows and issues. Create and update rows enter the target files; linked and excluded rows remain in the complete report.

If a job or site needs native foreign keys, first deliver and reconcile its related customers or sites. An unaccepted customer cannot supply an invented target ID.

Freeze the reviewed handover, then download the exact target CSV, target JSON and readable review. Frozen editions retain their original source, profile, batch, records and hashes. Later corrections produce later editions; they do not overwrite what was previously prepared.

The target CSV contains actual configured data values. Open it as data in the receiving tool, with its intended types. Spreadsheet software may interpret formula-like values or identifiers; preserve the original data meaning and do not use a spreadsheet-resaved file as proof of byte identity.

## 6. Record the actual target outcome
The receiving team performs the actual import using its authorized process. Obtain its original result CSV/JSON. Retain it under Original exports as target-result for the matching company/entity.

Select the saved handover in Target outcomes. Enter the evidence file, actual observation time, response or ticket reference, and any correction notes. For each changed outcome:
- Accepted requires the actual native record ID.
- Rejected requires its reason.
- Unknown requires an explanation of what is not known.
- Keeping a row unselected retains its latest observed outcome or leaves it unknown.

Review and save the complete receiving snapshot. Changing a previous accepted result or identifier requires explicit notes; the old edition remains visible. Distinct source records cannot silently claim the same native identity in one target system/entity.

A generated CSV or a successful download is not acceptance. No target result should be marked accepted merely because a file was sent to another person.

## 7. Reconcile and correct
Reconciliation separates original rows, staged records, prepared deliveries and accepted/rejected/unknown outcomes. Inspect a record's full revisions, aliases, origins and receiving results. Download the complete programme report and reconciliation CSV.

For a correction, retain the changed original, create its new mapping, review explicit update/link/exclude decisions and freeze another handover. Original accepted editions remain intact. A changed staged record needs its own current receiving result; old target evidence does not silently approve changed data.

Use the reconciliation totals to account for exclusions and unresolved rows. Do not declare completion from matching row counts alone: key relationships, target identifiers and rejected/unknown outcomes matter.

## 8. Save and reopen
Download working JSON from Workspace before closing. It contains all originals, mappings, staged records, batches, handovers, result evidence and history.

Selecting a new working file immediately invalidates an earlier pending receipt. The file is limited to 64 MiB and is validated before replacement is offered. The current workspace stays in place until you explicitly receive the incoming one. Replacement first downloads the current state. A separate validated download leaves the current workspace unchanged.

Unsaved form edits require an explicit discard decision before navigation or an action that would redraw another form. File reads and example loading are guarded against a later selection or intervening edit. Failed operations keep current saved data and useful form input.

## Worked six-company programme
Load the complete worked example from Workspace. It is built separately, with progress, before replacing the current state; your prior state is exported first. Review all six programmes and their original files, mapping profiles, explicit decisions, prepared handovers and target-result records. Demonstration contacts and IDs are selected inputs, not published customer data.

The source-aware commissioning questions are:
- Action: preserve customer/site identity while separating repair, installation and maintenance work and office/field source references.
- United: a service request can have no address; resolve the site explicitly before a job needs it. Keep diagnosis/quote/approved work distinct.
- Dixie: retain owner-review and job references; its website's legal suffix varies, so use the trade identity until the operator resolves legal naming.
- Medina: retain estimate, options and approved installation stages without inferring finance or accounting activity.
- Dale: preserve service and construction job identities. Manufacturer-specific generator maintenance is not a universal recurring date.
- Whatley: its current official page links Jobber client login and request intake. Preserve original IDs and semantics from its supplied export; no automatic Jobber integration is claimed.

## Source register
See source-refresh.json for the checked public facts, exact URLs and receiving boundaries. It distinguishes current first-party indexed retrieval from direct page extraction for Medina. Public source establishes business workflow context; the operator supplies actual customer records, exports, receiving schema and final acceptance.

## Product inspection and receiving
Open the exact outgoing standalone application at normal screenshare and narrow widths. Operate populated and empty programmes, file selection/invalid input, mapping/row review, handover downloads, result correction, complete JSON export and reopening. Open every delivered attachment and archive member as its recipient would. The producing peer must look at the actual rendered screens or returned screenshots, not only capture them. Source-level operation and byte checks are useful but do not substitute for this visual receiving step.
