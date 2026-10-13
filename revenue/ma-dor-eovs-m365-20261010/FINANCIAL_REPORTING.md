# Financial reporting and control workbench

This is an additive operating module in the existing MA migration workbench. It uses the same SQLite database, original file objects, operation identities, revisions, browser server, CLI and complete portable delivery. There is no second finance database, vendor connector, service desk or production approval system.

The workbench retains actual source exports, original native definitions and reviewer decisions. It calculates selected populations and compares actual native report output. Business Central, Jet, Power BI and Continia remain the customer-selected native tools. No uploaded workbook, macro, RapidStart package or vendor executable is run by this application.

## Open the complete application

Python 3.10 or newer and its standard library are sufficient. Use the whole maintained application:

~~~sh
python3 migration_server.py --workspace /private/original-workspace --port 8083
~~~

Open the returned local URL and follow **Financial reporting and reconciliation**, or open /financial. To create a genuinely new local engineering workspace, use the existing --create and --title options. A local workspace is not customer acceptance or a tenant deployment.

The existing CLI exposes every financial action:

~~~sh
python3 migration_cli.py --workspace /private/original-workspace command finance.schema
python3 migration_cli.py --workspace /private/original-workspace stage /private/original-export.csv
python3 migration_cli.py --workspace /private/original-workspace command finance.dataset.create --payload /private/actual-intake.json
~~~

Every mutation uses the original operation_id, expected_revision and actor. Keep the complete request file. Inspect operation.get after interruption and use the original resume command. A lost browser reply preserves the exact pending request in that workspace's session. The UI reads the original journal before offering a same-request retry or explicit continuation. It does not silently create another request.

A confirmed unadmitted request can be retained in session history and returned to an editable draft. For an admitted financial request, finance.request_status observes its original status, error and every owned entity/row/item/result/checkpoint in one Store transaction. Only a known local validation rejection with no committed financial output offers the same return-to-draft action. The complete request, error and observation remain retained; the original operation is not cancelled. Active, unknown and post-commit outcomes stay on original recovery. Session removal completes before the in-memory guard is released. Continuation requests also retain their own original ID.

The existing source importer and case migration are preserved. Financial parsing has a distinct explicit contract because migration-status normalization cannot determine accounting meaning.

## 1. Retain originals and select actual financial meaning

Upload unchanged data, native report/workbook definitions, row/column definitions, dimension configuration, execution evidence and the authorised source/coverage review. Select each file's actual purpose. Only explicitly selected files become evidence for the current action.

A fresh receiving browser reconstructs its file catalogue from retained datasets, native definitions, review evidence and acceptance inventories. Those recovered descriptors are initially unselected. Opening a saved review also restores evidence used only by its individual decisions. Uploads, original files and complete decision files remain downloadable from the same immutable object store. Recovery of a descriptor does not approve its contents.

The financial parser accepts original CSV with a selected delimiter and encoding, or a complete JSON array of flat records. JSON decimal tokens become exact text; unchanged original bytes preserve their token type. Nested vendor responses require an approved explicit transformation before this flat-table parser.

The complete-parser source limit is 64 MiB. Larger files are rejected explicitly. The header preview reads the complete file and returns its full count; its five displayed rows are an explanatory sample.

Do not label a selected API page as a complete export. For approved API extraction, retain all original page requests/responses and terminal-page evidence alongside the complete row file. A failed, partial or unknown collection uses its actual coverage status. This application does not infer a tenant population from a filename, URL or successful parse.

Each dataset supplies:

| Field | Meaning |
|---|---|
| company | Actual selected finance company |
| system | Original system and relevant installed version |
| source_reference | Original export, execution or service reference |
| captured_at | Actual capture timestamp with timezone |
| coverage | complete, partial or unknown, under the retained source review |
| role | actual, budget, commitment, forecast, opening_balance or report_output |
| basis_role | Original actual/budget/commitment/forecast basis for opening or output |
| measure | Exact agreed signed amount representation |
| currency_basis | Actual LCY, ACY or original-currency interpretation |
| window | Complete original start/end dates |
| budget_edition | Required original edition for a budget basis |
| parameters | Actual extraction/report parameters |
| review | Actor, explanation and original evidence files |

Use ISO calendar dates after an approved source transformation. Business Central closing-date notation or locale dates are not silently converted into ordinary calendar dates.

Mapping explicitly chooses original key columns, amount, account, currency and dates. A currency constant is an explicitly reviewed choice, never a default. Dimensions map to actual columns. Multiple keys remain an ordered tuple; delimiter concatenation is not used as identity.

Amounts require exact plain decimal text, without grouping, exponent or currency symbols. Locale normalization needs a reviewed transformation with its original retained. No binary floating-point arithmetic enters the calculation. Blank or absent amounts remain issues, never zero. Duplicate selected identities remain visible and prevent a complete calculation.

A dataset retains the original object SHA-256, settings, original row values, explicit mappings, normalized identities and issues. A later extraction is a new edition that may point to the original parent; it does not rewrite history.

## 2. Preserve and review native definitions

Select the actual native definition files before creating an edition. At least one original native file is required. A JSON interpretation alone does not claim to be a Jet workbook or Business Central package.

Definitions record family, company, native tool/version, financial basis, measure, currency basis, optional budget edition, explicit groups/filters, sign and rounding. Currency is always part of each group key. Account and dimension groups remain explicit.

Filters compare exact original values. Blank text and missing cells are distinct. No implicit wildcard, inferred account range or undocumented vendor formula is evaluated.

Rounding supports a selected scale and no rounding, half-even or half-up. Pre-rounding and presented amounts remain. Sign reversal is explicit. Actuals, budgets, forecasts and commitments cannot be mixed merely because their amount columns share a name.

For a changed definition:

1. Retain its prior native files and a proposed change bound to the original definition.
2. Record the actual prime/customer approval and evidence as the next control edition.
3. Create a new definition with its parent_id and approved change_id.
4. Keep both old and new native bytes.
5. Run and reconcile the new edition without replacing historical output.

The application checks the actual parent head. A writer cannot silently fork a superseded definition/control under the same original parent.

### Native operating route

Business Central definitions are not automatically versioned. Copy/export the existing report, row and column definitions before a change. Its documented report-definition import can replace a same-named report while leaving referenced row/column definitions untouched. Retain and verify all selected definitions and actual target results.

Microsoft explains that sample reports depend on customer accounts, dimensions and budgets, and that additional API fields may need a custom API. The workbench therefore consumes reviewed native artifacts rather than manufacturing a vendor schema.

Primary references:

- https://learn.microsoft.com/en-us/dynamics365/business-central/bi-how-work-account-schedule
- https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/

For Jet, inspect the actual workbook/version, connection, company, parameters, formulas, permissions and licence with the prime. Keep the original workbook and full native output for each period. Execution stays inside the approved customer environment.

For Continia Document Manager and Expense Management, retain actual versions, workflows, permissions and supported interfaces separately. Record findings and change evidence; the workbench does not submit expenses, post journals, approve payments or call undocumented interfaces.

## 3. Calculate each complete reporting period

A run freezes one definition, transaction dataset and period. Balance mode also requires an explicit original opening-balance dataset.

Movement includes period transactions under the chosen posting-date or document-date basis. Balance requires opening values for the preceding calendar day under the same company, basis, measure, currency interpretation and budget edition, then adds period movement. Retained history without an opening source is not silently described as a ledger balance.

The source window must cover the entire period. Each row is included, explicitly excluded by period/filter, or unresolved. Every included amount links to its dataset, original ordinal and immutable key. Invalid selected dates, unresolved amounts and duplicate selected identities cannot disappear in totals.

The result retains full calculated groups, source membership, every exclusion/reason, unresolved issues, source/opening coverage, counts and complete calculation hash.

A complete result means the selected source review states complete coverage and no selected unresolved rows remain. It is not independent evidence of access to every customer record.

## 4. Reconcile native output and resolve differences

Import complete native output as report_output. Keep its financial basis and exact reporting window. Bind it to the original definition hash, period, actual operator and execution evidence.

Every group key, including currency, receives a result:

| Status | Meaning |
|---|---|
| MATCH | One observed key with the same exact amount |
| DIFFERENT | One observed key with another exact amount |
| MISSING | Expected key absent from native output |
| UNEXPECTED | Native output key absent from calculation |
| AMBIGUOUS | Multiple observed rows for one key |
| UNKNOWN | Invalid or unresolved native values |

An equal grand total cannot compensate for positive and negative row errors. All original lineage and signed deltas remain, and the full output is downloadable.

Review every nonmatching key with an owner, explanation and open, accepted_variance or resolved disposition. Accepted variance needs evidence. Resolved needs a later complete reconciliation under the same exact native definition and company/family/period where that exact key actually matches. A different basis, budget edition or grouping cannot stand in for that correction. A comment cannot resolve a mismatch.

A complete, genuinely empty expected and observed population can match. A missing output key is UNKNOWN when the output coverage is partial or unknown; an extra output key is UNKNOWN when the selected source calculation is incomplete. Coverage does not become complete because every visible amount happens to agree.

JSON numeric keys and dimensions retain a number kind and their exact lexeme, distinct from text with the same characters. CSV fields remain text. Numeric 1, numeric 1.0 and text "1" are distinct original identities; any intentional cross-format normalization must be a separately reviewed source transformation. Every normalized row retains raw type labels alongside its original values.

The UI paginates discrepancies in groups of 25 and stores each changed decision independently in IndexedDB. Its key binds the workspace, reconciliation, exact previous review and original item identity. Navigation and important actions await queued writes; failed rows remain in memory, show their error and retry before progressing. Existing unparented session drafts migrate only into the unparented namespace, after their durable write succeeds.

Choose a saved Previous review to load its entire retained decision population. Only drafts for that exact parent overlay those decisions. Changing a note, owner or disposition preserves the decision's existing evidence. Attach current selected evidence explicitly replaces that decision's selected files. The review title, role, note, parent and active tab also survive a page reload. Saving creates a later immutable review and makes that result the parent for further edits.

Large reviews upload one complete immutable JSON decision file. finance.review.create accepts exactly one of decisions or decisions_file: {sha256, filename}; the full file limit is 64 MiB and duplicate JSON keys are rejected. New reviews retain compact metadata, the original decision-file identity and all decision rows. Historical reviews keep their original inline arrays and canonical operation/result bytes. Both formats expose complete paged finance.rows with section decisions, and both are verified against their original admitted request.

Untouched rows remain open. The existing financial disposition rules are unchanged. A review cannot become ready with an open difference or incomplete comparison. Evidence objects are fully verified once per distinct immutable file in the current operation/read; the cache never survives that operation or crosses workspaces. Each referenced corrected result is indexed once for the original discrepancy population.

## 5. Record controls through the existing service process

The control register covers audit, change, access, installation, training, Continia and independent receiving. Entries bind original records and the prime's existing reference. Approval and execution are separate immutable editions. Execution requires a retained approved predecessor and exactly the same complete affected-record scope. A scope change requires its own approved edition.

Use Copy retained definition into draft to start a later definition from its exact existing interpretation and original native files. The old definition is unchanged. Enter the new review note and select the actual existing change authorization. Copy selected previous control carries the prior affected-record scope into an editable entry while clearing the new authority/outcome fields; the operator records their actual values.

Use it for selected audit findings, workplans, role checks, actual installation, staff sessions and independent runs. Include source, actual authority, outcome and evidence. Recording an actor does not grant them tenant authority.

A withdrawn or superseded control cannot be selected as current release evidence. For native rollback, review destination/access revocations separately; an older definition package does not authorise obsolete access.

Where available, retain actual execution time, preparation effort, review effort and freshness in dataset context. Compare equivalent populations and conditions. A target is not a measured improvement.

## 6. Release and receive the whole editable application

A release selects its agreed family inventory and at least two distinct date periods. Every family/period pair needs a completed reconciliation under its current review head; a superseded ready review cannot override a later reopened discrepancy. It also needs current executed audit, installation, training and independent receiving controls bound to reviewed release records, and original acceptance evidence from finance, prime and a receiver distinct from the release author.

Deployment and acceptance are supplied evidence. Recording a release does not perform vendor installation or establish a missing customer signature.

Run finance.verify before export. It reconstructs all datasets from original bytes and recomputes retained calculations/comparisons with zero provider calls.

~~~sh
python3 migration_cli.py --workspace /private/original-workspace command finance.verify
python3 migration_cli.py --workspace /private/original-workspace export finance.reconciliation ACTUAL_ID --format csv --out /private/full-comparison.csv
python3 migration_cli.py --workspace /private/original-workspace prepare-delivery \
  --operation-id ACTUAL_STABLE_DELIVERY_ID --expected-revision ACTUAL_REVISION \
  --actor ACTUAL_OPERATOR --title "Complete finance handover"
~~~

Complete financial exports include every original dataset row, reconciliation item and review decision. A run export includes all retained rows, population, exclusions and issues. NDJSON begins with the original record header and continues with section/value objects. CSV columns are original_record, section, ordinal and complete_json. This explicit section column replaces the earlier flat export shape; downstream readers should select the intended section rather than treating every line as an aggregate row. Review exports work for both unchanged legacy inline records and new paged decisions.

The Records screen offers only the sections supported by the selected kind and retains complete search/paging. All previously prepared deliveries remain visible after browser reopen.

Use the original delivery-file, inspect-delivery and receive commands. The delivery retains the complete SQLite snapshot, all original file objects, historical archives, full application and guides. Current portable selection preserves prior complete application editions.

The independent recipient opens the same workspace identity, recomputes financial evidence, inspects native definitions, makes an authorised later local definition/control edit and prepares another full delivery. Reopening an already received archive preserves later edits.

### Complete supplied-plan programme

financial_receiving.py consumes an actual operator-authored plan and retained originals, runs the full local course, and verifies two independent receiving directories. It does not generate customer fixtures.

Schema commons.financial-operating-plan/v1 contains:

- id, title, actual actor and distinct receiving_actor.
- files: complete key/path/sha256/bytes/filename and optional purpose.
- steps: ordered key/operation/payload selections.
- receiving_steps: actual later edits by the independent operator.

Use {"$sha":"FILE_KEY"} for a retained SHA, {"$file":"FILE_KEY"} for a complete file reference and {"$record":"STEP_KEY"} for a prior actual result ID. Step keys are stable across the whole plan. Original operation IDs derive from plan, phase and step.

~~~sh
python3 financial_receiving.py --plan /private/actual-plan.json \
  --workspace /private/original-workspace --output /private/receiving-course
~~~

--create is explicit for a genuinely new local workspace. --resume continues only the same retained interrupted plan. The output retains the complete original plan, input identities, actual results, both archives and final verification. Completed replay verifies both archives and both current editable receiving workspaces while preserving later edits.

## Customer and commercial boundaries

This is reusable source engineering. Issued packs, partner correspondence, private customer exports, actual configuration and credentials stay in their authorised case/workspace. Do not place them in a public repository.

Keep the accepted selected reporting/control inventory and baseline hours distinct from the prime's wider audit, service term, qualification evidence, rate card and recurring support. Source code cannot supply named-resource qualifications, signed references, ESPD answers or customer acceptance. Preserve those obligations in the original commercial case.

No Business Central credential, Jet workbook, Continia private interface or customer output is included in this source. Publication, source verification, a real supplied-plan run and customer acceptance remain separate results.


## Required rendered-product inspection

The owner instruction in the repository AGENTS.md applies to this application and every delegated build/receiving assignment. Before calling an exact outgoing client/prospect-facing application, report, presentation or export ready, open/run/render it, LOOK at its actual screen or screenshots, and operate the important controls. Inspect the intended screenshare width and relevant narrow/mobile width, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them, source review, DOM counts, HTTP status or another peer's source approval does not replace inspecting the actual product.

Keep the industrial design plain: readable tables and records, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Fix clipping, overflow, unreadable output and broken or unstyled controls inside the authorized implementation. Preserve real data and workflows. Propagate this instruction to the receiving/build guidance and future child assignments; preserve existing owner controls, historical evidence and the original operating owner. Do not replace implementation with broad redundant validation suites.

The operator-continuity source has received complete independent source review; its JavaScript parses, and the full UI references match its HTML. The originating cloud process request has not returned an executing Python/browser result. Exact outgoing visual inspection and native operating-course results must come from the equipped receiving owner in the original thread. Source publication itself does not establish customer readiness.
