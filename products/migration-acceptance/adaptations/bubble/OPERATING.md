# Bubble capture, editable review and native receiving

This is one adapter inside the existing Migration Acceptance Workbench. The maintained Workspace, source.retain, plan.compile, dlt runtime, acceptance writer and whole-application archive remain authoritative.

## 1. Capture actual authorized source and destination populations

Read COLLECTOR.md and copy configuration.template.json to an ordinary private working directory. Set the exact HTTPS application origin, live or explicitly named branch path, API type names, reviewed constraints, sort fields and credential environment-variable name. Credentials remain environment inputs and are never part of the capture.

Run the collector once for the source environment and once for the separately selected destination or rehearsal environment:

```sh
node adaptations/bubble/collector.mjs --config source-config.json --directory /absolute/source-capture
node adaptations/bubble/collector.mjs --config destination-config.json --directory /absolute/destination-capture
```

Keep its complete capture output, original responses and operation checkpoint together. Reuse a completed original operation to recover a lost response. A different configuration needs a distinct operation/directory.

Bubble cursor pagination has a documented ordinary-plan ceiling of 50,000 items and an Enterprise ceiling of 10 million. The native adapter supports at most one million retained rows per selected type or expanded table. A partition beyond the configured cursor ceiling fails; it is not labelled complete. At exact ceiling, retain the independently reviewed same-population count and its complete source locator/evidence. Multiple explicit partitions retain their coverage review; overlapping IDs fail. Neither stable counts nor complete pages prove a transactionally frozen live database.

Each partition retains its complete first page as countBefore and a separate same-query countAfter after pagination. Cursor/count/remaining, response identities and observed totals must agree. Missing privacy-visible records remain a source boundary, not inferred deletion evidence. Attachments retain their actual URL/metadata only; authorized file downloads need their own complete source capture.

## 2. Prepare and open the complete mapping

```sh
node adaptations/bubble/prepare-provider.mjs \
  /absolute/source-capture/capture.json \
  /absolute/destination-capture/capture.json \
  /absolute/mapping.json \
  /absolute/prepared-source
```

The prepared directory includes capture.json with both whole captures, the individual source and destination captures, full mapping, all exact source tables, independent expected tables and the full projection report.

Open the review HTML. Select capture.json and mapping.json, enter a stable project identity/title and create the project. An incomplete mapping still opens in the editor; preparation errors remain visible and native export remains unavailable until corrected. The source and raw mapping remain downloadable.

Use complete-population views to inspect every selected table and either side, search retained rows, page through them and download the full table. Inspect relationships, missing-value policies, lookup origins and the complete observation interval. Original source files and prior mapping editions remain available in separate views.

Preview a changed mapping, enter the actual reviewer and reason, then save its attributed edition. Export uses the selected saved mapping; native compilation additionally requires an attributed approval of that exact capture and mapping. A file with unfinished or invalid mapping text retains the complete previous valid project and exact raw editor text. Open that working file to continue editing.

## 3. Continue through the maintained native Workspace

Use the actual existing compatible dlt runtime receipt. This adapter does not create a provider account, new runtime service or remote database.

```sh
node adaptations/bubble/receive.mjs \
  --project /absolute/reviewed-project.json \
  --directory /absolute/original-workspace \
  --receiving-directory /absolute/independent-receiving \
  --runtime-ready /absolute/runtime-ready.json \
  --operation YOUR_STABLE_OPERATION \
  --actor YOUR_ACTUAL_OPERATOR
```

The original runtime is the maintained dlt 1.31 environment selected by runtime-ready.json. Its actual Python/Node identities and installed dependencies control compatibility; do not substitute a different interpreter and claim the same receiving.

The receiver retains every capture, mapped table, expected table, projection, review project and input-binding document with the original source writer. It preserves exact requests before dispatch, reuses their original revision guards after response loss, and adopts the saved intake journal on an independently received application. Original source IDs survive full handover.

The original compiler builds the local pipeline. The native dlt loader writes its selected local DuckDB destination. Comparison evaluates the complete declared population, then native acceptance evaluates keys, required fields, relationships and exact count/sum controls. A measured mismatch is retained in the full result; a misleading passing status is not substituted.

Optional --select-local uses the original closed-snapshot selection only when its actual native acceptance allows it. It never selects or changes a live Bubble application.

The receiver exports the entire maintained Workbench plus this adapter and every source input through the original handoff writer. It receives that archive into an independent Workspace, reopens the same source IDs and complete requests, and starts the copied original receiver against its real retained store. Keep RESULT.json, both original and received workspaces, all request journals, the complete archive and every downloaded attachment.

## 4. Offline edition and same-owner browser operation

```sh
node adaptations/bubble/build-review.mjs /absolute/bubble-review.html
```

The HTML retains the whole adapter source and the exact browser dependencies identified by their original source manifest. It creates local Blob modules from their verified full bytes. The source download contains all included files; the reference-project download is the complete clearly authored example.

The callable browser course is:

```js
receiveProviderReview({
 page, applicationUrl: 'file:///absolute/bubble-review.html',
 projectPath: '/absolute/reviewed-project.json',
 outputDirectory: '/absolute/current-owner-receiving',
 ownerCheck, actor: 'Actual operator'
})
```

Use the current owning Page and ownerCheck; no second browser controller is required. The course opens empty/invalid/valid input, saves and reopens the entire project, preserves invalid unfinished mapping text, saves an attributed following edition, exports and extracts all prepared files, reopens the extracted project, operates both complete table populations and source downloads, and captures all views at 1440 and 390 pixels.

The producing owner opens and views every final screenshot, actual outgoing HTML, source JSON, downloaded table and complete archive in its recipient-facing application. Capturing images without viewing them is insufficient. Repair observed overflow, contrast, loading/error or export problems directly in this source and regenerate the affected complete edition. The full standing owner rule is retained in AGENTS.md.

## Source and account boundaries

This public source includes only reusable code and clearly authored examples. Actual application captures, privacy-sensitive fields, credentials, case communications and customer working files stay in their authorized private original case. Work from the actual selected authorization and privacy scope.

No outreach is performed by any source file. Existing relationship and per-message owner approval directions remain with the original sender. Standard account terms and signature/confidentiality agreements follow their actual owner rules separately; the adapter does not accept contracts.

## Primary API sources

- https://manual.bubble.io/core-resources/api/the-bubble-api/the-data-api/data-api-requests
- https://manual.bubble.io/core-resources/api/the-bubble-api/the-data-api
- https://manual.bubble.io/help-guides/data/the-database/protecting-data-with-privacy-rules

See COLLECTOR.md for the exact retained request/response contract and acquisition recovery.
