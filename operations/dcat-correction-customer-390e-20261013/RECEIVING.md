# Complete GSA correction, recipient exchange and receiving course

This course continues the actual completed GSA semantic-comparison case through the catalogue correction workbench. It receives that case’s complete following archive into a separate producer project, uses the real browser to create and edit a labelled draft, restores the original catalogue bytes, retains the restored document as a candidate, and follows the original review and complete-workspace receiving flow. It then uses a second labelled draft for a complete standalone recipient proposal, concurrent author correction and explicit reconciliation before exporting and independently reopening the whole project.

The original GSA migration, snapshot, SHACL and graph-comparison operations are not repeated. Their complete saved files, decisions and source identities travel with the new workspace. The new preservation review retains the exact original current catalogue and the byte-identical restored candidate. Its validation may still say that corrections are required. That outcome is retained accurately; the course does not select a release or change a semantic decision.

## Current execution status

The source is an executable continuation, not a completed customer run. The original 344-record GSA migration/preservation/correction case has an actual retained result. The subsequent semantic comparison and this correction/browser course require their original serial receiving operation to produce the complete results they consume.

At publication, no new correction browser or native run is claimed. A source review, syntax check, HTTP check or peer review does not establish that the product has been opened and used.

Before presenting the result as client-ready, the producing operator must run the exact version, actually look at its desktop and narrow layouts, use the important controls, and open every delivered attachment as the recipient. Inspect all captured images, full catalogue documents, revision/change records, the review and candidate, both complete workspace archives, and their reopened views. Repair a visible defect in the actual product. Do not substitute screenshots that nobody has looked at, fabricated backend data, an approval checklist, or another test project for this use.

The result deliberately retains `presentation.ready: false`. Browser screenshots retain `viewedByOperator: false` until the original producing operator actually inspects them. A successful programme result means the stated native/browser actions completed; it is not a release decision or a claim of that later visual inspection.

## Source and the original case

The production correction API was merged in Merchant PR1738, commit `f2a36e19f5f3f24ae4972a0e9ae479623b3d5bd2`. The course is shipped with its following original HTTP/UI continuation. Use the complete public product checkout or installed source containing the complete course files in this directory, including `run-recipient-correction-browser.mjs` and the current production modules. Do not mix an older static browser module with a newer controller.

The first correction course was merged in PR1773 at `8a27ca55e9705abe3d1a78c14009e46a896c05a5`. The additive recipient continuation preserves its actual input/result/archive and original browser module.

The native caller reuses the original source-owned modules:

- `stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/model.mjs`
- `server.mjs`, `archive.mjs`, `capture.mjs`
- `dcat-corrections.mjs` and `public/dcat-correction-json.mjs`
- `dcat-correction-exchange.mjs`, its exact public codec and original recipient renderer/assets;
- the original migration engine, semantic workspace validators and complete exchange archive validators.

The preceding programme is:

`operations/dcat-semantic-comparison-customer-390e-20261013/run-gsa-semantic-comparison-customer.mjs`

Its completed `result.json` must have schema `commons.dcat-semantic-comparison-customer-result.v1`, operation `DCAT-SEMANTIC-COMPARISON-390E-20261013`, all three scenarios complete and every retained owner cleanup closed. This caller selects its `ordered-editions` comparison and follows `after.runId` to the exact saved current catalogue. It requires the original 344-record GSA document, including its actual first record identity. It never replaces the catalogue with a smaller fixture or uses a later live URL as though it were that saved edition.

The required transfer is the preceding result’s `followingArchive`, normally named `received-gsa-comparisons-following.ckanw`. Its SHA-256 and byte count are mandatory. This includes the recipient-local comparison acknowledgement and the complete original semantic source evidence. An optional `archiveFile` can locate the same exact bytes after transfer to another host; it cannot select a different archive.

The earlier complete GSA migration input remains:

| Original object | Identity |
|---|---|
| Complete archive | 4,429,949 bytes |
| SHA-256 | `461bd4b86f07c711ee42f942f26e50a345ee91e1f40704b60c00c387d2f09e0a` |
| Original Library file | `libfile_8bc231519a9c81918b377070c3cfd5ca` / `file_000000000bbc81f5aba6541f3585e9a1` |
| Original prefix | `native-results/` |
| Original retained case | All 21 artifacts, including full catalogues, candidates, reports and identity mappings |

That archive is provenance for the existing case. It is not sufficient input for this following course without the actual completed semantic-comparison result and its complete following workspace archive. Keep the existing serial receiving operation; do not launch another migration to manufacture a prerequisite.

## Host prerequisites

Use the original equipped receiving host and its installed Node/Playwright/browser runtime. The caller imports the explicitly selected Playwright module and passes the explicitly selected Chromium executable to the browser companion. It does not install packages, download a browser, enable GitHub Actions, or start a second receiving worker.

The one new catalogue review uses the existing GSA migration runtime:

- `runtimeProfile: "original"` selects the original Python 3.13 contract.
- `runtimeProfile: "portable-python312"` selects the existing explicit Python 3.12 portable contract with the original locked dependencies.
- `python` must name the actual absolute interpreter path for that already-prepared runtime.

Keep the existing runtime selection and dependency setup documented in the product’s `DCAT_ENGINE.md` and `PORTABLE_RUNTIME.md`. The course records Node’s actual version and hashes the selected interpreter, Chromium executable and supplied Playwright module. These are operating identities, not a new installation or dependency-resolution flow.

Historical semantic runs and comparisons are opened through the existing lazy workspace API. No semantic worker is dispatched. Their archived source and artifacts still undergo the original complete verification.

The output parent and the input configuration must be private. Choose a new output directory separate from the preceding comparison directory. The caller owns only its new `producer`, `recipient`, browser contexts, original loopback listeners and output files.

## Run one complete operation

Create a private JSON configuration. These example paths are placeholders for the actual equipped host, not claims about an existing installation:

```json
{
  "sourceRoot": "/absolute/current-product/source",
  "comparisonOutputDirectory": "/absolute/completed-gsa-comparison-course",
  "expectedComparisonResultSha256": "REPLACE_WITH_64_HEX_SHA256_OF_COMPLETE_RESULT_JSON",
  "archiveFile": "/absolute/received/received-gsa-comparisons-following.ckanw",
  "outputDirectory": "/absolute/private/correction-course",
  "python": "/absolute/original-prepared-python/bin/python",
  "runtimeProfile": "portable-python312",
  "playwrightModule": "/absolute/original-playwright/index.mjs",
  "chromiumPath": "/absolute/original-browser/chrome-headless-shell",
  "author": "The actual reviewing operator",
  "sourceCommit": "THE_ACTUAL_COMPLETE_PRODUCT_COMMIT",
  "timeoutMs": 120000
}
```

`sourceRoot` is the root containing `stellar/`, not the `ckan/` directory. `comparisonOutputDirectory/result.json` is read directly and checked against the expected hash. `archiveFile` can be omitted when the exact original path in `followingArchive.file` remains valid.

Use the existing Node runtime:

```sh
node /absolute/current-product/source/operations/dcat-correction-customer-390e-20261013/run-correction-customer.mjs --input /absolute/private/correction-course-input.json
```

Keep this invocation within the original serial receiving operation. It has one foreground lifetime. Do not simultaneously open either course-owned workspace through another application, CLI or server.

The CLI prints only a compact result with `complete`, correction/review IDs, result-file path and errors. The bearer URL stays in memory between the original listener and browser. It is not saved into the selection, progress, screenshots metadata, stdout or a public source artifact.

Exit code 0 means the complete programme reached its stated checks and closed its owned resources. Exit code 2 means the retained result is incomplete. An exception before programme admission identifies invalid/missing input or a changed selection; it is not proof that a browser or native operation started.

## What the course actually does

### 1. Receive and bind the existing case

The caller verifies the complete predecessor result and the exact following archive, then calls the original `receiveCkanWorkspaceArchive` into its private producer. It opens that project through `openCkanWorkbench`, verifies the exact saved comparison and current semantic run, and resolves the retained catalogue through the original catalogue download API.

It saves the complete prior DCAT state before changing anything. The original predecessor workspace and result are not opened for mutation.

### 2. Use the real correction interface

The caller starts `startCkanServer` with an available loopback port, then invokes `runDcatCorrectionBrowser` against that authenticated listener. The browser uses the current product UI and real HTTP responses.

The separately labelled draft exercises:

- complete catalogue paging and record search;
- title, boolean and distribution inspection;
- an ordered change set with a title replacement, boolean replacement, exact numeric exercise value and record move;
- changing the queued operation order and removing an unsaved operation;
- the complete preview and ordered-change download;
- an attributed saved revision;
- selecting the original revision and restoring its complete bytes as a new historical revision;
- retaining that restored revision as an original catalogue candidate;
- the original source/candidate selection controls, with preceding comparison empty and normalization disabled;
- every saved document and revision/change-record download;
- desktop and 390-pixel layouts, plus browser reload.

The exercise preserves `900719925474099312345` and `1.2300000000000000001` as original JSON number tokens. Neither browser transport nor native verification rewrites those values through floating-point JSON. The exercise field is confined to the intermediate draft. The restored/materialized catalogue must be byte-identical to the original source.

### 3. Verify the retained changes and prepare the existing review

The native caller rehashes every browser download and screenshot, reads all three complete revision records/documents through the original API, and runs the production correction-file validator. It checks the source, edited and restored revision chain, the materialization’s exact catalogue/revision binding, attribution and exact number tokens.

It then prepares one ordinary migration review with:

- source: the original current catalogue;
- candidate: the separately retained restored catalogue;
- `normalizeV3: false`;
- no preceding catalogue comparison and no substituted identity decisions.

The review’s original source/candidate counts must remain 344 and candidate bytes must match the restored source. Both `READY` and `NEEDS_CORRECTION` are retained valid programme outcomes when the original complete report exists. The course never equates a saved correction, successful command, technical conservation or semantic conformance with release acceptance.

The complete raw report and candidate are downloaded. The existing original catalogue, release history, acquisition history, semantic profiles/runs/findings, comparison history and decisions must equal the pre-course state after removing only this course’s draft, materialized catalogue and new review.

### 4. Complete the recipient exchange, export and independently receive

The caller asks the original owner to export the complete workspace into `complete-gsa-corrections.ckanw`. The original exporter checks all saved correction history and the existing semantic source/artifacts.

It closes and drains the producer listener before closing the workspace owner. The exact archive is then received into the separate recipient through the original receiver. The complete DCAT state must match the sender, including historical revision metadata, all earlier semantic/comparison records and every original decision.

The recipient verifies and downloads the complete documents, revision records and review again. It closes the owner and cold-opens the project before any recipient browser inspection.

### 5. Open the received project and export its following archive

`inspectDcatCorrectionBrowser` opens the actual cold-reopened listener. It selects the received draft, views and downloads every revision, repeats catalogue browsing and desktop/narrow layout inspection, and makes no correction, review or release mutation.

The native caller compares the complete state before and after that browser use. It exports `received-gsa-corrections-following.ckanw`, closes the recipient, and reopens the course producer to verify that receiving did not change its state.

The following archive is the portable customer continuation. Preserve both archives, both browser output directories and the complete result/progress files in the original delivered operation.

## Complete recipient proposal and author reconciliation

The same invocation now continues through a second, separately labelled correction draft on the original current 344-record catalogue. It keeps the first course’s three revisions, restored candidate and preservation review intact. This second draft exercises the real issued-package and recipient-return product without materializing its exercise fields or selecting a release.

The native caller starts no additional workspace server for the recipient document. It supplies its existing authenticated producer listener to `runDcatRecipientCorrectionBrowser`. That module opens one owned Chromium process with an ephemeral author context and a separate persistent offline context. Authentication stays in the ephemeral context; its bearer navigation is never stored in the persistent profile. The actual downloaded standalone HTML opens through its local file URL in the offline context. It imports the product’s unchanged exact-text exchange codec to verify complete downloaded proposals. No RDF or migration engine is dispatched for this round trip.

### Issue the original catalogue

The author creates a second correction draft and selects its original source revision. Through the actual author controls, the browser issues that exact revision with the issuing editor, intended recipient, package label and purpose.

The programme retains the complete recipient HTML, initial proposal JSON, issued source package and every original enclosed file. Each descriptor binds its complete bytes and SHA-256. The issue’s catalogue hash must equal the original selected GSA source, and its selected history contains the actual original source revision. The original package is never reconstructed from table previews.

The authenticated workbench is checked through its original `/api/launch` response and saved catalogue selection. The output retains the instance/PID/project identity and origin, without the bearer URL or token.

### Edit the standalone recipient package

The actual standalone document is opened as a local file. HTTP and HTTPS requests from that recipient page are blocked and treated as an incomplete course; its source, editor, history and downloads are embedded in the exported file.

The recipient saves one attributed edition containing three exact operations:

| Path | Recipient’s saved change |
|---|---|
| `/dataset/0/title` | A clearly labelled proposed title edit |
| `/dataset/0/dataQuality` | The exact boolean literal `false` |
| `/_recipientExercise` | An explicitly labelled exercise object containing `900719925474099312345` and `1.2300000000000000001` with those exact numeric spellings |

The programme queues these changes through the real controls, downloads their full preview and resulting document, and saves the attributed edition. It browses and pages the complete dataset, searches the original first identifier, downloads every embedded file, and captures the standalone interface at desktop and 390-pixel widths. Page overflow, script errors or a missing complete download makes the course incomplete.

After saving, the recipient starts unfinished work deliberately: one queued `/_notAdopted` addition and an incomplete editor literal `{"unfinished":`. The full returned HTML retains the saved edition, queued operation, draft attribution and unfinished literal separately. The programme verifies the entire returned payload using the original codec and reopens the actual exported HTML. Its saved edition and unfinished input must remain present.

The unfinished operation is not previewed or adopted as a saved edition. It remains available in the retained complete return for the recipient’s next action.

### Preserve a concurrent author edit

After issuing the original and receiving the recipient’s saved work, the author changes the same first-record title in the original author application and saves that local revision. This creates one deliberate conflict between the issued title, current author title and returned saved title.

The browser uploads the exact complete returned HTML through the author’s original receive control. The request binds its full SHA-256, and the original domain retains the entire file, including unfinished work. The course does not substitute a newly serialized proposal or strip the local draft from the returned payload.

The browser explicitly selects the saved recipient edition for reconciliation. Before a choice is made, the author’s save control must remain disabled and the complete unresolved comparison is downloaded. The browser then selects the returned value for `/dataset/0/title`, downloads the complete resolved comparison and choices, and verifies that the unfinished `/_notAdopted` path is absent.

The actual author adoption binds:

- the exact current author revision and document SHA-256;
- the original issued package and baseline;
- the complete received file and selected recipient edition;
- the explicit title choice;
- the complete reconciliation hash, independently of display paging;
- the adopting author, reason and stable request UUID.

The original correction writer saves the adopted revision and the original exchange writer retains its full decision. A saved revision without that decision is a partial operation; the programme preserves and retries the same request rather than inventing a replacement revision.

### Verify the complete adopted history

The second correction draft has exactly three retained revisions: original source, concurrent author edit and adopted reconciliation. It has no materialization. The original first draft still has its original three source/edit/restore revisions, materialized restored candidate and separate preservation review.

The native caller verifies the second draft’s complete documents and revision records, all original issued members, exact returned HTML, original issue/initial proposal/recipient HTML and complete adoption decision. The adopted document must equal the selected saved recipient document byte for byte. Both exact numeric tokens must be present; neither unfinished field may have entered the adopted catalogue.

The comparison’s decision must identify the original concurrent revision, saved recipient edition, returned file hash and explicit title choice. Complete native exchange validation runs before the whole workspace is exported. No record count, summary or browser screenshot replaces these original bytes.

### Receive and reopen the full exchange

The existing sender archive now includes both drafts, complete issues and returns, recipient history and unfinished work, author decisions, the original restored candidate/review and all preceding semantic/comparison evidence. The existing receiver opens that exact archive in its separate recipient directory.

After verifying complete state equality and all retained exchange files, the native caller closes the recipient owner and cold-opens it. The original correction inspection still visits the first draft. The additive `inspectDcatRecipientCorrectionBrowser` then selects the second draft, opens its issue/return/adoption history, downloads every original file and all three revision documents/records, and captures desktop/narrow author views without a mutation.

The complete DCAT state must be unchanged by both inspection passes. The existing `followingArchive` remains the full independently received continuation; it now includes the complete recipient-exchange history too. No new archive format or second receiver is introduced.

### Recipient browser continuation and recovery

The recipient module owns `browser-exchange/browser-profile/`, its persistent local browser state, content-hashed downloads and a separate `progress.json`. Keep that private directory together with its exact source selection. It is part of this operation’s continuation, not a public browser profile.

Network mutations are intercepted only for this course’s actual create, save, issue, receive and apply calls. Before allowing the request to leave, the programme saves the complete body, stable UUID and request SHA. For a return upload, it also preserves the exact uploaded bytes. A resumed receive uses those retained bytes and that same hash, even if a browser download has since produced another working copy.

The standalone application’s own local backup preserves its complete saved and unfinished state. The course also commits a complete JSON checkpoint and then matching working HTML after each queued change and after the saved edition. On restart, an already selected complete return is opened first; otherwise the retained working HTML is opened and the actual product file input restores the complete JSON if its HTML export was interrupted. An existing saved edition takes precedence over a differing local backup, which is downloaded intact before selecting the file. The original same-proposal backup can recover newer work when no portable saved edition exists. The course checks the exact queued prefix and does not append a second saved edition. Once the complete return has been selected for receiving, its retained original file remains authoritative.

The native caller resumes an existing exchange browser journal before excluding only its exact completed draft/issue/proposal/decision IDs from the original-history comparison. It never removes unrelated rows or infers ownership from a similar title. Both the original first-draft recovery and the additive exchange recovery use the original saved request identities.

An abrupt host loss before an unsaved in-memory edit reaches either local backup or a complete file is not reported as a saved recipient edition. Preserve the actual available checkpoint and original progress. A changed source selection, changed retained bytes, unexpected edition, unresolved operation or unavailable original result stops the course explicitly.

### Additive output and browser ABI

The same native `result.json` adds:

| Field/output | Complete retained meaning |
|---|---|
| `exchange` | Actual producer recipient-course result, request identities, returned file, original IDs, downloads and images |
| `exchangeDetails` | Native verified second draft, complete issue/proposal/decision, original member copies and all revision files |
| `reopenedExchange` | Read-only browser result from the independently received, cold-opened workspace |
| `browser-exchange/` | Original network intent journal, owned persistent browser profile, every standalone/author download and desktop/narrow capture |
| `browser-received-exchange/` | Independent author-view inspection, complete file downloads and desktop/narrow captures |
| `downloads/producer-exchange/` | Complete original issue/return/member/decision and revision bytes verified by the native caller |
| `downloads/recipient-exchange/` and `downloads/cold-reopened-exchange/` | The same complete original bytes verified after independent receiving and cold reopening |

The public callable boundary is:

```js
runDcatRecipientCorrectionBrowser({
  playwright,
  listener: { url, origin },
  outputDirectory,
  catalog: { id, sha256, bytes },
  baselineDocumentPath,
  author,
  exchangeCodec, // the actual product public/dcat-correction-exchange.mjs module
  signal,
  timeoutMs,
  executablePath
})

inspectDcatRecipientCorrectionBrowser({
  playwright,
  listener: { url, origin },
  outputDirectory,
  catalog: { id, sha256, bytes },
  author,
  exchangeCodec,
  signal,
  timeoutMs,
  executablePath,
  selection: {
    correctionId, exchangeId, proposalId, editionId,
    decisionId, authorRevisionId, adoptedRevisionId
  }
})
```

The native caller imports the codec from the same actual source root as the model/server/archive. The browser does not install dependencies. The caller retains listener/workspace ownership; the companion closes its own ephemeral author context and persistent offline context, then drains their Chromium process.

All images still have `viewedByOperator: false` until the producing operator actually looks at them. The source shipment is not a claim that this standalone package, all its attachments or either application view has already been used on the equipped host. The same original serial receiving operation remains responsible for that actual run and observed delivery.

## Complete output and interpretation

| Output | Meaning |
|---|---|
| `selection.json` | Immutable exact input result/archive, host paths, current run/comparison selection and original runtime choices |
| `original-comparison-result.json` | Exact original complete predecessor result bytes |
| `actual-source.json` | Full hashes/byte counts of the actual product modules and all three course modules used |
| `actual-runtime.json` | Actual Node version and selected executable/module identities |
| `progress.json` | Native review/archive intents, original returned IDs and reconciled complete results |
| `producer-before-corrections.json` | Complete received baseline before this course’s draft |
| `producer-before-transfer.json` | Complete DCAT state after the original correction/review and second recipient-exchange draft |
| `browser-producer/` | Exact browser selection, request journal, result, every download and desktop/narrow image |
| `browser-recipient/` | Independent cold-recipient browser result, downloads and images |
| `downloads/` | Complete original catalogue, both drafts’ revision documents/records, original report/candidate and complete issued/returned/decision/member copies |
| `operation-<UUID>.json` | Actual retained native operation outcomes |
| `complete-gsa-corrections.ckanw` | Complete sender workspace after both correction drafts, original review and complete recipient reconciliation |
| `received-gsa-corrections-following.ckanw` | Complete independently received and cold-reopened following workspace |
| `result.json` | Whole programme outcome, bindings, actual IDs, files, errors, cleanup and presentation qualification |

`result.browser` and `result.reopenedBrowser` are the complete browser results. `result.correction` binds the three revisions and materialization; `result.review` retains the actual status, intrinsic review hash, complete-report hash and candidate hash. The candidate hash and report hash are different identities.

All attachment descriptors retain their full path, bytes and SHA-256. No inventory substitutes for the original complete file. The output directory is private because it includes complete customer/catalogue documents and operating paths.

## Interruption and same-operation continuation

The input selection is immutable. Re-run the same configuration in the same owned output directory only after the original process and both project owners have actually ended. The existing receiver recognizes the same archive/destination. Source and download copies accept only an identical retained prefix; changed bytes stop the operation.

The browser writes the complete request, action and stable UUID to its progress journal before allowing the actual POST to leave. On continuation, it resolves that exact saved request or retries the identical request through the original idempotent correction API. It does not generate replacement draft/revision/materialization UUIDs or silently discard a failed browser result.

Native review and archive operations have their full intent saved before launch and the original returned selection saved immediately afterward. A lost reply is recoverable only from the original operation’s authoritative returned ID and matching saved result. If that identity cannot be proved, the caller stops with `CORRECTION_CUSTOMER_ADMISSION_UNCERTAIN`; it does not create a second review/archive or guess that an earlier call was absent.

A saved failed/interrupted migration review remains a real attempted operation. It is not silently retried with another UUID. Inspect its full original result and let the existing operation owner choose any explicit following action. Preserve the prior input, progress and outcome.

SIGINT/SIGTERM cancels the currently owned operation or browser and waits for the original lifetime to settle. Browser cleanup precedes listener/workspace cleanup. The caller closes only its own resources. Cleanup failure makes the result incomplete and retains the failure.

The private server URL contains a bearer fragment. Keep it in-process; do not paste it into a public issue, guide, screenshot annotation or source packet. Failed/result messages are redacted for loopback bearer fragments. Reopening uses a fresh original listener rather than preserving a stale token.

## Callable browser boundary

The native export is `runDcatCorrectionCustomer(options)`. It can accept an already imported `playwright` object in addition to the explicit module form; the result marks that supplied-runtime route.

The browser exports are:

```js
runDcatCorrectionBrowser({
  playwright,
  listener: { url, origin },
  outputDirectory,
  catalog: { id, sha256, bytes },
  baselineDocumentPath,
  author,
  signal,
  timeoutMs,
  executablePath
})

inspectDcatCorrectionBrowser({
  playwright,
  listener: { url, origin },
  outputDirectory,
  catalog: { id, sha256, bytes },
  correctionId,
  author,
  signal,
  timeoutMs,
  executablePath
})
```

The caller owns the original server and workspace; the companion owns and closes its browser. The full browser returns its real `correctionId`, `initialRevisionId`, `editedRevisionId`, `restoredRevisionId`, complete `materialization`, `downloads`, `screenshots`, `observations`, `pageErrors`, `errors`, `cleanup` and `complete`. The inspect export returns the retained same correction/materialization without changing the project.

## Related original product instructions

- [Correction workbench](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/CORRECTION_WORKBENCH.md)
- [Correction CLI and agent guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/CORRECTIONS_AGENT.md)
- [Recipient exchange workflow](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/CORRECTION_EXCHANGES.md)
- [Recipient CLI and agent continuation](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/CORRECTION_EXCHANGES_AGENT.md)
- [Original migration operating guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/MIGRATION_OPERATING.md)
- [Semantic catalogue workflow](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/SEMANTIC_CATALOGS.md)
- [Preceding comparison operation](../dcat-semantic-comparison-customer-390e-20261013/)

Use the original public product and serial receiving handoff. Keep grant/customer reporting explicit about what was executed, what was source-reviewed and what still awaits the actual equipped worker.
