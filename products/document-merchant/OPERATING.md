# Operate a document merchant

This workflow turns a complete customer HTML or Markdown source file into a delivered PDF. It uses the original paid Jobs service for customer requests, file staging, payment, execution and receiving.

## Build and install the complete document package

The committed `document-merchant` source selection packages this document service with the original paid merchant, Request, Checkout, Jobs, result receiving, Collections, operator and runtime commands. It retains the original source declarations and browser route maps.

From the maintained merchant checkout, produce the complete archive with Node 22.16 or later and the existing Python runtime:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-checkout \
  --ref SOURCE_COMMIT \
  --selection document-merchant \
  --out /absolute/new-document-package \
  --offline
~~~

Choose the actual committed source revision containing `distribution/selections/document-merchant.json`. The original builder writes its npm-compatible archive and manifest into the selected output directory. Keep that manifest and the original archive together. An interrupted build continues through the same command and output with `--resume`.

On a customer machine, install the resulting archive into an ordinary application directory:

~~~sh
npm install --ignore-scripts --offline --omit=optional /absolute/original-document-package.tgz
npx --no-install starforge document-merchant providers
npx --no-install document-merchant --help
~~~

Both executables use the same complete selected source. The source installation uses the provider's native HTTPS API for rendering; the merchant's existing native payment runtime supplies the settlement dependencies and signer. For a complete private merchant runtime, use the maintained installer with the original archive:

~~~sh
starforge runtime-install prepare \
  --dir /srv/starforge/document-runtime \
  --archive /absolute/original-document-package.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --operator
starforge runtime-install install --dir /srv/starforge/document-runtime
starforge runtime-install run --dir /srv/starforge/document-runtime -- document-merchant providers
~~~

The archive's own manifest supplies its dependency declarations. Add the existing `mcp` feature when this merchant will also be controlled by the merchant MCP operator. Keep provider keys and native signer credentials in the selected private runtime environment.

Continue with the provider selection and retained merchant setup below. The same archive contains `jobs`, `job-workspace`, the original resolution commands and Applications for the paid merchant, checkout, result receiver and Collections, together with Document merchant and Document production. The customer flow uses their existing saved records throughout.

## 1. Select the renderer and its real account

Run:

~~~sh
starforge document-merchant providers
~~~

Choose the renderer that matches the source the customer already produces. Keep its original account with the merchant.

| Provider | Supported source | Authentication | Important native behavior |
| --- | --- | --- | --- |
| MintPDF | HTML, Markdown | Original bearer key; anonymous mode also available | PDF bytes from /v1/pdf; optional top-level paper, margin, header/footer text and page numbering |
| snaplab | HTML | Original bearer key | Native pdf options, print/screen media, background rendering, selector wait and cache headers |
| PDFMint | HTML, Markdown | Original bearer key | Native options object, print media, HTML header/footer and page numbering; one credit per successful document |

Source: [MintPDF OpenAPI](https://mintpdf.dev/openapi.json), [snaplab API reference](https://snaplab.dev/docs), [PDFMint API reference](https://pdf.mintapis.com/docs), read 12 October 2026.

MintPDF and PDFMint have different operators, domains, keys and quotas. Select the service by its exact identifier: mintpdf, snaplab or pdfmint.

The merchant's provider configuration contains an environment **name**, such as MINTPDF_API_KEY. Put the existing key value into that selected environment using the operator's usual private runtime configuration. The generated application does not contain the key value. The worker receives only the declared provider environment.

The optional intakeKeyEnvironment selects a separate customer intake key through the original Jobs intake mechanism. It cannot equal the renderer key environment. Leave it null for the normal public paid intake.

For a small commissioning run, MintPDF publishes three anonymous renders per day per IP. template --provider mintpdf --anonymous selects that mode explicitly. Use the returned provider allowance and its reset behavior when planning a run. A bearer plan is the normal selection for an ongoing commercial service.

## 2. Prepare the complete merchant

Create a private input directory and retain a setup template there:

~~~sh
starforge document-merchant template \
  --provider pdfmint \
  --out /srv/starforge/document-input/setup.json
~~~

Set these actual operator selections before preparing:

| Field | Selection |
| --- | --- |
| publicOrigin | Existing HTTPS merchant origin with no trailing path |
| payment.network | The selected Stellar network |
| payment.asset | Actual supported asset contract |
| payment.payTo | Actual merchant recipient |
| payment.amount | Per-document integer amount in the asset's smallest units |
| provider.plan | The provider plan currently selected on the merchant account |
| provider.keyEnvironment | Name of the existing private renderer-key environment |
| formats | Supported functions to sell; snaplab supports html only |
| workerCount | Merchant's selected workers within the published provider concurrency limit |
| inputStorage | Original merchant input-file storage allowance |

The template includes the native exact payment scheme and timeout field. The original seller compiler validates the full payment option. Choose the amount with the actual asset's decimal scale; the supplier's USD subscription price is a separate amount.

~~~sh
starforge document-merchant prepare \
  --request /srv/starforge/document-input/setup.json \
  --directory /srv/starforge/documents

starforge document-merchant inspect \
  --directory /srv/starforge/documents
~~~

Prepare writes the complete application, jobs.json, provider.json, supplier-price.json, customer-setup.json and supported source examples. It retains the exact initial request and generated file bytes under the original Linux lease. Repeating the same request reopens the same installation. Changed configuration belongs in the original merchant's source-bound deployment process; use a new installation directory when commissioning a changed service.

The self-contained generated application contains both renderer source and immutable provider configuration. Jobs retains its complete application SHA alongside the Jobs configuration SHA. It runs the selected module with the original sealed source file for each accepted paid request.

## 3. Review provider units and capacity

~~~sh
starforge document-merchant price \
  --directory /srv/starforge/documents \
  --documents 1000 \
  --supplier-units 1000
~~~

The review returns the source-dated plan, included units, requested usage and exact subscription-allocation fraction. It also shows the unchanged merchant payment per document. It does not convert USD into the selected Stellar asset.

Published monthly plans on 12 October 2026:

| Provider | Free bearer tier | Entry paid plan | Further plans |
| --- | --- | --- | --- |
| MintPDF | 100 renders | $19 / 3,000 renders | $49 / 12,000; $129 / 50,000 |
| snaplab | 100 renders | $9 / 2,000 renders | $29 / 10,000; $79 / 40,000 |
| PDFMint | 10 credits | $9 / 5,000 credits | $29 / 50,000; $99 / 250,000 |

Sources: [MintPDF](https://mintpdf.dev/), [snaplab](https://snaplab.dev/), [PDFMint](https://pdf.mintapis.com/).

Subscription allocation is planning arithmetic. A $9 plan used for 1,000 chargeable supplier operations allocates 0.9 cents of that month's subscription to each operation. The plan's included unit ceiling still applies. Account usage and the actual supplier invoice determine incurred charges. snaplab documents calendar-month resets; the other selections retain a monthly plan period and the actual account's returned reset information.

A snaplab response with x-snaplab-cache: HIT reports zero consumed renders. MISS reports one. When the response omits this header, consumption remains unknown in the result. PDFMint's returned page count and remaining-credit headers remain exactly the supplier's observations. Its published successful-document credit stays distinct from page count. MintPDF's PDF response does not promise an account counter.

Fetch actual account usage through its original read-only endpoint:

~~~sh
starforge document-merchant usage \
  --directory /srv/starforge/documents \
  --out /srv/starforge/document-input/usage-2026-10-12.json
~~~

The private file retains the complete original account JSON, request time and source URL. The command prints its saved-file identity. MintPDF anonymous mode has no bearer account usage request.

The worker count is limited by the selected published plan where concurrency is documented. The original Jobs queue controls pending paid work. Other applications on the same supplier account can also consume its quota; supplier rate and capacity responses govern actual admission. Choose enough included units before selling the planned batch.

## 4. Start the original service

~~~sh
starforge document-merchant serve \
  --directory /srv/starforge/documents \
  --native-factory /srv/starforge/native-runtime.mjs \
  --seller-port 8431 \
  --customer-port 8432 \
  --operator-port 8433 \
  --start-worker
~~~

The existing native factory and operator configuration supply the payment runtime. Use the existing merchant host's chosen ports and HTTPS proxy. Route /documents/html and, when configured, /documents/markdown to the seller listener. Route /jobs/ to the customer listener, including /jobs/intake/v1/. The private operator listener stays in the original operator environment.

The command opens the original Jobs foreground service and prints its actual local workspace addresses. That workspace owns the same merchant lease, paid jobs, cancellation, resolution and worker lifecycle as the rest of the product.

When operating a running service, use that service's private workspace. Standalone commands reopen the same state after its foreground owner closes normally:

~~~sh
starforge document-merchant jobs --directory /srv/starforge/documents status
starforge document-merchant jobs --directory /srv/starforge/documents show --id JOB_ID
~~~

For original nested inputs, delivery, receiver and recovery operations, use starforge jobs with the jobsConfig and merchantState shown by inspect. These remain their maintained native operations.

## 5. Give the customer a complete source-file request

The generated customer-setup.json names the exact origin, supported functions, native input shape, media types, file limits, per-document payment and output slots:

~~~sh
starforge document-merchant customer-setup \
  --directory /srv/starforge/documents \
  --out /srv/starforge/document-input/customer-setup.json
~~~

Open the existing customer Request application using its already selected operator and an allowed source directory:

~~~sh
starforge job-workspace serve \
  --state /srv/starforge/customer-jobs \
  --file-root /srv/starforge/customer-inputs \
  --operator-workspace /srv/starforge/operator \
  --landing request
~~~

The customer enters the supplied merchant origin and selects renderHtml or renderMarkdown. The form accepts:

~~~json
{
  "title": "Weekly operations report",
  "taskReference": "operations-week-41"
}
~~~

Omitting settings selects the product's source-documented defaults. A supplied settings object is used as supplied, with the remaining defaults determined by the native renderer. For example, a customer using snaplab can select print media and a footer:

~~~json
{
  "title": "Weekly operations report",
  "taskReference": "operations-week-41",
  "settings": {
    "pdf": {
      "format": "A4",
      "printBackground": true,
      "media": "print",
      "footerTemplate": "@pageNumbers"
    },
    "cache": true,
    "waitUntil": "auto"
  }
}
~~~

Select **Save request and add files**, then add the whole source in slot source. Use text/html for HTML or text/markdown for Markdown. The original browser streams local hashing and stages the exact bytes; a previously received Resource library item can supply the source too.

Select **Prepare checkout** once the required source is ready. The original intake uploads and seals that complete source at the merchant, retains the descriptor in the paid input, and opens the same request's original Checkout entry. Review the actual price and selected operator, then execute that checkout.

The customer keeps the original request, claim, payment handoff and accepted job. Closing a browser and reopening the same request resumes original file or ticket work through the existing customer workspace.

### Installed customer commands

The same saved workflow is available through the original command surface. The browser and standalone command use the same customer lease; close the active browser service before opening its state through commands.

~~~sh
starforge job-workspace request-catalog \
  --state /srv/starforge/customer-jobs \
  --file-root /srv/starforge/customer-inputs \
  --origin https://YOUR_MERCHANT_ORIGIN \
  --out /srv/starforge/customer-inputs/catalog.json

starforge job-workspace request-draft \
  --state /srv/starforge/customer-jobs \
  --catalog-file /srv/starforge/customer-inputs/catalog.json \
  --function renderHtml \
  --input /srv/starforge/customer-inputs/document-input.json \
  --reference operations-week-41 \
  --label "Weekly operations report"
~~~

Use the returned request ID and its actual revision:

~~~sh
starforge job-workspace request-file-add \
  --state /srv/starforge/customer-jobs \
  --request REQUEST_ID \
  --slot source \
  --file /srv/starforge/customer-inputs/report.html \
  --content-type text/html \
  --expected-revision CURRENT_REVISION

starforge job-workspace request-show \
  --state /srv/starforge/customer-jobs \
  --request REQUEST_ID

starforge job-workspace request-prepare \
  --state /srv/starforge/customer-jobs \
  --request REQUEST_ID \
  --expected-revision CURRENT_REVISION \
  --operator-workspace /srv/starforge/operator
~~~

request-show returns the revision after the file operation. Preparation returns the original checkoutId. Continue with the original checkout-review, checkout-execute or checkout-recover and the accepted job's watch/fetch commands.

## 6. Receive the complete document

After the paid worker completes, the original Jobs customer view receives the named output package into Resource library. The package has four required slots:

| Slot | Retained content |
| --- | --- |
| pdf | Complete binary PDF; exact received byte count and SHA |
| source | Unchanged complete input file |
| request | Original input and selected effective settings |
| render | Actual supplier endpoint, request and receiving times, native job/attempt IDs and returned usage |

Open every PDF page and the source that belongs to it. A table report is complete when its requested rows and final content arrive; a successful supplier HTTP response alone does not establish the customer's parent-task acceptance.

The unchanged source can become the next cycle's input. Existing Collections can retain the PDF alongside related report data, invoices or previous periods. If one business task needs both an invoice and a greeting card, use the same parent task reference for the two document requests and accept the complete pair at the parent-task level.

The native merchant can retrieve a named file from its retained result after closing the foreground service:

~~~sh
starforge document-merchant jobs \
  --directory /srv/starforge/documents \
  outputs --id JOB_ID

starforge document-merchant jobs \
  --directory /srv/starforge/documents \
  output-file --id JOB_ID --slot pdf \
  --out /srv/starforge/document-input/received-document.pdf
~~~

The original output API returns the saved PDF bytes and source identity. The full package also remains in the existing Jobs receiving and recovery flow.

## 7. Rendering settings and file limits

MintPDF exposes paper format, landscape, CSS margin, headerText, footerText and pageNumbers at the top level of settings. Its Markdown input is native Markdown.

snaplab places print behavior in settings.pdf. The product supports native background, print/screen media, paper/custom dimensions, margins, header/footer templates, page ranges, scale, tagged PDF and outline options. width and height are selected together. Selector wait, load mode, delay and cache belong at the top level of settings. Supply prebuilt HTML when the upstream workflow uses Markdown.

PDFMint places page settings in settings.options, including printBackground, mediaType, headerHtml, footerHtml and pageNumbers. strict and javascript are top-level fields. css and googleFonts apply only to Markdown; HTML carries its styling in its own source. The selected provider timeout must fit the merchant's request deadline.

Sources and defaults are [MintPDF OpenAPI](https://mintpdf.dev/openapi.json), [snaplab docs](https://snaplab.dev/docs) and [PDFMint docs](https://pdf.mintapis.com/docs).

| Selected integration | Default maximum source bytes | Encoded request ceiling |
| --- | ---: | ---: |
| MintPDF | 512,000 | 900,000 |
| snaplab | 1,500,000 | 2,000,000 |
| PDFMint | 10,000,000 | 12,000,000 |

The MintPDF limits are this integration's explicit selection because its public OpenAPI omits a body-size ceiling. snaplab documents HTML up to 2 MB; this integration leaves JSON-envelope room. PDFMint documents a 10 MB HTML limit and 12 MB body limit. Escaped characters can enlarge JSON beyond the source byte count, so the complete encoded body is checked before dispatch.

The default PDF receiving allowance is 32 MiB. The combined required files fit the original 64 MiB Jobs package ceiling, with room retained for metadata and the native package manifest. The response is streamed to its complete declared limit and checked as PDF bytes. Full-source UTF-8 decoding preserves the original source bytes in delivery.

Each provider renders document-supplied content in its own service. Select source and external assets that the customer intends that renderer to receive. The supplied examples use inline CSS and ordinary system fonts without external image or document fetches.

## 8. Continue an interrupted request

The original Jobs and customer journals own recovery. A request that already exists continues with its original job and checkout identity.

| Observation | Existing operation |
| --- | --- |
| Source upload incomplete | Reopen the saved Request and continue its existing missing chunks |
| Checkout response lost | Use that request's original checkout-recover operation |
| Supplier rejects authentication, subscription, rate or capacity | Correct the original account/runtime selection and inspect the retained job |
| Supplier response lost after dispatch | Inspect the original job, supplier usage and any actual supplier request ID before deciding to render again |
| PDF received but customer transfer incomplete | Fetch the existing completed job and named outputs again |
| Customer needs cancellation, refund or restoration | Use original Jobs resolution and maintained recovery flows |

### Read the original paid-job failure category

The original Jobs worker records a supported failure category when a paid application fails. This adapter maps the supplier result at that boundary so the job explains the required recovery action. A direct renderer call retains the original `DOCUMENT_*` error, HTTP status and returned supplier identifiers; a native paid job retains the category below.

| Native job category | Merchant action |
| --- | --- |
| `JOB_NATIVE_DOCUMENT_AUTHENTICATION` | Inspect the selected provider key environment and the original supplier account |
| `JOB_NATIVE_DOCUMENT_SUBSCRIPTION` | Inspect the original account's plan and billing response |
| `JOB_NATIVE_DOCUMENT_RATE_OR_QUOTA` | Read the selected supplier's account usage and actual allowance before an explicit continuation |
| `JOB_NATIVE_DOCUMENT_CAPACITY` or `JOB_NATIVE_DOCUMENT_HTTP_FAILURE` | Review the original supplier response and service availability |
| `JOB_NATIVE_DOCUMENT_RESPONSE_UNCERTAIN` or `JOB_NATIVE_DOCUMENT_TIMEOUT` | Reconcile the original attempt and supplier usage because a dispatched render may have consumed a unit |
| `JOB_INPUT_DOCUMENT_PROVIDER_REJECTED`, `JOB_INPUT_DOCUMENT_SETTINGS` or `JOB_INPUT_DOCUMENT_PAGE_DIMENSIONS` | Review the original input and the selected provider's declared settings before preparing a corrected request |
| Other `JOB_INPUT_DOCUMENT_*` categories | Inspect the original sealed source file's type, bytes, size and format |
| `JOB_OUTPUT_DOCUMENT_INTERRUPTED` or `JOB_OUTPUT_DOCUMENT_INCOMPLETE` | Keep the original attempt while resolving the partial PDF receipt |
| `JOB_OUTPUT_DOCUMENT_TOO_LARGE` or `JOB_OUTPUT_DOCUMENT_METADATA_LIMIT` | Compare the selected complete-output allowance with the actual response |
| `JOB_OUTPUT_DOCUMENT_PDF_INVALID` | Inspect the original supplier response; its returned body did not satisfy the binary-PDF contract |
| `JOB_NATIVE_DOCUMENT_CONFIGURATION` | Inspect the immutable generated application and its selected provider configuration |

The worker's original transport stores the category, not arbitrary HTTP headers or error causes. Use the existing supplier account operation and any original direct-run failure file for available request identifiers and allowance details. Original Jobs cancellation and sealed-input failures keep their native categories.

The application performs one provider request per execution. It never automatically resends a possibly accepted render. An explicit native job retry can consume another supplier unit; the merchant retains that decision with the existing job.

The original setup can be inspected while offline. It does not need a provider request to disclose its chosen source, payment terms, file policies or declared credential names.

## First customer outcome

A useful first task starts from a report or invoice template the customer already produces. Select the renderer that accepts that source, prepare one actual paid request, and receive the complete PDF plus its editable source into the customer's existing library. Review the entire output with the customer and retain the original task reference for the next reporting cycle.

A merchant can then price repeat use from actual returned supplier usage and its provider account. Whole-task completion and repeat-customer adoption come from the original buyer workflow. The grant's paid-purchase, parent-task and prepaid-consumption records keep their existing counting rules.

## Compose the customer's dataset and templates

Use [COMPOSITION.md](COMPOSITION.md) when the customer starts with order rows, report data or another complete CSV/JSON export. It covers grouping line items, choosing optional documents, escaped HTML/Markdown templates, source preview and exact native batch preparation. Preparation preserves the full original dataset and templates; interruption resumes the same source and customer batch. The actual native quote determines the amount for all generated documents before rendering. Receiving and Collection export retain the complete PDF, source and original dataset/template handover.

~~~sh
starforge document-merchant compose --help
~~~

## Operate the customer's document workspace

The installed **Document production** application combines the dataset/template workflow with the customer's original authenticated workspace. Its local `/documents/` page uses the same original customer, native Checkout and Resource library as Request and Jobs. The complete private customer-options JSON supplies the original state, nested Checkout/operator configuration and allowed file roots.

~~~sh
starforge document-merchant compose inspect-service \
  --workspace-options /srv/starforge/private/customer-options.json \
  --provider snaplab \
  --merchant-origin https://YOUR_MERCHANT_ORIGIN

starforge document-merchant compose serve \
  --workspace-options /srv/starforge/private/customer-options.json \
  --provider snaplab \
  --merchant-origin https://YOUR_MERCHANT_ORIGIN
~~~

Use the actual configured provider and commissioned merchant origin. The service returns its original authenticated launch and the document page. In Applications, select **Document production**, the same private options file, and the same customer source directory. Start and Stop retain that customer's original payment, request, job and received-file history.

Choose a saved dataset and template recipe or start from the complete shipped examples. Each uploaded file is received in full. Review the generated document count and parent task references, then select **Prepare merchant price**. This runs the original Request preparation and shows the native quote grouped by network, asset, recipient and payment flow. **Render at this saved price** executes that saved plan through the original customer. The page receives complete binary PDFs through the existing resource downloads and can export the original Collection with all source data, templates and native result files.

Large source plans can be received from an original local file inside an allowed customer file root. After an interrupted rendering, reopen the same saved composition and continue its original jobs or receive accepted work. An interrupted Collection export continues in its retained original export directory. The [complete composition guide](COMPOSITION.md) gives the private options shape, every browser action and the equivalent installed commands.

## Fulfill and deliver complete document batches

Use [BATCHES.md](BATCHES.md) for a customer's complete order or reporting period. The installed `document-merchant batch` workflow stages whole HTML/Markdown sources, reviews every native document price, continues the original payment and job records, receives all four output files, and exports one portable Resource library Collection with a complete customer table. It includes full invoice and greeting-card source for one shared task, plus commands for interrupted preparation, checkout recovery, partial file receiving and independent Collection receiving.

~~~sh
starforge document-merchant batch --help
~~~


## Operate through Applications

Use the [complete Applications guide](APPLICATIONS.md) to review a new document configuration or reopen a prepared one from the saved Document merchant application. Start retains the supplier plan, native price and original factory, starts the existing Jobs seller/customer/operator/worker, and returns the authenticated operator. Stop and later Start use the same merchant and job history. `document-merchant inspect-service` presents the complete read-only selection; `document-merchant launch` operates that setup and service in the foreground.


## Ordered invoice and report bundles

After receiving the original PDFs, use the same Document production browser's Ordered PDF bundle step or `document-merchant assemble` to prepare exact customer order, review the original assembly price, fulfill and receive every volume, and export one complete customer archive. The PDFMint-backed `assemblePdfs` function is enabled explicitly with its own native payment terms. Single-PDF volumes retain their original bytes without a merge purchase. See [ASSEMBLY.md](./ASSEMBLY.md) for complete merchant setup, local/batch source intake, CLI commands, continuation, output units and independent customer receiving.

## Reuse an existing commerce installation

The [commissioning workflow](COMMISSIONING.md) reads a retained original sf66 commerce setup, selects its exact native offer, reuses the existing funded operator and facilitator, and prepares the complete document merchant and customer options. `document-merchant commission` covers source review, resumable setup, inspection and the original service lifetime. The generated Case Desk options connect a saved customer HTML edition directly to the maintained paid PDF receiving and attachment workflow.

### Existing native account profile

The same `commission review` and `commission prepare` commands accept `--account-source FILE` for an existing native operator profile and facilitator policy. This retains the original payer, signer, operator policy and spending ledger while creating the document service and complete customer/Case Desk settings. See [direct account commissioning](COMMISSIONING.md#use-an-existing-operator-account-directly) for the full source contract and operating commands.
