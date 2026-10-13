# Contributor engagements in Grant Operations

Contributor Engagements retains the actual named people, roles, availability, commercial terms, supporting source files and agreement decisions in the original SF47 operating case. Each saved book is a complete immutable edition in the original review history. Its native handoff prepares a dated Forecast, a Portfolio allocation and a receiving record connecting those saved outputs to the same source edition.

The programme uses the existing Operations transaction, request journal, original Decimal calculation, Forecast cash model and Portfolio allocator. It does not record an invoice, observed cash movement, grant payment or agreement acceptance merely because an allocation is prepared.

## Open the complete operator

Open the maintained Grant Operations application, choose the original saved plan and operating case, enter the recording operator, then select **Contributor engagements**.

The desk has three views:

| View | Operator work |
| --- | --- |
| Agreements | Edit one complete named agreement book, retain sources and actual acceptance decisions, preview and save an immutable edition. |
| Saved editions | Reopen complete prior books, create a sourced successor, inspect original receiving history and export the whole case. |
| Portfolio and cash handoff | Select a saved book and dated Forecast, review remaining work and payment treatment, map named resources, then save the original Forecast, Portfolio and receiving join. |

Use **Sources** in the existing Operations case to attach original correspondence, agreement documents and availability records. **Attach original agreement source** opens that same source desk and retains the engagement draft. The original source reader and attachment limits apply. Exact source bytes, filenames, observation time, URL and SHA-256 remain in the complete case.

The editor uses existing contributor IDs. Create or update a contributor in the original **Contributors** section when the named person or organisation is missing. Selecting a contributor does not assert that they accepted an engagement.

## Prepare a complete agreement edition

**Open engagement draft** calls the original native seed at the selected case version. A saved book opens as an immutable edition; **Create sourced successor** retains its original review ID and SHA-256 in the new document's `supersedes` field.

Enter the edition name, source review date and required recorded edition review note. That note is passed to the original saved review as well as retained in the complete document. Add the named contributors being considered. Each current contributor occurs once in a book.

Complete each selected row:

- Role, complete scope, first availability date and final availability date.
- Seven weekday hour values, Monday through Sunday. A blank value is unstated; zero records unavailability. Dated exceptions retain their exact dates and decimal hours.
- Compensation basis: hourly, fixed, in kind or unspecified. Hourly rate and total compensation remain nullable where the source does not state them. Retain the complete payment terms, native payment treatment and note.
- Actual acceptance: proposed, confirmed, declined or withdrawn. A confirmation requires the actual decision maker and original decision time. Enter the timezone in an ISO 8601 timestamp.
- Remaining original work-package allocations. Each allocation carries a selected native cost ID, exact remaining hours, exact remaining USD amount and note.
- The original source IDs and source context for the agreement, availability, compensation and acceptance separately.

Hours permit nonnegative decimal values with up to four decimal places; remaining costs permit up to two decimal places. Keep decimal inputs as text rather than rounding them through a different calculator. The native validator checks the whole document, including rows that are not currently visible in the editor.

Use **Review complete edition** to inspect the source-bound native report. Correct the entered draft and review again when findings require a change. **Save this reviewed edition** saves the complete document against that preview SHA-256 and original case version. Earlier books remain available in **Saved editions**.

A source attachment alone does not change an agreement's decision. A saved proposed agreement remains proposed. Subsequent acceptance, withdrawal, changed availability or changed terms belongs in a sourced successor; it does not overwrite an earlier book.

## Carry a saved edition into dated cash and delivery

Choose **Portfolio and cash handoff**. Select the exact saved engagement edition and an original saved base Forecast. The book's source review date must equal the base Forecast's `asOfDate`; the agreement allocations are remaining amounts as of that date.

Enter the required recorded receiving review note. The final original receiving record retains this explicit note; the original Forecast and Portfolio keep their own entered notes.

Select the explicitly confirmed contributors to include. The native handoff rejects a proposed, declined or withdrawn selected agreement.

### Review the original remaining work

An affected package is any original cost ID allocated by the selected agreements. The handoff keeps each affected package as one native Forecast package override.

When explicit remainders are omitted, the native engine calculates the original baseline remainder less selected agreement allocations. The complete projection shows the selected allocations and the remaining original work. To choose a different reviewed remainder, enable **Enter explicit remainder for every affected package** and complete every affected cost's hours, USD amount and note.

When explicit payment treatment is omitted, the selected agreements must supply one common native treatment for the affected package. Differing agreement modes need one explicit reviewed choice. Enable the payment treatment form and complete every affected package. Original observed direct-cash links remain in the full Forecast inputs; this handoff does not create or infer a cash receipt.

The base Forecast's package links can be inspected in the desk. **Open original cash forecast** opens the maintained Forecast operator. If those links need correction, save the changed original Forecast there and select that saved edition as the new handoff base before starting the receiving workflow.

### Retain the complete Portfolio draft

Map every selected engagement to a resource identity. Existing original role/resource IDs can be reused, or select distinct new IDs for the named contributors. **Use the named contributor IDs as new resources** fills those existing contributor identities for explicit review.

An existing complete Portfolio input may be loaded from its native JSON file or from a full saved `portfolio.json` containing `inputs`. The whole calendar, resources, tasks, alternatives, notes and Installation phase arrays are retained. The browser displays the selected filename, exact byte count and SHA-256 and allows inspection of the complete draft.

The handoff updates the selected contributor's availability and assigned package hours in the base and every explicit alternative while preserving other native input fields. It keeps `installationPlans` as the original complete phase selections, including deliberately empty alternative overrides. Commercial delivery-boundary phases and later support capacity keep their original meanings.

Without an existing draft, the original native Portfolio seed supplies the full input. The engagement programme does not substitute another schedule or omit the original allocator's findings.

### Save the native receiving in order

1. **Review cash handoff** returns the complete normalized selection, source, Forecast input, native calculation and engagement projection.
2. **Save cash forecast and review allocation** retains one workflow identity, saves that original Forecast using its reviewed input and SHA-256, then opens the original Portfolio preview against the saved Forecast. It does not save the Portfolio before the operator can inspect that preview.
3. Inspect the allocation, calendar, Installation phases and complete alternatives. Correct resource mapping or the complete existing Portfolio draft if needed, then choose **Review allocation from saved Forecast**.
4. **Save allocation and finish receiving** saves the exact reviewed Portfolio through the original command, then records the validated source book → saved Forecast → saved Portfolio join through `engagement.receiving`.

The final receiving retains the actual `allocationStatus` and `readyAlternativeIds`. Exploratory alternatives can retain native findings; the programme does not require every explored alternative to be ready. Operators should use the allocator's actual result when selecting a delivery plan.

The desk shows all saved IDs and offers the original Forecast, original Portfolio and complete case download. A new handoff begins only after the retained workflow has completed.

## Resume the original browser request

Before dispatching a write, the desk retains the exact original action, input, case version, actor and request ID in its case-scoped browser session. The same retained in-memory request owner survives a view change; reopening the desk joins that operation before refreshing the case.

If a response is lost, use **Resume original request**. If the command returned a receipt but full source readback was interrupted, use **Reconcile saved receipt**. Both reopen the original request and its recorded result. They do not create another Forecast, Portfolio or agreement edition.

A partially saved handoff retains the original Forecast ID, normalized first selection, full inputs, resource/draft choice and every received original command receipt. **Resume native receiving** rejoins that stage. A changed case before an unsent preview is saved requires another native review; already accepted writes keep their original identities.

A definitive native rejection retains the entered draft for correction. The desk does not replace a pending unknown outcome with a new mutation. Browser persistence errors are shown before a new write can be sent. **Save draft JSON** retains the complete editable book and any selected handoff, original pending payload, receipt and native workflow for inspection.

The browser session contains no copied host credentials. Original source downloads and case exports use the application's existing authenticated transport.

## Original CLI

The installed command and original Python entry point open the same private workspace:

```sh
starforge grant-workspace operations --workspace /absolute/private/scf-planning engagements --case operation-EXACT_ID
python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py operations --workspace /absolute/private/scf-planning engagements --case operation-EXACT_ID
```

Use the maintained Python 3.10-or-newer Linux runtime. The original workspace owns SQLite and its process lock; close its browser server before opening a headless command on the same workspace. For a running authenticated host, use the original HTTP/agent interface instead of a second native workspace owner.

Create output directories first. The original CLI publishes private new files and does not overwrite an existing output. Read JSON commands print their complete result when `--output` is omitted.

| Command | Input and result |
| --- | --- |
| `engagements` | Lists original books and receiving summaries. |
| `engagement-seed` | `--expected-version`; optional `--review` opens a sourced successor. Returns `document`, source, contributor/package/source selections and prior edition. |
| `engagement-show` | `--review`; returns the full original saved book, native report, current source comparison and receivings. |
| `engagement-preview` | `--document` full document JSON and `--expected-version`; returns normalized document and exact preview SHA-256. |
| `engagement-prepare` | Same document, `--expected-preview-sha256`, recording actor, stable request ID and expected case version; returns the normal original command receipt. |
| `engagement-forecast` | `--selection` complete handoff selection and `--expected-version`; returns full original Forecast inputs and native preview. |
| `engagement-portfolio` | `--selection` referencing the newly saved Forecast and `--expected-version`; returns full original Portfolio inputs and native preview. |
| `engagement-receiving` | `--data` complete book/hash, saved Forecast/Portfolio IDs and both normalized selections; original actor/request/version flags. |
| `engagement-export` | `--review` and new `--output` path; exports the selected engagement report and entire original case. |

Every command above takes `--case`. Read commands support `--output`. The original write flags are `--actor`, `--request-id`, `--expected-version` and `--note`. An explicit nonempty recorded review note is required for `engagement-prepare` and `engagement-receiving`.

### Headless book and handoff sequence

Use the original case's current version at each stage and retain each exact file before sending its write.

```sh
starforge grant-workspace operations --workspace /absolute/private/scf-planning engagement-seed --case operation-EXACT_ID --expected-version CASE_VERSION --output /absolute/working/engagement-seed.json
starforge grant-workspace operations --workspace /absolute/private/scf-planning engagement-preview --case operation-EXACT_ID --expected-version CASE_VERSION --document /absolute/working/engagement-document.json --output /absolute/working/engagement-preview.json
starforge grant-workspace operations --workspace /absolute/private/scf-planning engagement-prepare --case operation-EXACT_ID --expected-version CASE_VERSION --document /absolute/working/engagement-document.json --expected-preview-sha256 PREVIEW_SHA256 --actor 'Original recording operator' --note 'Reviewed the original named agreements and their actual decisions' --request-id ORIGINAL_BOOK_REQUEST
```

The document file is the whole edited `document` from the seed, not the seed response wrapper. Save the returned review ID and its complete review SHA-256.

The Forecast selection file contains:

```json
{
  "reviewId": "review-ORIGINAL_ID",
  "reviewSha256": "ORIGINAL_REVIEW_SHA256",
  "forecastId": "forecast-ORIGINAL_BASE_ID",
  "agreementIds": ["engagement-ORIGINAL_ID"],
  "name": "Reviewed contributor cash forecast",
  "note": "Original operator's handoff note"
}
```

Optional `remainders` and `paymentModes` are complete arrays covering every affected original package. Remainders carry `costId`, `remainingHours`, `remainingCostUsd` and `note`. Payment choices carry `costId`, `paymentMode` and `note`. Omitting an array requests the original complete derived defaults.

```sh
starforge grant-workspace operations --workspace /absolute/private/scf-planning engagement-forecast --case operation-EXACT_ID --expected-version NEXT_CASE_VERSION --selection /absolute/working/engagement-forecast-selection.json --output /absolute/working/engagement-forecast-preview.json
starforge grant-workspace operations --workspace /absolute/private/scf-planning forecast-save --case operation-EXACT_ID --expected-version NEXT_CASE_VERSION --inputs /absolute/working/forecast-inputs.json --expected-preview-sha256 NATIVE_FORECAST_PREVIEW_SHA256 --actor 'Original recording operator' --request-id ORIGINAL_FORECAST_REQUEST
```

Here `forecast-inputs.json` is the exact returned `inputs`; the expected SHA is returned at `forecast.previewSha256`. Retain the returned normalized `selection` in full for the final receiving. The original saved Forecast increments the case version.

The Portfolio selection uses that newly saved Forecast:

```json
{
  "reviewId": "review-ORIGINAL_ID",
  "reviewSha256": "ORIGINAL_REVIEW_SHA256",
  "forecastId": "forecast-NEW_SAVED_ID",
  "agreementIds": ["engagement-ORIGINAL_ID"],
  "resourceMap": [
    {"engagementId": "engagement-ORIGINAL_ID", "resourceId": "original-resource-id"}
  ],
  "name": "Reviewed contributor delivery allocation",
  "note": "Original operator's allocation note"
}
```

When retaining an existing Portfolio, add `inputs` with its whole original draft. Do not copy only the resource/task rows or discard alternatives and phase selections.

```sh
starforge grant-workspace operations --workspace /absolute/private/scf-planning engagement-portfolio --case operation-EXACT_ID --expected-version CURRENT_CASE_VERSION --selection /absolute/working/engagement-portfolio-selection.json --output /absolute/working/engagement-portfolio-preview.json
starforge grant-workspace operations --workspace /absolute/private/scf-planning portfolio-save --case operation-EXACT_ID --expected-version CURRENT_CASE_VERSION --inputs /absolute/working/portfolio-inputs.json --expected-preview-sha256 NATIVE_PORTFOLIO_PREVIEW_SHA256 --actor 'Original recording operator' --request-id ORIGINAL_PORTFOLIO_REQUEST
```

`portfolio-inputs.json` is the exact returned `inputs`; the expected SHA is `portfolio.previewSha256`. Review the native findings before saving. Retain this second complete normalized selection.

Finally, `engagement-receiving.json` contains the original `reviewId`, `reviewSha256`, newly saved `forecastId` and `portfolioId`, complete `forecastSelection` and complete `portfolioSelection`.

```sh
starforge grant-workspace operations --workspace /absolute/private/scf-planning engagement-receiving --case operation-EXACT_ID --expected-version FINAL_CASE_VERSION --data /absolute/working/engagement-receiving.json --actor 'Original recording operator' --note 'Received this original agreement edition into the saved cash and delivery plan' --request-id ORIGINAL_RECEIVING_REQUEST
starforge grant-workspace operations --workspace /absolute/private/scf-planning engagement-show --case operation-EXACT_ID --review review-ORIGINAL_ID --output /absolute/working/engagement-saved.json
starforge grant-workspace operations --workspace /absolute/private/scf-planning engagement-export --case operation-EXACT_ID --review review-ORIGINAL_ID --output /absolute/working/engagement-case.zip
```

These illustrative placeholders must be replaced by the exact selected original values; they do not create contributor commitments. A command whose outcome is unknown is resumed with the same file bytes, action, version, actor and request ID. Read back its original receipt/history before creating another command.

## Authenticated HTTP and original engine methods

All routes use the existing authenticated `/api/operations/{case}` transport.

| Route | Native operation |
| --- | --- |
| `GET engagements` | `Operations.list_engagements(case)` |
| `GET engagements/{review}` | `Operations.engagement(case, review)` |
| `GET engagements/{review}/export.zip` | `Operations.export_engagement(case, review)` |
| `POST engagement-seed` | `seed_engagement(case, {expectedVersion, reviewId?})` |
| `POST engagement-preview` | `preview_engagement(case, {expectedVersion, document})` |
| `POST engagement-forecast` | `preview_engagement_forecast(case, {expectedVersion, selection})` |
| `POST engagement-portfolio` | `preview_engagement_portfolio(case, {expectedVersion, selection})` |
| `POST command` | Original `engagement.prepare`, `forecast.save`, `portfolio.save` and `engagement.receiving` actions. |

The command envelope remains `{expectedVersion, actor, requestId, note, action, data}`. Normalized preview selections are retained verbatim for receiving. The native source, preview SHA-256, original journal replay and case compare-and-save remain authoritative.

## Complete source and receiving

The maintained source adds `operations_engagements.py`, `engagement_handover.py`, `operations_engagements.mjs`, `operations_engagements.css` and this guide. The original Operations, HTTP, CLI and browser host are extended additively. Both existing managed source selectors retain the same complete file list, including current Budget Performance and Installation phase modules.

The full case export retains the selected engagement HTML/report and document, every original source attachment, original plan revisions, Operations records and event/request history, immutable Forecasts and Portfolios, earlier books and the receiving review. Receive it through the existing `operations import` command into an operator-selected private workspace, then reopen the original case and selected review. The original importer validates and owns that receive; no engagement-only database or reconstructed journal is used.

ACTUAL receiving consumes supplied real agreement/source selections and their original acceptance states. WALKTHROUGH receiving uses the original labeled walkthrough case and clearly identified fictional example people and source records. Results from a walkthrough do not assert that the real grant team has made those commitments.

## Typed client and Merchant MCP

The typed client and Merchant tools use this same Contributor Engagements product. They read the original case, prepare the same immutable review, and hand its selected agreements to the existing Forecast and Portfolio engines. All exact input JSON, native response bytes, saved requests, source references and complete exports remain on the original implementations.

The adjacent `agent-client.d.mts` exports the complete document, agreement, availability, compensation, acceptance, allocation, seed, preview, edition, handover-selection and receiving types. Monetary amounts and hours are decimal strings. Hours and hourly USD rates support the native four decimal places; USD totals and remaining package costs use two. The contributor ID is the actual retained case ID, including valid IDs in imported histories. It is not replaced with a newly generated identity.

### Bind the original application

Use the installed original Grant workspace source, scenario and Python selection. Read the current binding with `inspectGrantAgentBinding({directory, scenarioFile, pythonExecutable, allowStart, label})`, construct `GrantWorkspaceClient`, and call `open({expectedSelectionSha256})`. A borrowed Applications service retains its original lifetime. A client allowed to start the service uses the original managed launcher and writer lock.

```ts
import { inspectGrantAgentBinding, GrantWorkspaceClient } from './agent-client.mjs';
import type {
  GrantBindingInput,
  GrantEngagementDocument,
  GrantEngagementForecastSelection,
  GrantEngagementPortfolioSelection
} from './agent-client.mjs';

const binding = await inspectGrantAgentBinding(selectedHost as GrantBindingInput);
const client = new GrantWorkspaceClient(binding);
try {
  await client.open({ expectedSelectionSha256: binding.selectionSha256 });
  const current = await client.read('case', { caseId });
  const seed = await client.engagementSeed(caseId, current.value.program.version);
  // Retain the complete seed. Actual operator selections supply the edited
  // document, evidence and accepted agreement details before native preview.
  const document: GrantEngagementDocument = reviewedDocument;
  const preview = await client.engagementPreview(
    caseId, current.value.program.version, document
  );
  await retainOriginalResponse(preview);
} finally {
  await client.close();
}
```

Here `selectedHost`, `caseId`, `reviewedDocument` and `retainOriginalResponse` come from the calling application's existing retained selection and output writer. They are not embedded example people or a second request store. Source authors can use the complete native receiving course shipped with this product for the actual retained workflow. Its ACTUAL mode consumes supplied original case data; its labeled WALKTHROUGH creates example commitments only in its separate native walkthrough case.

### Complete direct interface

| Client method | Original result |
| --- | --- |
| `read('engagements', {caseId})` | All saved engagement summaries and their receiving summaries. |
| `read('engagement', {caseId, reviewId})` | Complete original review, document, source, report, current source comparison and associated receiving records. |
| `engagementSeed(caseId, expectedVersion, reviewId?)` | Full editable document plus original contributors, packages and source records; optional superseding edition. |
| `engagementPreview(caseId, expectedVersion, document)` | Native agreement normalization, source validation and findings, with the exact preview SHA. |
| `engagementPrepare(caseId, body)` | Original `engagement.prepare` receipt and immutable review ID/SHA. |
| `engagementForecast(caseId, expectedVersion, selection)` | Complete normalized selection and original Forecast inputs, preview, projection and source. |
| `engagementPortfolio(caseId, expectedVersion, selection)` | Complete normalized selection and original Portfolio inputs, allocator preview, projection and source. |
| `engagementReceiving(caseId, body)` | Original `engagement.receiving` receipt binding the saved review, Forecast and Portfolio. |
| `download('engagement', {caseId, reviewId})` | Full original case ZIP with the selected engagement review and its source handover. |

The two engagement writes require `expectedVersion`, `requestId`, `actor` and a **nonempty recorded `note`**. Prepare additionally takes `document` and `expectedPreviewSha256`. Receiving additionally takes the exact `reviewId`, `reviewSha256`, saved `forecastId`, saved `portfolioId` and both complete normalized selections.

Use the whole native review SHA returned by the prepared receipt or saved review. The document, business-source and preview hashes identify different original objects and cannot substitute for that SHA.

### Follow one native handover

Save each reviewed request with its exact original body before dispatch. Retain the response before advancing to the next step. Each later normal write uses the case version returned by the preceding write; an uncertain request retains its earlier reviewed version and input unchanged.

1. Read the actual case and attach any new evidence through the original source attachment operation. Re-read the resulting case version, seed the book, and retain the entire edited document. Proposed and confirmed agreements remain distinct. Confirmation records the actual accepting person, timestamp and evidence.
2. Preview that document at the selected case version. Save it through `engagementPrepare` using the native preview SHA and the original nonempty note/request. Retain the resulting immutable review ID and whole-review SHA.
3. Build the Forecast selection from that exact review, one saved base Forecast and selected CONFIRMED agreement IDs. The book's `asOfDate` must equal the base Forecast's date. When supplied, `remainders` and `paymentModes` each cover every affected cost package; omission asks the original engine for its complete derived defaults. Review remaining costs/hours and all timing choices, including any explicitly resolved differing agreement modes.
4. Call `engagementForecast`. Retain its full normalized `selection` and complete `inputs`. Save those inputs with original `forecastSave`, using `forecast.previewSha256` from that response and the original Forecast note/request. This creates the new saved Forecast used below.
5. Build the Portfolio selection using that newly saved Forecast, the same selected agreements and a complete `resourceMap`. Each selected contributor is mapped once. If a draft exists, pass its complete `inputs`, including all base fields, explicit alternatives, Installation editions and phase plans.
6. Call `engagementPortfolio`. Inspect the original allocator findings and every alternative. Save its complete returned `inputs` through original `portfolioSave`, using `portfolio.previewSha256` and the original Portfolio note/request. Incomplete exploratory alternatives retain their actual findings; no blanket all-alternatives-ready condition is introduced.
7. Call `engagementReceiving` with the exact book SHA, both saved record IDs and both retained normalized selections. Keep its nonempty receiving note and original request identity. This freezes the validated whole join in the existing case.
8. Reopen the book, saved Forecast, saved Portfolio and receiving summaries. Download the full selected-book ZIP, verify its exact native byte count/SHA, receive that complete case through the original importer, and reopen its retained source, review and financial/allocation history.

The full normalized selections are returned by the native preview calls. In particular, receiving uses `forecastSelection: forecastHandover.value.selection` and `portfolioSelection: portfolioHandover.value.selection`. The nested Portfolio draft belongs inside its selection and is preserved whole. Do not assemble a reduced alternative, silently change payment timing or derive new native fields from a presentation summary.

### Merchant tools and full input references

Configure the original `grantWorkspaces` host binding through the existing Merchant setup. `merchant_grant_workspaces`, `merchant_grant_open`, `merchant_grant_inspect` and `merchant_grant_browser` retain their current behavior. The binding selects the original complete application and its source SHA; no tool accepts an arbitrary server URL, Python source path or access token from model arguments.

Every new tool takes the configured `workspace` alias and original `caseId`:

| Tool | Additional fields / complete input |
| --- | --- |
| `merchant_grant_engagements` | None; reads edition and receiving history. |
| `merchant_grant_engagement` | `reviewId`. |
| `merchant_grant_engagement_seed` | `expectedVersion`; optional `reviewId` for a superseding seed. |
| `merchant_grant_engagement_preview` | `expectedVersion`; `inputs` is the whole native document. |
| `merchant_grant_engagement_prepare` | Same document plus `expectedVersion`, `requestId`, `actor`, nonempty `note`, `expectedPreviewSha256`. |
| `merchant_grant_engagement_forecast` | `expectedVersion`; `inputs` is the whole Forecast handover selection. |
| `merchant_grant_engagement_portfolio` | `expectedVersion`; `inputs` is the whole Portfolio handover selection, including optional full draft. |
| `merchant_grant_engagement_receiving` | `expectedVersion`, `requestId`, `actor`, nonempty `note`; `inputs` is exactly the six-field native receiving data object. |

The six receiving data fields are `reviewId`, `reviewSha256`, `forecastId`, `portfolioId`, `forecastSelection` and `portfolioSelection`. Command identity is supplied separately and cannot be overridden by keys inside that input object.

For each tool using `inputs`, choose exactly one original input route:

- Inline: `inputs: <complete native object>`.
- Verified retained input: `input: {hostInput: alias}`, `{snapshotId: id}` or `{transferId: id}`, with optional original `sourceWorkspace` and required `expectedInputSha256`. Optional `inputPointer` selects a native object within the verified complete file.

The original helper verifies the **whole input file** before selecting its JSON pointer. A seed snapshot uses `inputPointer: "/document"` for the editable book; an engagement handover snapshot uses `"/inputs"` for the original Forecast or Portfolio save. Select `"/selection"` when inspecting the complete normalized handover choice. Inline input has neither an input digest nor a pointer. Edited inputs must be retained as a new complete reviewed input; a previous snapshot's digest cannot authenticate changed bytes.

The existing `merchant_grant_forecast_save` and `merchant_grant_portfolio_save` remain the only writers of those records. The existing `merchant_grant_source_attach`, case commands, Work/Invoice actions, Installation operations, currency inputs and delivery queue remain unchanged.

### Inspect and receive every original byte

Tool results use the existing immutable snapshot metadata, bounded presentation and `fileRead` descriptor. An output preview is not the full document. `merchant_grant_snapshot` selects a retained JSON pointer; `merchant_grant_rows` walks complete arrays using its returned next offset; `merchant_grant_file_read` returns exact original byte chunks under one snapshot/SHA and reader ID. Release that reader through `merchant_grant_file_release` after the final chunk or interruption.

For the whole engagement handover, call existing `merchant_grant_export` with `kind: "engagement"`, `caseId` and `reviewId`. Receive its exact retained bytes with the existing file reader. Preserve this snapshot for an interrupted transfer. A newly requested case export after later mutations may represent a different whole case; it must not silently replace the earlier frozen transfer.

The complete ZIP follows the original `merchant_grant_receive_begin`, `receive_chunk`, `receive_status` and `receive_commit` protocol at the receiving workspace. The committed verified transfer then feeds original `merchant_grant_case_import`. The receiving case retains its original imported provenance and immutable edition history. Reopen its actual local IDs and source comparison rather than inventing a second engagement document.

### Recover the original request and close the original owner

The client makes no automatic business-write retry. Keep a prepared request's ID, expected version, actor, note, document/selection and preview hash together. If a native reply is uncertain, reconcile original case/history and replay only that exact request to obtain its original saved result. A definite concurrent-version rejection needs an explicit new review of current state; never change the old request's input while keeping its ID.

Merchant snapshot retention happens after the native response. If local output storage fails after a native success, the tool reports that known original status and a retention failure. Restore its output storage and reenter the same original request to retain its existing result; do not treat the failed local snapshot as evidence that the business write did not commit.

The existing host/client ownership, pending-request drain, file-reader release and native server close remain authoritative. Preserve all complete textual/native results and source after the consumers close. Source-only code and selected operation inputs can travel with the package; original private access configuration and actual correspondence remain in the original authorized custody.


### Client and provider shutdown

`detach(expectedInstanceId?)` stops new client requests before it waits for already accepted operations. It coalesces concurrent detach/close calls, reads the final retained connection after those operations drain, and stops only its own original launcher. Borrowed application processes remain owned by their original host. After successful detach, an explicit `open()` can reconnect the same client. A failed detach keeps admission stopped and preserves the same child/connection for another detach attempt. Permanent `close()` keeps admission stopped and can be called again after a failed close; it does not create a replacement launcher.

The original launch process remains owned through its `close` event and complete stdout/stderr closure, including late output errors. Its result retains the first output/launcher error and a bounded diagnostic tail. Startup failures remain primary if stopping that same child also reports an error. The Merchant provider drains all accepted calls, then attempts every retained file reader and client close even when another independent owner fails. Retry `close()` on that same provider after resolving the reported owner failure; its original objects and immutable results remain retained.
