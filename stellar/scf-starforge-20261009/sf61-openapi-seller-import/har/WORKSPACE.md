# Retained captures in the API merchant workspace

Open **Captured API sources** in the original API merchant workspace to retain a HAR capture, review its operations, continue with later capture editions and configure the approved source as a paid merchant API. The panel uses the original HAR store, offline reviewer, retained refresh packets and merchant package writer.

## Open the original workspace

Use the existing equipped Node 22+ source checkout and the original [workspace startup](../workspace/README.md#start). Choose an existing private output directory, then open the complete local URL printed by the launcher:

~~~sh
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/server.mjs \
  --out-parent /private/merchant-projects --port 0
~~~

The capture panel is in **Load your API description**, beside the existing OpenAPI and Postman intake. Merchant payment settings, backend transports, provider authorization, configuration review, saved projects and managed seller operations use their existing controls.

## Retain the first capture

Choose the original HAR file, enter a recognizable label and select **Retain capture**. The maximum original is 128 MiB. File bytes stream into a private temporary file before the original decoder prepares its retained workspace.

The capture remains under the launch directory's private capture library. Its identity is the full SHA-256 of the original HAR bytes. Re-uploading the same completed source reopens that capture. Labels identify the first retained intake and stay with that library entry; the original source digest identifies its bytes.

The selected source displays its original byte count, captured entries, accepted groups and rejected-entry count. The original reviewer includes the complete rejected-entry detail and source observations. Captures can contain multiple origins; the reviewed source selects one explicit API origin and its compatible operations.

## Review and retain decisions

Select **Download review page** and open the downloaded HTML file locally. It is the original self-contained offline reviewer, with the original source inventory and selected draft or saved revision. It contains request names and observed schemas. Recorded credential values and captured body values are excluded by the original renderer.

In the review page:

1. Enter the actual source origin, API title and version.
2. Select the operations to include and author their route paths and examples.
3. Resolve query fields, captured credential locations and custom header names.
4. Choose the request and response contract, including explicit authored examples where needed.
5. Acknowledge each selected route and use **Validate and preview**.
6. Download the completed reviewed decisions JSON.

Return to the console, choose that JSON file and select **Retain reviewed decisions**. Decisions are limited to 4 MiB. The original writer validates the entire selected contract and publishes the immutable review by its complete SHA-256. Saving equal reviewed decisions reuses that revision.

Select a saved review from **Saved decisions** to reopen it in the original reviewer, use its source, export its approved OpenAPI or compare a later capture. **More saved reviews** continues the list without discarding the current selection.

The HAR review allows up to 100 selected operations. The original merchant package accepts up to 64. For merchant adoption, save a review containing the exact set of at most 64 routes you intend to configure.

## Configure the merchant

Choose the saved review and select **Use approved source**. Its exact generated OpenAPI becomes the original merchant source. The console seeds reviewed public path/query/body examples and declared backend header references into the existing route editor. Large combined examples remain in the approved source when they exceed the original merchant example field's 8 KiB limit.

Set the merchant's public seller URL, payment destination, asset, network and timeout. Enter each selected route's exact atomic-unit price as text. The original engine validates the native payment and route configuration.

All approved capture routes remain part of this source selection. To change the sold route set, save another capture review containing that set and adopt that revision. The preview identifies a mismatched route selection before package creation.

Backend header references from the review keep their exact environment-variable binding in the original merchant writer. Provision those variables through the existing host setup. Provider authorization, transport profiles, response handling and managed runtime behavior use the original merchant controls.

The initial capture adoption leaves route prices empty. Reusing the same approved source keeps the current merchant settings. For a later capture, settings carry only when the current merchant source names the exact selected previous source/review, the original comparison classifies the operation as unchanged, and the approved authored decisions remain equal. Changed, new and returning operations receive fresh route settings and require a price. The console reports the retained and newly priced route counts after adoption.

Merchant settings that can carry include the existing price, public description, request example, transport, authorization and operation policies. Reviewed required header references take precedence. Transport profiles remain only when selected carried routes use them. The native compiler remains responsible for the complete resulting configuration.

Choose **Validate configuration**, inspect the existing merchant review and select **Save new package**. Capture adoption binds the exact approved source/review selection through both operations. Saving reaches the original HAR merchant writer, then the original merchant package store and compiler. The completed package opens in **Saved projects** and follows the original run, customer, operations and release workflow.

## Continue with another capture edition

Select the retained capture or refresh packet and the immutable review that defines the current contract. Choose the next original HAR file and a new label. Check **Compare with the selected saved review**, then choose **Prepare next capture edition**.

The original refresh engine retains the previous and candidate source workspaces together, plus the original comparison, migrated decisions and offline review page. The refresh identity binds the full previous source hash, previous review hash and candidate source hash.

The panel shows unchanged, changed, temporarily unobserved, returned and unselected observations. Open **Download review page** to work through the complete comparison and migrated route decisions. Changed observations require renewed acknowledgment. New fields retain their unresolved decisions until the operator handles them.

Temporarily absent routes retain their authored identity and last observed source across subsequent saved editions. Returning observations reattach to that identity and require explicit selection and acknowledgment. The original matching engine gives active exact and unique-template matches priority and leaves ambiguous matches unselected.

Save the completed candidate review, then use that source in the merchant. You can select this new packet and review as the baseline for the following edition. Keep older retained entries for their full original capture history.

For command-line operation and the retained packet format, see [Capture refresh](REFRESH.md).

## Adopt an existing original workspace

Open **Adopt an existing private HAR workspace**. Choose whether the original directory is a complete HAR capture workspace or refresh packet, enter its absolute path on the current host and supply a label.

The application opens the original directory with its native reader and copies its complete source into the capture library. An existing entry with the same identity reopens. Re-adoption also retains additional immutable original reviews that were saved after the first copy.

For a refresh packet, both previous and candidate workspaces and their saved reviews are retained. Candidate reviews with another refresh lineage remain present in the original source but cannot be selected as decisions for this packet. Select the matching original packet when continuing those decisions.

This adoption path consumes the existing HAR CLI workspaces, the completed H6 source and the retained AF825 capture-refresh outputs. It also receives private source copies from another merchant console.

## Copy to a receiving operator

Select the retained capture or packet and open **Copy to a receiving workspace**. Enter an absolute directory beneath an existing private parent on the same host. Choose a new destination for the first copy, or reuse the completed receiving directory for this same original source.

A capture copy retains its exact original HAR, inventory, manifest and every saved review. A refresh copy retains both complete workspaces, all of their saved reviews, the comparison, migrated draft and original review page. The native copy operation checks the completed receiving source before returning its destination. Repeating that destination validates the same immutable source and adds later saved reviews through the original writer. Reviews authored only at the receiving side stay present. Both previous and candidate review sets advance for a refresh packet. A directory containing another original source returns a conflict.

Open the receiving merchant console, use **Adopt an existing private HAR workspace**, select the copied directory's type and path, and choose its saved revision. That operator can then reopen decisions, continue capture editions and create a merchant package from the same reviewed source.

For another host, transfer the complete private receiving directory using the existing private transfer workflow, preserving 0700 directory and 0600 file permissions. Adopt its actual path on that host. The original capture and refresh commands also operate on that complete directory.

A refresh packet contains its immediate previous and candidate capture plus retained decision provenance. Preserve the earlier library entries as well when transferring the complete multi-edition history. The library's display labels belong to the local console; a receiving adoption supplies its own recognizable label.

The merchant package retains the approved OpenAPI source, source/review hashes, merchant plan and native compiled output. Transfer the corresponding complete capture workspace or refresh packet when the receiving operator will continue original capture editions. Reopening a saved merchant package locates its matching retained source/review in the local library when present.

## Recover an interrupted operation

A completed capture upload or refresh preparation is identified by its original source or lineage hash. Repeating it reopens the completed result. A completed decision save reuses the same immutable review. Refresh the list and select the saved result after a lost browser response.

The original source writers use private staging and create-only publication. A process interruption can leave an empty final reservation or temporary directory. Re-uploading, adopting or copying the same original completes an empty reservation by building with the original writer in a fresh private directory, checking that the reservation is still the same empty directory, and publishing the completed source. A populated directory is preserved. If another writer completes first, refresh that retained result.

The console labels an entry missing its completed display record as unfinished. Re-uploading or adopting the same completed original recovers that label as well. Keep the exact original inputs and complete receiving copies while recovering an interrupted operation. Completed entries remain usable independently.

Native merchant package publication and recovery use the existing package store. A repeated final name reopens or conflicts according to that original store's current lifecycle. Use **Saved projects** to inspect the package that actually committed.

## HTTP integration

All operations inherit the original merchant server's exact Host, Origin and workspace-token checks. The access token stays in the existing browser session and authenticated request header. Capture uploads, decision writes, review rendering, receiving copies and source adoption use the original mutation and shutdown-drain path.

| Method and path | Input | Result |
| --- | --- | --- |
| GET /api/har/library | after, limit query fields | Paged retained capture/refresh labels and source identities |
| GET /api/har/inspect | kind, id, optional revision, after, limit | Original source details, comparison summary and paged saved revisions |
| POST /api/har/upload | Original file body; label and optional previousKind, previousId, previousRevision query fields | Retained capture or refresh selection |
| POST /api/har/decisions | Original reviewed JSON bytes; kind and id query fields | Immutable native review revision |
| POST /api/har/reviewer | JSON selection | Original offline HTML attachment |
| GET /api/har/source | kind, id, revision | Exact approved OpenAPI, source binding, route seeds and eligible unchanged-route carry |
| POST /api/har/export | JSON selection | Approved OpenAPI attachment |
| POST /api/har/adopt | kind, directory, label | Native source adoption and retained immutable reviews |
| POST /api/har/copy | selection, destination | Complete native receiving source directory |
| POST /api/har/locate | specText | Matching retained source/review binding when present |
| POST /api/preview | Original specText and plan, optional capturedSource | Original merchant preview after selected source/route identity checking |
| POST /api/save | Original specText, plan and name, optional capturedSource | Original native merchant package |

A source selector is an object containing kind (capture or refresh), its full 64-character id and, for approved source operations, the full revision hash. The capturedSource binding additionally carries sourceSha256 and openApiSha256 returned by the source operation. Pass that unchanged with the exact specText into original preview/save.

Raw uploads accept the selected original JSON or octet-stream bytes without content encoding. JSON request bodies retain the original console's 10 MiB limit; only the specific capture file route accepts up to 128 MiB. Review pages are limited to 32 MiB, decisions and approved OpenAPI to 4 MiB. Capture and saved-review lists use explicit pages of 1–100 entries.

## Maintained source

The existing SF61 component already belongs to the complete maintained distribution. Its original merchant-workspace launch serves the new panel and authenticated adapter directly. The original HAR CLI remains available for prepare, inspect, review, save, export, package, copy and retained capture refresh. No additional dependency or separate seller runtime is introduced.
