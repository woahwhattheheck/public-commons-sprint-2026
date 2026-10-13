# Airtable / NetSuite provider migration operator

This additive operator uses the original Migration Acceptance Workbench, its dlt 1.31.0 / DuckDB runtime, immutable Workspace writer, complete table comparator, business acceptance and receiving archive. Provider collection is read-only. This source is reusable; tenant captures and customer commercial records are kept separately.

## Complete installed source

Install the unchanged `products/migration-acceptance/workbench/` tree and this entire `adaptations/airtable-netsuite/` directory. Keep both complete SOURCE_MANIFEST.json files. The native receiving command verifies every selected member before including it in the editable archive.

The provider adapter reads the original exact JSON parser. Preserve that dependency at `workbench/vendor/dlt/vendor/sling/vendor/stellar-expert/exact-json.mjs`. Browser and Node use the same complete provider-input module and maintained pure SHA-256.

Use the original Node 24+ / CPython 3.12 runtime and the workbench's pinned native runtime-ready file. Follow the workbench's installation guide; this adapter adds no separate database engine. GitHub Actions must remain disabled and no hosted run is required.

## Capture and mapping

Use the complete collector configuration and guide supplied beside provider-input.mjs. Select the actual Airtable base/table IDs and NetSuite REST account/query IDs. Keep all pages, exact UTF-8 bodies, hashes, request offsets/query identities, schema before/after and observed capture interval.

A source capture is `airtable-netsuite.capture.v1`. A mapping is `airtable-netsuite.mapping.v1`. Each selected output table declares its original Airtable table, independent NetSuite query, destination column names, exact scalar types, null/missing handling and business key. Linked-record expansion keeps original record identity and ordinal; it does not join by a display label.

Absent Airtable fields need explicit policy. An omitted checkbox value, null, empty text and an absent linked-record list are distinct until the reviewed mapping states otherwise. Decimal values must fit declared precision/scale without rounding. Stable IDs remain strings. NetSuite expected rows come only from the separately retained query responses.

Full pagination establishes a selected population across an observed interval. It is not a transactional snapshot across two providers. A live-list absence is recorded as not observed, not a deletion instruction. Inactive inclusion/exclusion and filtered versus full live scope are explicit. Attachment metadata does not imply that external attachment binaries were downloaded.

## Review the complete project

Serve `products/migration-acceptance/` over localhost and open `adaptations/airtable-netsuite/`. The review app can be served with the existing source server or an ordinary static server; it does not need credentials.

1. Select the original complete capture and mapping files. Enter one stable project ID and title, then create the project.
2. Inspect complete populations, original key fields, every selected table, relationship findings, original source files and full projection row identities.
3. Edit the complete mapping, preview it and resolve invalid types, missing selectors or population coverage. A preview does not replace the saved project.
4. Enter the actual reviewer and reason. Saving an attributed mapping edition retains its complete prior mapping and original operation. Approval binds that exact capture/mapping for native compilation.
5. Download the complete project. **Save unfinished working copy** also preserves invalid or incomplete mapping text, reviewer fields and the last complete source project. Reopen it through the same project file control.
6. Download the complete prepared source package when the saved edition is selected. It contains every original/projection file and the complete editable project.

Export uses the selected saved mapping; native compilation additionally requires an attributed approval of that exact capture and mapping. A failed preview keeps current work. Opening an invalid file keeps the previous project. Complete project/working files have an explicit 512 MiB capacity; the original native intake uploads complete files in retained chunks.

## Business acceptance selection

Every selected table receives an object definition with its exact native primary key and declared required columns. Every table also has a required complete row-count control.

Mapping `relationships` become original acceptance relations: `parentTable`, `childTable`, their full column arrays, and the selected null policy. `reject` maps to original `forbid`; `allow-all-null` remains that explicit policy. Relations default to required; a selected `acceptance: "reviewable"` is retained.

Optional `mapping.acceptance.controls` uses the original acceptance format: unique ID, objectId, complete groupBy fields, count or exact sum measure, null policy and required/reviewable disposition. The original compiler validates these rules. Do not add business totals or tolerances that the selected scope has not defined.

An attributed browser mapping approval authorizes compilation of that precise mapping. Measured findings remain separate: the original Workbench UI records any reviewable exception with its actual actor and reason. Required findings continue to prevent local consumer selection.

## Original native continuation

Save the reviewed project at an ordinary absolute path and run from the complete product root:

```sh
node adaptations/airtable-netsuite/receive.mjs \
  --project /absolute/path/project.json \
  --directory /absolute/path/original-workspace \
  --receiving-directory /absolute/path/independent-receiving \
  --runtime-ready /absolute/path/runtime-ready.json \
  --operation ORIGINAL_STABLE_OPERATION \
  --actor ORIGINAL_OPERATOR_ID
```

An explicit `--native-project` selects an existing original project. Otherwise the original Workspace create action uses the retained operation-keyed request. The same command reopens its original requests after response loss. Do not change its operation ID or arguments to bypass a retained error.

The command:

- verifies the full installed source manifests and reviewed project;
- retains every original response, projection, independent expected table, mapping, editable history and input binding through source.retain;
- saves each exact request before dispatch and receives the original result on retry;
- compiles and reviews the original pipeline against the named mapping approval;
- runs the original native load and explicit verification, then whole-population parity and business acceptance;
- exports complete findings and original observations even when the provider populations disagree;
- prepares the full original editable handoff, receives it in an independent Workspace and reopens the copied original application in a separate process.

Complete comparison findings do not automatically cause provider writes. Optional `--select-local` selects the closed accepted local DuckDB consumer only when both parity and business acceptance are ready. Without that flag, the receiving case remains available for the original operator's review. Native job errors retain their original Workspace requests and full source; inspect the original workbench before using `--resume` for that same ended native attempt.

A new source/mapping edition uses a deliberately selected following operation and preserves the earlier full project. Portable receiving adopts the original complete source-retention ledger before making any following mutation.

## Rendered receiving and delivery

Use the existing authorized browser/Page and actual native process, preserving its current receiving work. The exported receiveProviderReview helper takes that Page, the product-root baseUrl, original projectPath, outputDirectory, required ownerCheck callback and the actual reviewer actor. It opens the complete application, retains every selected source and records the following attributed review edition without acquiring a browser.

Open and actually use the exact outgoing desktop and narrow application. Inspect empty and invalid-file states; complete source selection; mapping errors and valid save; attributed approval; all selected tables and row paging; long values; original-source downloads; full project and unfinished-working reopen; and the extracted prepared files. Continue through the original Workbench load, comparison, findings, acceptance, download and independently received application.

Literally open/use every outgoing attachment. Extract archives and open contained deliverables and the project. Inspect every PDF page; operate spreadsheet/map controls and actual downloaded/reopened versions. If producing media, use the actual final export and watch/listen to it with natural voice/TTS. Source review, DOM checks and command success do not replace observing the rendered customer result. Repair obvious errors in the same edition and keep original receiving identity.

The provider core's in-process operation demonstrates its complete input/output contract. The native and browser result is recorded only from the actual original runtime and rendered receiving course.


## Complete offline review on the existing browser

When the existing browser uses ordinary files instead of loopback navigation, run `node adaptations/airtable-netsuite/build-review.mjs /absolute/path/provider-review.html` from the installed source. The builder verifies the full addon manifest and both exact native browser dependencies, retains every addon file plus the native browser source and manifest, and embeds the unchanged module graph into one HTML file. The original reviewed project remains the input; this is the same editor and writer.

Open that literal HTML file in the existing owned browser. Download the complete embedded source and authored reference project from its source section, open the selected project through the original control, and use the same full receiving journey. The helper accepts an explicit `applicationUrl` with that file URL instead of the original product-root `baseUrl`. It waits for the actual module initialization before using controls. Blob module URLs remain valid for the document lifetime and back/forward restores. Native dlt execution still uses the complete original Workbench and its pinned runtime.
