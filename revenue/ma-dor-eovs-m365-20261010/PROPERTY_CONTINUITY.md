# Property continuity in the maintained migration workspace

This is an additive property, lease and platform-return workstream in the existing migration application. It uses the same SQLite workspace, original file objects, operation journal, browser server, CLI, complete exports and portable receiving mechanism as the case, grant and financial workstreams. Existing records are retained. The original property edition contained 39 files; the current cumulative application contains all 59 files, including the complete housing commissioning workflow.

## Intended use and original company ownership

Use this module to compare a complete reviewed source population with separately acquired returns from its authorised systems. It supports property hierarchies, composite Rental Space identities, lease dates and states, independent capital-project identities, document versions, financial mirror rows, billing-request outcomes and GIS references through explicit selected family contracts.

A commercial opportunity does not appoint a platform writer. The original company thread identifies its current application, source, native-operation and commercial owners. A company already operating another maintained workspace keeps that workspace and its original receiving operation; integrate compatible source through its selected adapter rather than silently starting a second customer store.

The public IDA RTP describes separate process/document/finance/spatial responsibilities, independent capital-project identity and a single active lease per Rental Space. Its qualification date has passed; later tender dates are indicative and apply to shortlisted candidates. These source facts justify a potential partner workstream, not a claim of participation or an order. The current application contains no IDA export, selected vendor schema or customer approval.

Primary source: [IDA issued RTP, especially pages 15 and 18–19](https://www.etenders.gov.ie/epps/cft/downloadContractDocument.do?documentId=8912599&resourceId=8912550). Actual high-level design, selected field contracts, source inventory and appointed writers must be supplied for customer operation.

## Open the current application

Use the complete selected source roster. Do not mix an older entry module with a partial set of new dependencies.

For an existing workspace:

    python3 migration_server.py --workspace /absolute/path/to/current-workspace --port 8083

Open http://127.0.0.1:8083/property in the equipped browser. The server defaults to loopback. To create an actually new authorised workspace, use the existing server's explicit --create option and a new owned directory. Do not use that option to replace a handed-over workspace.

The property page has six working stages: Contract, Source files, Rehearsals, Findings, Release, and Records and handover. The design is plain industrial software, with readable controls, restrained monochrome styling and responsive layouts. Styling/source inspection is not a rendered-product result.

Every mutation retains operation_id, actor and expected_revision. A lost response leaves its original request visible. Inspect the original operation before continuing it. A confirmed unadmitted request may be returned to the editable draft; that request remains in the browser session history. An admitted request retains its identity and is continued through the existing operation mechanism. For a known local validation rejection, property.request_status reads the original operation and its exact owned outputs in one SQLite snapshot. Returning to a corrected draft is permitted only when that operation is INTERRUPTED, its error is one of the maintained input-validation errors, and its property record, child rows, result and checkpoint are absent. The original request, error and observed disposition remain retained. This observation does not cancel that original request. Active, unknown or post-commit returns stay on their original recovery path.

## Define the complete contract

A contract contains:

- title and scope_id;
- platforms, each with id, named writer and actual contract_reference;
- families, each with id, authoritative platform, ordered complete identity, fields and explicit relations;
- the reviewed lease_rule;
- the actual review actor, note and retained evidence file identities.

Each field declares type and required. Supported types are exact, text, decimal, date, instant and boolean. Exact preserves source type and lexeme. Text requires an original text value. Exact decimal comparison uses original decimal text without floating-point conversion, grouping or inferred locale. Date requires an explicit ISO calendar date. Instant requires a timezone, second precision and at most six fractional digits; comparisons normalise instants while raw source values remain retained. Boolean requires an actual JSON boolean or a reviewed transformed export.

Identity fields must be required exact/text fields. Numeric-looking strings remain strings; the original JSON numeric token 1, token 1.0 and text "1" remain distinct under exact semantics. Null, blank and absent are separate retained source states.

A relation specifies its complete ordered child fields and the parent's complete ordered identity. Include every namespace, organisation, property or scope component that makes that identity unique. A matching display label is not a relationship. Optional relationships permit an entirely empty identity; a partially empty identity stays unresolved. Referenced parent populations are checked separately.

Capital project identity belongs in its own family. A KPN-to-property association is a separate reviewed relationship. Documents generally need original document identity and version in the complete key. Finance mirrors generally need original financial identity, currency, amount and counterparty. Billing outcomes require the original request identity and returned outcome. An acknowledgment must not be described as a posted invoice. Spatial families retain the actual feature identity, CRS and units and any explicitly selected attributes; this module performs no coordinate transformation or spatial write.

Later contracts preserve parent_id and a reviewed change_reference. Existing datasets and assessments keep their original exact contract. Customer schema changes require a reviewed later contract and appropriately selected inputs; they do not rewrite history.

## Retain originals and map columns

The retained-files list supports complete source/target exports, extraction and approval evidence, and the accepted inventory. Its browser state is recovered from actual workspace dataset and evidence descriptors when a new receiving browser opens. A recovered file is unselected until the operator chooses it. Recovery of a file descriptor does not approve its contents.

Input parsing supports complete CSV and flat JSON row arrays. Original bytes remain content-addressed objects in the workspace. CSV encoding and delimiter are explicit. JSON duplicate keys and nested vendor values are rejected rather than silently flattened. Original numeric lexemes and raw_types preserve source distinctions.

The parser has an explicit 64 MiB per-file bound and the retained financial parser's one-million-row bound. Larger native populations need an agreed full partition/family scheme or a supported reviewed export transformation. Do not substitute a convenience sample. A true empty JSON array can be retained using explicit reviewed mapping columns; no placeholder row is inserted.

The file preview returns the complete row count and the first five original rows. The preview is for selecting columns; saving a dataset parses and retains every original row. Map every field in the reviewed family. A missing required value, invalid selected type or repeated complete identity remains a visible issue.

For each dataset record the exact scope, family, source/target role, system, source reference, captured_at, effective cutoff, complete/partial/unknown coverage, authority, extraction_reference, independent flag, original extraction parameters and reviewed evidence. A target return requires its own acquisition evidence and extraction reference. Identical file bytes can be legitimate separately retrieved values; an echoed original dataset is not an independent return.

Source and target acquisition assertions remain externally supplied evidence. The application checks their retained consistency and object bytes; it does not authenticate a person's role or a vendor's response by reading a checkbox.

## Freeze complete editions and reconcile

An edition selects exactly one retained dataset for every contracted family, including confirmed empty families. Every dataset belongs to the same exact contract, side and effective cutoff. Later editions preserve their previous edition and use the original family datasets or their explicit descendants.

A reconciliation selects one source and one target edition. It retains every record comparison and every rule check. Record outcomes are MATCH, DIFFERENT, UNKNOWN, AMBIGUOUS, MISSING and UNEXPECTED.

Absence is conclusive only where that side's family is complete and all original identities are present and valid. An incomplete family or invalid identity cannot establish that a row is absent. Duplicate identities remain ambiguous. No first matching row is silently selected.

Separate checks cover full-population coverage, independent target acquisition, authoritative platform, row quality, complete parent relationships, lease-to-space links, lease states and dates, state cardinality and interval overlap. A matching row does not override an unresolved platform or population check.

All report rows remain available through paged search and complete CSV/NDJSON exports. Searches affect the displayed selection, not the retained assessment.

## Lease time and cardinality

The lease rule names the Lease Agreement and Rental Space families, the full space reference, status field, exact active-state values, start/end fields, time_kind, end_boundary, open_end policy and optional cardinality_mode.

Start is explicit. An open end requires the end field to be present with a reviewed empty/null meaning and open_end=true. A missing field is not inferred to mean infinity. Date and instant semantics do not mix.

Inclusive end treats a lease ending on a date/instant and another beginning there as overlapping. Exclusive end permits the next lease to begin exactly at the prior end. Empty or reversed intervals stay unresolved under the selected convention.

The default cardinality_mode is declared: at most one record may be in the selected active states for one complete Rental Space identity. A reviewed at_cutoff mode instead considers the effective interval at the selected cutoff. Unknown intervals cannot become inactive merely because they cannot be parsed.

The full interval-overlap check is separate from cutoff cardinality. It examines active-state intervals across the complete retained population and emits connected conflict groups containing all participating rows. Its sorted sweep avoids enumerating every overlapping pair. It never removes those original intervals or substitutes the summary for their individual records.

## Review every finding coherently

A review includes one explicit disposition for every non-MATCH item and non-PASS check. Each decision retains subject, id, status, owner, note and its selected evidence files.

Open means unresolved. An evidenced accepted_variance is available only for a factual DIFFERENT item. Coverage, authority, missing/extra rows, ambiguous identity, structural and lease-rule findings need corrected originals.

Resolved decisions point to one coherent complete corrected reconciliation using the same exact contract and cutoff and descendants of the original source and target editions. All its items must match and all checks must pass. Several successful fragments from different target editions do not form a complete correction. The review retains the corrected assessment as its effective selection while preserving the original findings and decisions.

The browser saves finding drafts individually in IndexedDB, keyed by workspace, reconciliation, selected parent review, subject and original finding identity. Each input change captures its own immutable draft. Important actions and navigation await outstanding writes, retry dirty rows and show a storage failure if persistence is unavailable. Large reviews do not rewrite a single growing sessionStorage entry on every keystroke. Loading an explicitly selected parent review reads its complete retained decisions from the server and then applies only the drafts for that exact parent. Drafts created before parent-aware storage remain in the unparented draft namespace. Selecting another parent never silently relabels those earlier drafts.

Saving a review uploads its complete decision array as an immutable file and sends that identity through the small operation request. Inline decisions remain available through the CLI for smaller programmes. The decision file limit is 64 MiB; duplicate JSON object keys are rejected. Review metadata stays compact; every decision is available through property.rows section decisions and through full exports.

## Record actual controls and release

The control categories are baseline, mapping, access, cutover, recovery and receiving. Each control binds the exact contract and complete related original records, with actual owner, external reference, note and evidence. Proposed, approved, executed, rejected and withdrawn states are retained as later editions.

Execution follows its retained approved parent and preserves precisely the approved related-record scope. A changed scope requires its own reviewed approval. The application records supplied external decisions; it does not create the authority to execute them.

A release selects current completed reviews of at least two distinct full source/target rehearsals, all six categories of current executed controls, the accepted inventory and actual acceptance evidence. Each family's source and target acquisitions must identify distinct extraction references and captured instants between rehearsals. Renaming an edition does not create a second rehearsal. A genuine later extraction may contain unchanged business values.

A superseded review, control or contract cannot be selected as the current release authority. Original releases remain historical records. Production rollback, compensating correction and permitted processing locations are decisions for the appointed prime/client, represented by their actual retained evidence.

## Complete receiving and cold reopen

The current full portable application profile is commons.migration-workbench-application/v6. It includes all 59 application files. Earlier 16-, 21-, 24-, 31-, 39-, 48- and 56-file deliveries retain their exact advertised profile compatibility. The historical 39-file property edition keeps commons.migration-workbench-application/v3. A later application delivery must include every dependency and its exact manifest.

Use the complete plan schema commons.property-receiving-plan/v1 with:

    python3 property_receiving.py \
      --plan /absolute/path/to/complete-plan.json \
      --workspace /absolute/path/to/original-workspace \
      --output /absolute/path/to/original-receiving-operation

Use --create only for a genuinely new original workspace and --resume only to continue the same retained operation. The plan fixes operation_id, title, actor, files, producer steps, first_edit, second_edit and release_required. Every file has its exact path, filename, SHA-256 and byte length. Both receiving actors and their complete edit steps are explicit.

Step references use {"$file":"key"} for an original file descriptor, {"$sha":"key"} for its hash and {"$step":"key"} for a preceding original record identity. The inherited $record alias is also accepted. Only preceding complete results may be referenced.

The runner retains the plan and source selection, operates the producer, exports the entire application/workspace, receives it independently, applies the first recipient's edits, exports again, receives the second complete copy, applies its edits, exports the final result and cold-reopens it. Completed-operation replay verifies both progressed recipients and the final handover without re-extracting over later work.

release_required=false produces a working-record-received result with release:null when actual release controls and client acceptance are absent. This is useful editable delivery, not a claimed customer release. release_required=true requires the selected actual release. No provider request, invoice or GIS operation is executed.

## One complete authored reference course

Run the same maintained application and receiving programme:

    python3 property_reference_example.py --directory /absolute/path/to/one-owned-course

The --prepare-only option writes the complete originals and plan without claiming an operating result. To continue an interrupted run, use the same original directory and --resume.

The course contains nine full families and five complete source/target selections. Its first rehearsal contains overlapping declared active leases, a missing document version, an exact amount difference and an acknowledgment in place of the authored expected invoice outcome. The next selection corrects the complete source/return at the same cutoff and resolves every original finding against that one corrected assessment. A later full rehearsal adds a document version. Recipient one changes a property display name; recipient two corrects a lease amount and its matching finance row. Both retain all earlier originals, complete family populations, mappings and findings.

The example deliberately uses two Rental Spaces with the same local label under different property keys and a text identity beyond JavaScript's exact-integer range. Capital identity remains separate. Document-version metadata hashes refer to the included authored text files. The domain compares selected metadata; it does not claim a customer binary transfer or authenticate a vendor signature.

Every name, source row, acquisition label, amount and reviewer label in this course is authored. It exercises software behaviour; it does not establish actual supplier data, tenant integration, procurement qualification or client acceptance. The receiving result keeps that boundary explicit.

## Required rendered-product inspection

Bryce's owner instruction applies to local/cloud sessions, all providers, current workers and future delegated work. Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation or export ready, the producing peer must open/run/render the exact outgoing version, LOOK at the rendered screen or actual screenshots, and operate the important controls.

Inspect the actual screenshare width and relevant narrow/mobile width; populated, empty, loading and error states; downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks or another peer's source approval do not replace seeing the actual product.

Fix cramped, clipped, overflowing, unreadable, broken or unstyled output inside the authorised implementation. Keep readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve the actual data and workflow. Reviews lead directly to repairs and are not a replacement for implementation or a reason for broad redundant test suites.

Include this instruction in the build/receiving guidance and relevant future child assignments. Preserve existing owner controls and historical evidence. The October 13, 2026 owner instruction is retained in the repository's root AGENTS.md and in this application guide.

## Current source and validation state

The domain, browser and workspace have undergone complete independent source review. That review corrected absence classification, repeated population scans, preview-before-mapping, coherent correction selection, large decision-file intake, status filtering, immutable evidence hashing, receiving file discovery and durable per-decision drafts.

The authoring session's native process request ended before process creation with environment_offline. That returned no Python validation or browser result. The browser source parses as JavaScript; it has not been visually inspected in this authoring environment. The receiving runner therefore keeps rendered inspection NOT_VERIFIED until the equipped operator returns the exact outgoing views and operated-control results.

Continue the original equipped receiving operation with the complete source package and original owners. Record its actual outcomes in that same company thread. Do not replace the existing company application or native operation simply to obtain a new run.
