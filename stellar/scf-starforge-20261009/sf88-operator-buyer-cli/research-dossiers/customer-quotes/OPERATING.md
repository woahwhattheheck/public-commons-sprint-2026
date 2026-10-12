# Customer quotations and realized Research delivery

This workspace connects a customer quotation to the actual Research brief, frozen delivery, Stellar publication and receiving history. The quotation editor is the original SF74 commercial desk, including its saved pricing sources, customer responses, implementation planning and portable receiving. Supplier costs and pricing versions come from the original SF97 workspace. The selected merchant supplies the compiled checkout terms for the paid delivery.

Open **Customer quotations** from the Research workspace. The page uses the same private listener, token, original dossier directory and saved history as Customer updates and Paid delivery.

## Choose the original workspaces

The Research launcher accepts an optional quotation configuration:

~~~sh
node server.mjs \
  --dir /private/research-workspace \
  --customer-commerce-host /private/research-commerce.json \
  --customer-quotes-host /private/research-quotes.json
~~~

Keep the other existing source, extraction, Documents, Pipeline, Crossref and Applications options on the same launch. The existing connection file and Research client continue to refer to this listener.

A quotation configuration has this form:

~~~json
{
  "schema": "sf88-research-customer-quotes-host/v1",
  "casesDirectory": "/private/customer-cases",
  "pricing": {
    "research": {
      "label": "Research delivery merchant",
      "config": "/private/merchant/seller.json",
      "directory": "/private/merchant/pricing",
      "snapshot": "/private/merchant/observations.json",
      "nativeOutbox": "/private/merchant/outbox",
      "sourcePackage": "/private/merchant/source",
      "releaseStore": "/private/merchant/releases",
      "releaseRuntime": {}
    }
  }
}
~~~

Only the schema is required. Without a quotation configuration, the original commercial case store is created at `<Research directory>/customer-quotes/cases`, and the pricing profile list is empty. Selecting an existing `casesDirectory` opens that original SF74 case store and preserves its case revisions, customer records and commercial history.

Each pricing profile requires `config`, `directory`, and exactly one of `snapshot` or `history`. The other paths are the original optional SF97 integration selections. Relative paths resolve from the configuration file's directory. `releaseRuntime` is the original release runtime options object; it is copied unchanged and validated by the native release engine, including its own nested option and path semantics. Omit it or use `{}` to retain the native defaults. The launcher reads private configuration and observation files and checks the actual selected directory identity. Up to sixteen named profiles can be declared.

The separate [Paid delivery configuration](../customer-commerce/OPERATING.md) supplies merchant and Buyer aliases. Select a merchant already declared there. Its original checkout file, outbox, paid-file state and Buyer application remain the payment and acquisition owners. The quotation page displays the selected merchant terms before a Research brief is revised or a delivery is published.

The configuration view shows:

- The original Research workspace ID and commercial case workspace ID.
- The selected case directory and retained directory identity.
- Every declared pricing profile and its original source paths.
- Each available merchant, its compiled checkout terms, and a useful configuration error if one declaration cannot be opened.

The quotation host retains one native pricing model, planning model and tariff model per profile. Capturing observations, previewing a proposed price and saving that reviewed version therefore use the same original capture. A profile's directory and selected paths stay bound for that listener lifetime. Reopen the original listener after intentionally changing those selections.

## Complete browser journey

### 1. Open or create the customer case

Select **Cases and quotations** to search, filter and page through the original commercial store. Open an existing customer case to see its full saved quote history. The commercial desk reads the exact original case revision and sends the original case scope back on every write.

To create a case from Research, choose a saved dossier revision, customer project and brief. The customer name, purpose, scope, outputs and terms seed a normal SF74 case. The retained creation request binds the selected original Research records and the requested case ID. Repeating it reopens the same initial case, including later original case history.

The operator identity is retained with each exact native mutation. Changing the displayed operator later does not change an already submitted request.

### 2. Price and publish the quotation

Use the embedded **Commercial quote** desk to edit the entire original quote: customer and supplier identities, service lines, units, implementation and recurring amounts, planned route usage, margin assumptions, terms, acceptance and payment schedule.

The same desk exposes the complete original workflows:

- Open saved case revisions and compare published quotations.
- Receive original pricing proposals and their source files.
- Capture, inspect, attach and restore commercial backups.
- Select and receive supplier-cost or tariff editions.
- Review implementation work and adopt the selected plan.
- Save drafts, publish a customer quotation and download the original quote, JSON or handoff.
- Record the customer's actual acceptance, requested changes or decline.

Each action retains the original SF74 request, scope and case revision. The original commercial desk keeps its authored working form and pending operation when you navigate between cases. Its existing conflict, recovery and source review controls remain available.

A quote must be published before it can commission a Research brief. Select that exact quote ID and quote SHA from the case's original published history.

### 3. Review the customer brief against that quote

Open **Customer brief** and create a working form. Select:

1. The exact original case revision and published quotation.
2. The Research dossier, saved revision, customer project and current brief.
3. The merchant declared by the original Paid delivery host.
4. The quoted scope component and a clear billing unit.
5. The reason for this customer brief edition and the responsible operator.

The scope component can be:

| Component | Original amount carried into the Research brief |
| --- | --- |
| IMPLEMENTATION | The quotation's implementation USD total. |
| RECURRING | The quotation's recurring USD total. |
| ROUTE_USAGE | The quotation's planned route-usage USD total. |
| KEEP | The selected brief's complete current scope. |

Write the unit explicitly, for example “one reviewed evidence update” or “one month of monitoring”. The native quote amount remains its exact original decimal string. The reference binds the original case, quote ID and quote SHA.

**Prepare review** retains the complete quotation, case files, original Research project and brief, selected merchant configuration binding, and the exact native `revise-brief` request. The displayed review identifies the changed scope and retained customer, purpose, owner, questions, protocol, source plans, outputs and update policy.

**Apply reviewed brief** submits that exact original request and review SHA. The ordinary Research writer controls the saved revision. The completed binding includes the actual new brief ID. It becomes the reference for customer agreement, delivery publication and the later realized report.

If either workspace advances before a new preparation, choose the current source deliberately. If a prepared request has already completed, replay its retained original ID to recover the first saved result.

### 4. Carry the actual customer response into Research

Record the real customer response in the native commercial desk first. Then open **Customer response**, select the completed brief binding, the case revision containing that response and the original response ID.

The review carries the exact original response, quote ID and quote SHA, source reference, observed time and message. Select both the operator recording the agreement and the customer contact identified by the response.

Applying the review records an original Research customer agreement:

| Original commercial response | Research agreement disposition |
| --- | --- |
| ACCEPTED | ACCEPTED |
| REVISION_REQUESTED | CHANGES_REQUESTED |
| DECLINED | DECLINED |

The source record and actual response time remain in the Research history. The quote desk continues to own subsequent commercial revisions.

### 5. Complete the evidence update and freeze its delivery

Use [Customer updates](../customer-updates/CUSTOMER_UPDATES.md) for the full recurring work: inspect source changes, update the requested evidence work, review the source plan, receive actual results, author findings and freeze the complete delivery.

Choose the brief created by the quotation binding when preparing that work. A publishable delivery must belong to the same customer project and reference a requested edition whose brief ID is the applied quoted brief. The quotation page selects deliveries with this exact native relationship.

The frozen delivery retains the complete original work, dossier, source workspace where selected, and all four report bodies. Later customer corrections produce later history while the original delivery stays available.

### 6. Prepare and enroll the original paid publication

Open **Publish delivery**, select the completed quotation binding and its actual frozen delivery, then author the delivery title, summary and usage.

Preparation enters the existing Paid delivery engine with that complete selection. The review binds:

- The original applied customer brief and frozen requested-work edition.
- The exact complete customer delivery.
- The selected merchant's compiled checkout configuration and payment terms.
- The native publication review and its original retained files.

Enrollment uses the original publication ID and reviewed SHA. The native merchant publishes the same complete archive and SF101 order. The quote scope amount and compiled checkout terms each retain their source and units throughout the workflow.

The existing **Paid delivery** page and Commerce client continue the Buyer approval, native execution, paid-file retrieval, exact archive receiving and full editable Research handover. Use the original Buyer application and retained request when continuing a pending acquisition.

### 7. Freeze a realized delivery report

Open **Realized delivery** and select:

1. The completed quotation binding.
2. Its enrolled original publication.
3. The saved Research revision containing the customer delivery and response history.
4. The actual Buyer purchase records to include.
5. An optional original saved pricing version and supplier-cost edition.

The report reads the actual native order for the exact enrolled archive. Each selected Buyer record must refer to that same complete publication. The customer section comes from the selected saved dossier revision and includes its actual project, brief, agreements, requested work, delivery and receiving events.

When pricing is selected, the report retains the whole saved SF97 pricing report and its original files. An optional supplier-cost edition must belong to that pricing version; its complete native files and COST_EDITION archive accompany the report. The native report's observation period and route coverage remain visible.

The first observed order, Buyer states and customer history are retained before the report's individual files are published. Retrying the same report request finishes those original files and returns the first completed report. Create a new request when you want a later observation.

The downloadable report set includes the original selected case and quotation files, binding source, enrolled publication, native order, Buyer records, customer history, machine-readable realized report, readable Markdown report, and selected complete pricing and supplier-cost files.

### 8. Reopen and hand over the complete work

**Saved work** shows CASE, BRIEF, RESPONSE, PUBLICATION and REALIZED operations. It pages against a retained listing snapshot and opens the full saved request, review and result.

Open an operation to inspect every original retained file and download it in full. File metadata supplies the exact byte count, media type and SHA before the download. Large native pricing or cost archives use the original streaming client or terminal export.

**Replay the exact saved request** submits the original retained body again and then reloads the current native workspace. A completed replay returns its original result even after later source or customer work.

Every browser working form is saved independently. Moving between tabs or opening a different draft preserves that form. Export a form to move it to another browser session; receive it into a separate retained draft after checking the same original workspace, dossier, case and binding selection. Reopen a received form, deliberately review the selected source and submit it under its own retained request.

The native commercial desk also retains its original per-case working and pending forms. Keep its original receiving and conflict choices when continuing a saved commercial operation.

## Request and review lifecycle

A customer quotation operation has one stable UUID and one complete original request. Its states are:

| State | Retained native work |
| --- | --- |
| PREPARING | The immutable original request and any complete source files already published. |
| REVIEWED | The exact complete review and its SHA, with the original source closure. |
| COMPLETE | The original completed result and its complete retained files. |

CASE and REALIZED operations complete through their native preparation. BRIEF and RESPONSE require an explicit application of the review. PUBLICATION requires enrollment of the reviewed existing Commerce publication.

The browser and terminal retain the full outgoing request before dispatch. An interrupted response remains recoverable under that same request. The native writer compares the original request before current source selection, so recovery can return an already completed result after later dossier or case changes.

An ID reused with different inputs is rejected. Review SHA and original source checks distinguish a deliberately new review from the replay of an already saved operation. A changed quote, source revision or checkout selection is resolved by opening that actual source and preparing a new request.

The original workspace client admits a complete operation once. Metadata lookup and its dependent file transfer stay admitted while the client closes, and the host drains accepted quotation work before it closes Commerce, the original dossier owners and its listener. Failed native closers remain available to the original retry.

## Native HTTP interface

All quotation routes use the original Research authorization and original workspace/instance headers. Request JSON accepts up to 96 MiB plus 65,536 bytes so the complete original commercial receiving inputs can pass through. JSON responses use the existing 64 MiB client budget. Each streamed retained file is bounded by 256 MiB.

### Read original state

| Method and path | Complete result |
| --- | --- |
| GET /api/customer-quotes/configuration | Declared original cases, pricing and merchant selections. |
| GET /api/customer-quotes/cases | Native commercial case page, with q/status/dueOn/offset/limit. |
| GET /api/customer-quotes/cases/:caseId?revision=SHA | Original selected case, full commercial view and quote history. |
| GET /api/customer-quotes/operations | Snapshot-bound page, with offset/limit/snapshot/dossierId/kind. |
| GET /api/customer-quotes/operations/:id | Original request, review and completed result. |
| GET /api/customer-quotes/operations/:id/files | Every retained file descriptor. |
| GET /api/customer-quotes/operations/:id/files/:name?metadata=true | Exact file descriptor and workspace/operation binding. |
| GET /api/customer-quotes/operations/:id/files/:name | Complete original file stream. |

The cases result is the original native object under `result`, with `cases`, `total`, `offset`, `limit` and `nextOffset`. Quotation operations use `schema: "sf88-research-customer-quote-operation/v1"`, `workspaceId`, `casesWorkspaceId`, `id`, `kind`, `status`, `request`, `requestSha256`, `createdAt`, `review` and `result`.

### Prepare and save exact selections

POST routes accept the following bodies. IDs and SHAs are selected from the actual source views.

**Create the original case** — `/cases/create`:

~~~js
{
  requestId, caseId,
  dossierId, revision, projectId, briefId,
  actor: {id: operatorId, name: operatorName}
}
~~~

**Prepare the quoted brief** — `/prepare`:

~~~js
{
  requestId,
  caseId, caseRevision, quoteId, quoteSha256,
  dossierId, revision, projectId, briefId,
  merchant: merchantAlias,
  scope: {component: "RECURRING", unit: "one month of monitoring", note: scopeNote},
  reason,
  actor: {id: operatorId, name: operatorName}
}
~~~

**Prepare the original customer response** — `/responses/prepare`:

~~~js
{
  requestId, bindingId, caseRevision, responseId, revision,
  actor: {id: operatorId, name: operatorName},
  by: {id: customerContactId, name: customerContactName}
}
~~~

**Apply a BRIEF or RESPONSE review** — `/apply`:

~~~js
{id: originalRequestId, reviewSha256: originalReview.reviewSha256}
~~~

**Prepare a frozen paid publication** — `/publications/prepare`:

~~~js
{
  requestId, bindingId,
  dossierId, revision, deliveryId,
  title, summary, usage,
  sourceWorkspace: originalSourceWorkspaceOrNull
}
~~~

**Enroll the reviewed original publication** — `/publications/enroll`:

~~~js
{id: originalRequestId, reviewSha256: originalReview.reviewSha256}
~~~

**Prepare the realized delivery report** — `/reports/prepare`:

~~~js
{
  requestId, bindingId, publicationId,
  purchaseIds: originalPurchaseIds,
  revision,
  pricing: {
    profile: originalProfileAlias,
    version: originalPricingVersion,
    costEdition: originalCostEdition
  },
  actor: {id: operatorId, name: operatorName}
}
~~~

Use `pricing: null` when the report has no selected pricing version. `costEdition` is optional when a pricing version is selected. The complete original report and cost files remain attached to that selected version.

### Operate the original commercial and pricing engines

POST `/cases/:caseId/:action` forwards the original native input to:

~~~text
preview, save-draft, publish, receive, receive-pricing, compare,
preview-implementation, adopt-implementation,
receiving-status, receiving-capture, receiving-inspect, receiving-attach,
receiving-case, receiving-restore,
tariff-status, tariff-catalog, tariff-selection, tariff-capture,
tariff-inspect, tariff-attach, tariff-case, tariff-restore
~~~

Use the original SF74 scope, expected revision, actor and request ID required by that action. The [commercial desk guide](../../../sf74-merchant-support-console/COMMERCIAL.md) and [implementation guide](../../../sf74-merchant-support-console/COMMERCIAL_IMPLEMENTATION.md) describe the full native inputs and receiving workflow.

POST `/cases/:caseId/download` serves the original quotation download. POST `/cases/:caseId/tariff-download` serves the original selected tariff download. Read `?metadata=true` with that same native body first. Preserve its returned original case revision for the file request, along with the selected quote, tariff or source SHA.

POST `/pricing/:profile/:action` operates the original selected model:

~~~text
state, preview, save, version, compare,
planning-state, planning-preview, planning-save, planning-read,
economics-state, economics-preview, economics-save, economics-edition,
economics-proposal, economics-apply,
repricing-source, repricing-preview, repricing-save, repricing-stage
~~~

These calls preserve the original SF97 inputs, captured observations, saved versions, supplier records and reviewed pricing changes. Use the pricing controls in **Connections** for the exact native state and request form. The [merchant pricing guide](../../../sf97-merchant-revenue-ops/README.md) and [supplier receiving guide](../../../sf97-merchant-revenue-ops/economics/RECEIVING.md) cover the same maintained engines.

## JavaScript client and complete local exports

The original `ResearchWorkspaceClient` exposes `customerQuotes()`. The returned typed client borrows that connection and its existing request ownership. Its complete declaration is [client.d.mts](client.d.mts).

A script beside this guide can open a prepared customer brief using the original private connection:

~~~js
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ResearchWorkspaceClient} from '../workspace-client.mjs';

const [connectionFile, directory, selectionFile] = process.argv.slice(2);
const input = JSON.parse(await readFile(resolve(selectionFile), 'utf8'));
const original = new ResearchWorkspaceClient({
  connectionFile: resolve(connectionFile),
  directory: resolve(directory)
});
try {
  const quotes = original.customerQuotes();
  const configuration = await quotes.configuration();
  const review = await quotes.prepare(input);
  console.log(JSON.stringify({configuration, review}, null, 2));
} finally {
  await original.close();
}
~~~

Use the returned original `review.id` and `review.review.reviewSha256` in the application request:

~~~js
const applied = await quotes.apply({
  id: reviewedOperation.id,
  reviewSha256: reviewedOperation.review.reviewSha256
});
~~~

`prepareResponse`, `preparePublication` and `prepareReport` take the exact native selections described above. `enrollPublication` takes the same `{id, reviewSha256}` shape as the explicit publication enrollment route. Preserve the complete first request and result when composing a longer customer programme.

The original native engine calls are also available:

~~~js
const cases = await quotes.listCases({limit: 50});
const selectedCase = await quotes.readCase(caseId, {revision: caseRevision});
const preview = await quotes.caseAction(caseId, 'preview', nativeQuoteInput);
const pricing = await quotes.pricing(profileAlias, 'state', nativeStateInput);
~~~

`list` pages saved quotation operations; `operation` reopens the complete original request, review and result. `files` and `fileInfo` inspect retained native source/result files. The complete file download uses the selected descriptor:

~~~js
const originalFiles = await quotes.files(operationId);
const selected = originalFiles.files.find(file => file.name === requestedName);
if (!selected) throw new Error('The selected original file is absent.');
const saved = await quotes.download(operationId, selected.name, {
  file: absoluteReceivingFile,
  expectedBytes: selected.bytes,
  expectedSha256: selected.sha256
});
~~~

`downloadCase(caseId, nativeInput, options)` and `downloadTariff(caseId, nativeInput, options)` read the original metadata, pin its exact case revision and stream that same native file. `caseFileInfo` and `tariffFileInfo` expose the original descriptors separately when preparing a selection.

Each public method accepts its original abort signal. A complete metadata-to-download operation is admitted once and stays in the original connection's pending work until its full file and hash are complete. Closing the original client drains that operation. The factory introduces no second listener or Buyer executor.

For long-running receiving, interrupted output publication and complete operation export, use the durable [terminal operators](operator.mjs) and the `quotes-*` commands. They retain the original request and response before publishing files, so an interrupted process can reopen the same completed work.

## Terminal operators and retained receiving

Run `node customer-quotes/cli.mjs quotes-help` from the Research source directory for the complete command syntax. The original `workspace-cli.mjs` dispatches the same `quotes-*` commands, and the installed contribution exposes `research-quotes`.

The terminal uses the existing Research connection. Mutations and full exports retain a `--run-directory` containing their original selected input and native result. Keep a distinct directory for each reviewed command or explicit replay attempt.

| Command | Complete operating step |
| --- | --- |
| quotes-help | Read the installed command syntax. |
| quotes-configuration | Inspect the original commercial case store, pricing profiles and merchant declarations. |
| quotes-cases | Search and page current native commercial cases. |
| quotes-case | Open an original case and its selected revision. |
| quotes-create-case | Create the original commercial case from a saved Research project and brief. |
| quotes-native-case | Run the complete native quote, implementation, receiving or tariff action. |
| quotes-pricing | Operate the declared SF97 model, planning, economics or repricing workflow. |
| quotes-prepare | Retain the complete quote-to-brief selection and review. |
| quotes-apply | Apply the exact saved BRIEF or RESPONSE review. |
| quotes-prepare-response | Prepare the customer's selected original response for Research agreement. |
| quotes-prepare-publication | Prepare the selected frozen delivery through its bound merchant. |
| quotes-enroll-publication | Enroll that reviewed original paid publication. |
| quotes-prepare-report | Retain the actual delivery, order, receiving and optional pricing/cost report. |
| quotes-history | Page the native saved quotation operations. |
| quotes-operation | Read the native original operation by its ID. |
| quotes-files | List every complete native file for the selected operation. |
| quotes-export-operation | Receive the complete original operation and all its retained files. |
| quotes-download-case | Receive the exact original commercial file using its selected case revision. |
| quotes-download-tariff | Receive the complete original tariff or source file. |
| quotes-run | Reopen a retained local command and its saved result without opening a host. |
| quotes-replay | Submit the retained exact input in a separate retained replay directory. |

Use the complete native selections documented above as the command inputs. A Research briefing command retains the selected case, quote and dossier identities; a native commercial or pricing command uses that engine's full input unchanged. Large original backups and pricing inputs therefore remain complete local files throughout receiving.

The local run and the native operation have different purposes. `quotes-operation` reads the saved server operation; `quotes-run` reopens the locally retained command and completed output. `quotes-replay` makes an explicit new client attempt with the same original native input and IDs. It does not revise the first operation to match newer case, customer or merchant state.

For the whole customer journey, retain the creation/brief review, apply the accepted review, record the actual customer response, complete evidence work through Customer updates, prepare and enroll its frozen publication, then receive the realized report and every native file. The original Commerce commands continue the approved Buyer action and customer receiving between publication and realized reporting.

## Operate the same workflow from a Merchant agent

Use the existing declared Research workspace. `merchant_research_workspaces` lists its alias and source handles; `merchant_research_attach` verifies the original listener and returns the current attachment ID. The complete customer quotation tools operate on that attachment.

| Tool | Original operation |
| --- | --- |
| merchant_research_quote_configuration | Inspect case directory, saved pricing profiles and compiled merchant selections. |
| merchant_research_quote_cases | Page the native commercial cases. |
| merchant_research_quote_case | Open the full original case and quote history at a selected revision. |
| merchant_research_quote_case_create | Create a normal commercial case from the selected complete Research project and brief. |
| merchant_research_quote_case_action | Run an original quote, implementation, backup or tariff operation with its native input. |
| merchant_research_quote_pricing | Use the same declared pricing, planning and supplier-cost models. |
| merchant_research_quote_prepare | Retain the complete quote-to-brief review and original source files. |
| merchant_research_quote_response_prepare | Retain the selected actual customer response for Research agreement. |
| merchant_research_quote_apply | Apply the exact original BRIEF or RESPONSE review. |
| merchant_research_quote_publication_prepare | Prepare the actual frozen delivery through the bound merchant. |
| merchant_research_quote_publication_enroll | Enroll that reviewed native publication. |
| merchant_research_quote_report_prepare | Freeze actual order, Buyer receiving, customer history and selected pricing/cost files. |
| merchant_research_quote_operations | Page the original immutable quotation operations. |
| merchant_research_quote_operation | Reopen the full request, review and first saved result. |
| merchant_research_quote_files | List every complete source/result file for one operation. |
| merchant_research_quote_file_info | Read exact original operation, case or tariff file metadata. |

Quotation preparation and mutation tools take their full native body under `input`, or a single `source` handle of kind `quote-input` declared on the existing Research attachment. The source handle binds the original JSON file and its complete SHA; the native host reads that full body directly. This carries large original commercial backups, pricing proposals and tariff inputs through the same workflow. Select exactly one of `input` or `source`.

Case-action and pricing tools also take `caseId` or `profile` and the actual native `action`. Retain the complete original body, IDs and review SHA through retries. A declared input has `{file: "/original/selected-request.json", kind: "quote-input", sha256: "COMPLETE_ORIGINAL_SHA256"}` under the existing workspace configuration’s `sources` map.

Use the ordinary Customer updates tools for evidence work and freezing the delivery. The ordinary Commerce tools continue actual Buyer approval, execution, paid archive and full receiving. The quoted brief binding and selected native publication keep those steps connected.

### Download complete quotation files through the existing reader

For an operation, list `merchant_research_quote_files`, then call `merchant_research_export`:

~~~js
{
  workspace: originalResearchAlias,
  kind: "quote-operation-file",
  quoteOperationId: originalOperationId,
  quoteFileName: selectedFile.name,
  expectedSha256: selectedFile.sha256
}
~~~

For a commercial case or tariff file, inspect `merchant_research_quote_file_info` first. Use `kind: "CASE"` or `"TARIFF"`, the original case `id`, and its complete native download `input`. Retain the returned case revision in that input. Then export using `kind: "quote-case-file"` or `"quote-tariff-file"`, `quoteCaseId`, exactly one `quoteInput` or `quoteInputSource`, and the exact descriptor SHA.

Every completed export enters the same original Research file store. Continue with `merchant_research_file_read` using the returned `kind`, `exportId`, `readId` and `nextOffset` until the complete file is received. If a reader expires or the Merchant process restarts, reopen the same retained export ID at the retained offset. `merchant_research_file_release` releases the temporary read after receiving the file.

The original attachment drains accepted operations and its file readers on detach. The Research listener and saved case, quote, pricing, publication and dossier histories stay available to the original application.

## Complete installed source

The Research contribution carries the quotation browser, contracts, native controller, typed client, durable operators and terminal entry. It also includes the complete original SF74 and SF97 components, which supply the commercial UI, case writer, pricing/planning/tariff engines and native portable files.

The original Research launcher, Customer updates, Paid delivery, Buyer Runbook, SF101 checkout and saved customer receiving remain the operating path. A full native continuation can therefore proceed from the existing customer case and observed pricing version through quotation, revised evidence work, frozen paid delivery, actual Buyer receiving and a complete realized report.
