# Document merchant

Sell document generation through the existing Stellar paid Jobs service. A customer supplies a complete HTML or Markdown file, reviews the original payment, and receives a PDF together with the unchanged editable source and complete request metadata.

The product supplies the renderer configuration and application for three existing services:

| Service | Source input | Native endpoint | Supplier unit |
| --- | --- | --- | --- |
| [MintPDF](https://mintpdf.dev/openapi.json) | HTML or Markdown | POST https://mintpdf.dev/v1/pdf | Render |
| [snaplab](https://snaplab.dev/docs) | HTML | POST https://snaplab.dev/api/render | Successful non-cached render; a cache hit is free |
| [PDFMint](https://pdf.mintapis.com/docs) | HTML or Markdown | POST https://pdf.mintapis.com/v1/pdf | Successful document, regardless of page count |

Provider contracts and plan data were read on **12 October 2026**. MintPDF and PDFMint are separate services with separate keys and plans. The installed provider catalog includes the original source URLs and selected limits.

## Install and run

Use the maintained merchant package or its source checkout. Build `--selection document-merchant` for the complete document service with its original customer and merchant interfaces. The [build and installation instructions](OPERATING.md#build-and-install-the-complete-document-package) cover the archive, direct executable and existing private runtime installer. The distribution contribution registers the command and typed package export:

~~~sh
starforge document-merchant template --provider mintpdf --out /srv/starforge/document-input/setup.json
~~~

Set the template's actual HTTPS merchant origin, settlement network, asset, recipient and per-document amount. Choose the provider plan already held by the merchant and name its key environment variable. Then prepare and run the original paid service:

~~~sh
starforge document-merchant prepare \
  --request /srv/starforge/document-input/setup.json \
  --directory /srv/starforge/documents

starforge document-merchant serve \
  --directory /srv/starforge/documents \
  --native-factory /srv/starforge/native-runtime.mjs \
  --start-worker
~~~

From a source checkout the same entrypoint is:

~~~sh
node products/document-merchant/cli.mjs --help
~~~

The complete [operating guide](OPERATING.md) covers credentials, pricing, private file input, native customer checkout, complete result receiving and the original recovery operations.

## What the customer receives

Every successful document request returns the original Jobs package with four required named files:

| Slot | File | Use |
| --- | --- | --- |
| pdf | document.pdf | Finished PDF bytes |
| source | source.html or source.md | Unchanged complete editable source |
| request | request.json | Original task reference, input and effective renderer settings |
| render | render.json | Actual provider request and response metadata, source and PDF identity, and returned usage |

The existing request, sealed input-file store, checkout, paid job, native settlement outbox, named-result package and customer resource library retain their original ownership. A provider key stays in the merchant's selected environment. The customer submits the whole file through the existing Request application.

A paid request produces one document package. Several requests can belong to one larger customer task. The task reference, complete buyer acceptance, original merchant payment, supplier usage and PDF page count remain separate quantities.

## Files

- contracts.mjs defines supported provider input, native request bodies, limits and dated plans.
- renderer.mjs performs one actual supplier call and receives the complete PDF.
- setup.mjs materializes a retained application and native Jobs configuration using the existing Linux lease and owned-file writer.
- cli.mjs runs setup, price review, actual supplier usage and the original merchant operator.
- examples/report.html and examples/report.md provide complete editable sample documents.
- index.mjs and index.d.mts expose the installed JavaScript and type interfaces.

The generated application contains the complete selected renderer code and provider configuration in one module. The original Jobs application hash therefore identifies the actual code used by the paid worker.

## Prepare documents from a dataset

The installed `document-merchant compose` workflow reads complete CSV or JSON data and editable HTML/Markdown templates, groups line items when required, and creates the exact source files for the existing customer batch. One order can produce an invoice and an optional greeting card under the same parent task reference. Reports can map named dataset fields into one full document per customer or period.

The [complete composition guide](COMPOSITION.md) includes JSON orders, grouped CSV order lines and CSV reports, source preview, actual native price review, original payment/job continuation and complete customer receiving. The exported Collection retains the original data, templates and every generated source alongside the PDF outputs.

~~~sh
starforge document-merchant compose --help
~~~

## Customer production browser

The saved **Document production** application opens the customer's existing Request, Checkout, Jobs and Resource library with a document workspace at `/documents/`. Choose complete CSV/JSON data and editable templates, prepare the exact document set, review its saved native price, and receive every finished PDF together with its source. The browser keeps the full dataset and source plan available for download and exports the original Collection for customer handover.

The same customer can start this workspace from the installed command:

~~~sh
starforge document-merchant compose serve \
  --workspace-options /srv/starforge/private/customer-options.json \
  --provider snaplab \
  --merchant-origin https://YOUR_MERCHANT_ORIGIN
~~~

The private options file contains the customer's complete original Jobs and nested Checkout options. Use the existing customer directory, operator and allowed file roots. The [composition guide](COMPOSITION.md) covers that configuration, saved Applications selection, complete uploads, source restoration, price review and original interrupted-job receiving.

## Customer batch fulfillment

The installed `document-merchant batch` commands turn a customer's reports, invoices or cards into a complete delivered document set. They use the original Request, native Checkout, Jobs and Resource library; the saved plan binds all source files and prices before execution. See [the complete batch workflow](BATCHES.md) for configuration, price review, continuation and portable customer delivery.

~~~sh
starforge document-merchant batch --help
~~~

## Saved Applications operation

[APPLICATIONS.md](APPLICATIONS.md) covers the complete saved Document merchant: review and prepare the provider configuration, start the original native Jobs service, open its authenticated operator, fulfill whole-file customer requests, then stop and reopen that same merchant. The installed CLI exposes `review`, `inspect-service` and `launch`; JS/TS uses the same original service lifetime.


## Ordered invoice and report bundles

After receiving the original PDFs, use the same Document production browser's Ordered PDF bundle step or `document-merchant assemble` to prepare exact customer order, review the original assembly price, fulfill and receive every volume, and export one complete customer archive. The PDFMint-backed `assemblePdfs` function is enabled explicitly with its own native payment terms. Single-PDF volumes retain their original bytes without a merge purchase. See [ASSEMBLY.md](./ASSEMBLY.md) for complete merchant setup, local/batch source intake, CLI commands, continuation, output units and independent customer receiving.

## Reuse an existing commerce installation

The [commissioning workflow](COMMISSIONING.md) reads a retained original sf66 commerce setup, selects its exact native offer, reuses the existing funded operator and facilitator, and prepares the complete document merchant and customer options. `document-merchant commission` covers source review, resumable setup, inspection and the original service lifetime. The generated Case Desk options connect a saved customer HTML edition directly to the maintained paid PDF receiving and attachment workflow.

### Existing native account profile

The same `commission review` and `commission prepare` commands accept `--account-source FILE` for an existing native operator profile and facilitator policy. This retains the original payer, signer, operator policy and spending ledger while creating the document service and complete customer/Case Desk settings. See [direct account commissioning](COMMISSIONING.md#use-an-existing-operator-account-directly) for the full source contract and operating commands.

The existing **Document merchant** Applications entry also accepts the complete commissioning options JSON. It prepares on first Start and owns the same original managed service/facilitator lifetime through Open, Stop and reopen. See [commissioning in Applications](APPLICATIONS.md#commission-the-existing-account-in-applications).

Existing invoices and reports can enter through **Bundle existing PDFs** in Document production. The browser retains their full PDF bytes and chosen order, prepares the original assembly price, follows existing paid jobs and downloads all final volumes and sources in one complete bundle. The [assembly operating guide](ASSEMBLY.md#existing-pdf-intake-in-the-customer-browser) includes uploads, large local source plans, interruption recovery and installed API use.
