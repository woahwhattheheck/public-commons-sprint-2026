# Twenty CRM migration review and native handover

Prepared by TokenJunkieLabs.

This product adds a retained source and independent Twenty destination review to the maintained Migration Acceptance Workbench. It handles the selected companies, people and opportunities, including composite names, email and link fields, exact monetary units, and explicit relationships. Operators select the actual workspace objects and business keys; the example is not a customer capture.

The collector and review make no CRM writes. The installed native pipeline writes to its selected local DuckDB receiving destination. Approval of a mapping binds that exact source and mapping for comparison. It does not approve a production import or establish that every business requirement has passed.

## Complete installed source

Run commands from the public product directory, products/migration-acceptance. Keep the complete workbench/ directory and its SOURCE_MANIFEST.json beside adaptations/twenty/. The new adapter has its own complete source manifest. Do not install just the HTML or an isolated provider module for native execution.

project.mjs and native-intake.mjs derive from the complete original generic modules from the Airtable/NetSuite adaptation. The Twenty project receiver additionally verifies that each history attribution and approval exactly matches its retained original request. This is consistency verification, not a cryptographic signature. Their original hashes and the changed adapter bindings are recorded in SOURCE_REUSE.json. The selected source, upload, request journal, load, comparison, acceptance and receiving operations continue through the original Workbench. No separate database or replacement migration controller is created.

The browser interface can run from the installed product's existing static/application server. Its application path is adaptations/twenty/. Use the existing authorized runtime and owner. Do not borrow another person's browser page or create a second receiving queue.

## Capture both actual populations

Use the maintained read-only capture collector with separately authorized source and destination selections. The source may be another Twenty workspace or complete original legacy JSON export files. The destination must be independently captured Twenty.

Retain these items together:

- Exact original response/export text, filename or endpoint, byte length and SHA-256.
- Authenticated workspace-generated OpenAPI and before/after selected object and field metadata.
- Explicit fields, population/filter scope, every page cursor, and the terminal page.
- Workspace identity, capture interval, and observed-interval or evidenced quiescence.
- Original relationship metadata and separately observed related objects needed for reviewed key lookups.

An observed interval is not a transaction across workspaces. A stable row count alone does not establish a frozen population. Selection coverage and deletion visibility remain in the capture; a record not observed in that selection is not automatically a deletion. API attachment metadata does not include the linked binary document unless it has separately been retained.

Use the actual collector configuration and its accompanying capture instructions. Supply credentials through the named environment variables in the receiving runtime. Do not put tokens in source captures, mappings, this UI, or a customer handover.

## Open and retain a review

Open the exact outgoing review HTML, or the installed review page. Choose a saved complete project or unfinished working copy. Alternatively select the complete combined capture and the initial mapping, assign a stable project identity and readable title, then create the project.

The combined capture includes independently acquired source and destination data. Selecting a file retains its original text and filename in the unfinished working copy. It does not replace an existing project's capture. Create a separate project to adopt another capture. A UTF-8 byte-order mark remains in the original intake download; parsing removes it only from the parser's working string.

The browser does not save the review to a server or browser storage. Save unfinished working copy preserves the selected raw intake files, source project, all saved mapping editions, the current raw mapping text, reviewer inputs, selected view, and unfinished structured field/table forms. It works before a project is created. Download it before closing.

The supported complete file/workspace capacity is 512 MiB. The native source package can contain repeated representations, so its encoded size may exceed the size of a single input. If a prepared packet is too large, retain the complete project and continue through the native intake. Source selections and saved copies are validated before adoption. A rejected file remains downloadable in its original bytes while the current review remains open.

## Review explicit composite fields

The Mapping view exposes table name, source object, independently captured destination object and business key columns. Each field has an exact native type, nullability, original source pointer and destination pointer.

Examples from the authored reference:

| Field | Original source | Independent Twenty destination | Explicit treatment |
| --- | --- | --- | --- |
| Person first name | /firstName | /name/firstName | Text; retain empty string separately from null |
| Person email | /email | /emails/primaryEmail | Text; no automatic case or whitespace rewrite |
| Company website | /website | /domainName/primaryLinkUrl | Retain the actual selected link value |
| Opportunity amount | /amount | /amount/amountMicros | Decimal with explicit six-place unit conversion |
| Person company key | /companyKey | /companyId | Reviewed reference to companies /id → /legacyId |
| Opportunity contact | /contactKey | /pointOfContactId | Reviewed reference to people /id → /legacyId |

JSON Pointer escapes are ~0 for a tilde and ~1 for a slash. Missing-cell policy is separate from a cell that actually contains null. A default value must be explicit JSON; no value is silently substituted. Integer and decimal tokens are preserved exactly before schema-aware conversion. A value that would require rounding must be reviewed.

The transform JSON supports the provider adapter's explicit lookup, decimal-shift, json-text and reference transforms. A reference transform identifies the separately captured related object, keyPointer and valuePointer. Retain actual relation metadata and select the related object fields. The review does not infer a business-key match from record order.

Structured forms update the full mapping draft only when Apply field to draft or Apply table settings to draft is selected. The full authoritative JSON remains available for relationship rules, native acceptance controls and additional mapping properties. Every unfinished form retains the mapping basis on which it was opened. If the raw mapping changes that field or table, applying the older form rejects rather than overwriting the new mapping. Download the working copy and reload the selected form to compare it with the current draft.

Removing a table or field changes positions, so finish or reload retained forms before removal. Saved mapping editions remain in history. Changing a business key or table name may require corresponding relationship and acceptance-rule changes.

## Preview and record the entire edition

Preview complete mapping validates both actual populations, exact cell types, original keys, explicit missing policies and relationship selections. It does not change the saved project.

Enter the real reviewer and reason. Select approval only after reviewing the exact source and complete mapping. Save attributed mapping edition records a complete new edition and original operation. The existing project API retains the original capture, mapping chain and operation request identity. Repeating the same original request does not create another edition.

Unapplied structured forms must be applied or reloaded before a full preview or attributed save. Invalid raw mapping text can still travel in the unfinished working copy. Restore saved mapping text explicitly discards the current raw draft and its field/table forms; save the unfinished copy first if those drafts are needed.

Save complete project produces project.json for native receiving. This contains the immutable capture and complete mapping history. Save unfinished working copy additionally preserves original intake filenames/text and the browser editor.

## Review populations, sources and history

The populations table shows original source counts and independently captured destination counts. Select every mapped table and both sides. Search operates over the complete selected population; the screen pages 100 rows and Download complete selected table exports all rows, not only the visible page.

Inspect the complete projection for original record IDs, page and row identities, missing cells and relationship findings. The source file view provides every retained prepared member. The history view displays and downloads every complete mapping edition.

The authored reference retains two companies, three people and two opportunities. Its destination contains an intentional USD 50 amount difference. Zero CAD, empty text, null and a leading-zero original business key are retained. Do not replace the destination with source values to make this reference pass. Actual native observations should report the intended difference.

## Build the complete offline review

From products/migration-acceptance:

~~~sh
node adaptations/twenty/build-review.mjs /absolute/new-output/twenty-review.html
~~~

The builder verifies the complete adapter manifest and the exact original Workbench browser dependencies, embeds every adapter source file, and builds the actual ESM module graph. The generated file opens without a hosted application server. It includes the operating guide, editable source download and authored reference project.

Keep an existing different output and choose a new filename; the builder does not silently replace a prior edition. Open the generated HTML itself and operate its controls. Source verification or generation alone is not visual acceptance.

## Run the original native operation

Use Node 24 or newer and the installed Workbench's validated Python/runtime-ready selection. Retain one original stable operation, actor, source project and directories.

~~~sh
node adaptations/twenty/receive.mjs \
  --project /absolute/input/project.json \
  --directory /absolute/original-workspace \
  --receiving-directory /absolute/independent-receiving \
  --runtime-ready /absolute/runtime-ready.json \
  --operation ACTUAL_ORIGINAL_OPERATION \
  --actor ACTUAL_REVIEWER
~~~

The source project must include the named approval of the exact mapping. The driver retains each full source through original uploads and source.retain requests, compiles the original dlt pipeline, executes its local load and verification, creates complete parity observations, compiles explicit business acceptance, and evaluates them.

It exports complete parity, observations, business acceptance, the native result and the full editable NDJSON handover. It receives that archive into a separate workspace, verifies original source and job identities, adopts original request journals, and cold-reopens the copied receiving application.

Use --native-project only for the intended existing native project. A repeated original operation uses its saved request identities and revision guards. If an original native attempt is interrupted, inspect it before using --resume; that continues the same original ended attempt. An uncertain target write is not silently repeated. A different source or mapping requires a separately identified reviewed operation.

--select-local is optional and acts only when both parity and acceptance are ready. It selects the closed accepted local DuckDB snapshot for the original local consumer. It does not write or select a live CRM destination.

Failures retain original source/request evidence. Workspace cleanup preserves the primary failure if closing also fails. Examine the original operation result and journals before continuing; do not create a replacement writer to hide an unresolved outcome.

## Browser receiving

browser-receive.mjs exports receiveProviderReview({page,baseUrl,applicationUrl,projectPath,outputDirectory,ownerCheck,actor}). Supply the existing authorized Page and ownerCheck. applicationUrl selects the exact standalone HTML through the installed file or served route.

Run the labelled reference project through the empty and populated views, invalid input, unfinished field and mapping recovery, attributed review, all mapped tables and both populations. Download the working copy, complete project and retained source files, then reopen them. Inspect the rendered desktop and narrow layouts and correct any unreadable or clipped content. The receiving output retains the actual run, downloads and screenshots alongside the operator’s recorded review.
