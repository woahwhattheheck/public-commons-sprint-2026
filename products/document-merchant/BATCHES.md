# Fulfill a document batch

A batch connects a customer's set of reports, invoices or cards to the installed document merchant. It stages every complete source file, shows every native price, continues the original checkout for each document, receives all four output files, and exports one portable Resource library Collection.

Install the complete `document-merchant` selection and commission the merchant with [OPERATING.md](OPERATING.md). The commands below use that same package, merchant and customer runtime.

## 1. Select the existing customer workspace

Create a private JSON file containing the options for the original Job customer workspace. For example:

~~~json
{
  "directory": "/srv/starforge/document-customer",
  "fileRoots": ["/srv/starforge/document-sources"],
  "maxConcurrent": 1,
  "checkout": {
    "operatorWorkspace": "/srv/starforge/operator-workspace"
  }
}
~~~

Use the actual existing customer directory and native operator selection. When reopening a workspace, retain its original file roots, buyer roots and checkout selection. The original customer model rejects conflicting roots. Put source documents inside an existing allowed file root. The file must be private to the operating user; it may contain the original transport or environment options needed by that runtime.

The complete options contract is the original [Job workspace API](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/index.d.mts). A saved operator profile can be selected with `checkout.operatorProfile` in place of `operatorWorkspace`. The native signer, budget and settlement runtime remain in that original operator selection.

A workspace has one process owner. Finish a batch command before opening its browser or another command over the same directory. Each command closes the model and its native tasks before returning.

## 2. Prepare complete customer source

The installed merchant can supply a template with its actual origin and supported formats:

~~~sh
starforge document-merchant batch template \
  --merchant-directory /srv/starforge/document-merchant \
  --out /srv/starforge/batch-input/order-1042.json
~~~

A remote customer can use `--provider mintpdf`, `--provider snaplab` or `--provider pdfmint` instead. Set the actual commissioned merchant HTTPS origin before preparing.

A two-document customer task looks like this:

~~~json
{
  "schema": "stellar-forge.document-batch.v1",
  "id": "order-1042",
  "name": "Order 1042 invoice and greeting card",
  "provider": "mintpdf",
  "merchantOrigin": "https://documents.example.com",
  "documents": [
    {
      "id": "invoice",
      "label": "Order 1042 invoice",
      "source": "order-1042/invoice.html",
      "format": "html",
      "input": {
        "title": "Order 1042 invoice",
        "taskReference": "order-1042"
      }
    },
    {
      "id": "greeting",
      "label": "Order 1042 greeting card",
      "source": "order-1042/greeting.html",
      "format": "html",
      "input": {
        "title": "Order 1042 greeting card",
        "taskReference": "order-1042"
      }
    }
  ]
}
~~~

Replace the example origin with the actual merchant. An input file names source paths relative to `--source-root`; paths cannot leave that root. Both documents share the original parent task reference. The batch keeps those references in its complete results, independently of the number of PDF pages or provider units.

The package includes complete sample source in [examples/batch/invoice.html](examples/batch/invoice.html) and [examples/batch/greeting.html](examples/batch/greeting.html), plus a matching [order.json](examples/batch/order.json). These sample documents use demonstration order data. Replace their contents with the customer's real input before paid fulfillment. HTML can contain the existing template, images and print CSS. MintPDF and PDFMint also accept complete Markdown; snaplab uses HTML. Provider-specific settings go in each document's `input.settings`, using the original installed provider contract.

A batch accepts 1–2,000 named documents, within the retained JSON and original customer capacity limits. Source byte and output limits come from the discovered merchant function. Split a larger operational period into named customer batches while keeping each original order's task reference. The batch issues native checkouts sequentially and respects the original merchant worker capacity and provider admission responses.

## 3. Stage the source and review the complete price

~~~sh
starforge document-merchant batch prepare \
  --request /srv/starforge/batch-input/order-1042.json \
  --source-root /srv/starforge/document-sources \
  --directory /srv/starforge/document-batches/order-1042 \
  --workspace-options /srv/starforge/customer-options.json
~~~

Preparation reads the actual merchant catalog and validates each requested document function and its four-file output policy. It reads each whole UTF-8 source, checks the native provider request size and settings, then stages the bytes through the original Request input-file controller. Original file roots, revision checks and source descriptors apply. No document purchase occurs during preparation.

The immutable `batch-plan.json` contains the complete catalog, original source descriptors and request IDs, selected input, native price per document, and total maxima grouped by scheme, network, asset, recipient and payment flow. The command returns `planSha256` for that exact saved plan. All source bytes stay in their original native input-file storage.

Inspect the batch or create a readable review:

~~~sh
starforge document-merchant batch show \
  --directory /srv/starforge/document-batches/order-1042 \
  --workspace-options /srv/starforge/customer-options.json

starforge document-merchant batch review \
  --directory /srv/starforge/document-batches/order-1042 \
  --workspace-options /srv/starforge/customer-options.json \
  --out /srv/starforge/document-reviews/order-1042-before-payment
~~~

Open `batch-review.html`. It shows every named document and source, the native maximum in its original asset, the recipient, the current checkout and receiving state, and the document set for each parent task. `batch-results.csv` provides the same complete row mapping for customer operations. Use a new review output directory for a later observation; the earlier review remains readable.

Supplier subscription prices, native merchant prices, native budget and customer task counts are separate quantities. A document is one merchant request and one four-file package. Its renderer may account for units differently, such as snaplab cache hits. Use `document-merchant usage` and `document-merchant price` with the actual merchant account to inspect that side of the operation.

## 4. Fulfill the reviewed plan

~~~sh
starforge document-merchant batch run \
  --directory /srv/starforge/document-batches/order-1042 \
  --workspace-options /srv/starforge/customer-options.json \
  --approve-plan EXACT_PLAN_SHA256
~~~

The exact saved plan is the explicit scope of this batch purchase. The command re-reads every native request and source binding before the first payment. For each document it prepares or imports the original merchant ticket, reviews the original Checkout, and binds its payment to the plan's input, native asset, recipient, maximum, payment flow and purchase route.

The original native approval broker receives each approval. The controller checks that the request, body, task and native terms still match and that the original budget estimator approves the purchase. Existing native attempts use the original recovery operation. A changed source, ticket, price or native approval returns a concrete continuation error; it does not replace the accepted plan.

After the original checkout accepts a job, the command uses the existing Jobs fetch task to receive the archive and its four output files. A partial file receiving operation continues even when the result archive was already downloaded. The batch marks a document received only when the original output receiver reports the full package received.

Optional settings:

~~~sh
starforge document-merchant batch run \
  --directory /srv/starforge/document-batches/order-1042 \
  --workspace-options /srv/starforge/customer-options.json \
  --approve-plan EXACT_PLAN_SHA256 \
  --deadline-ms 600000 \
  --poll-ms 1500 \
  --intake-key-env DOCUMENT_CUSTOMER_INTAKE_KEY
~~~

Use the intake key only when the existing merchant requires it. It is read from the named environment variable and passed to the original Request controller. The batch plan never contains its value. Deadline and poll options apply to each original job receiving task.

An actual renderer authentication, subscription, quota, capacity or native budget failure stops new document purchases for the remainder of that run. The operation result identifies the originating document, native error, completed outcomes and unvisited requests. Fix the returned account or native operation through its existing owner and continue the same plan. A renderer failure after payment remains attached to that original job; its existing merchant retry, receiving or resolution workflow owns continuation. Repeated batch execution does not clear native attempt records.

The command emits progress to stderr and the complete final observation to stdout. Ctrl-C cancels the active original task with its actual task ID and retains the requests, native attempt, completed packages and source selections.

## 5. Continue an interrupted delivery

Re-run `run` with the same plan and hash to continue its original checkout and receiving records. Re-running `prepare` with the same input and directory reopens the saved plan. If preparation was interrupted after staging a source but before saving the plan, it locates the existing original Request and retains that source selection. Changing the external file later does not silently change the prepared source.

To fetch outputs for jobs that already have an accepted checkout, use:

~~~sh
starforge document-merchant batch receive \
  --directory /srv/starforge/document-batches/order-1042 \
  --workspace-options /srv/starforge/customer-options.json \
  --deadline-ms 600000
~~~

This command continues receiving from the existing jobs. It does not initiate purchases for unaccepted requests.

Open the original applications when a task needs operator attention:

~~~sh
starforge document-merchant batch open \
  --directory /srv/starforge/document-batches/order-1042 \
  --workspace-options /srv/starforge/customer-options.json
~~~

The returned private URL opens the existing Checkout application, with its Request, Jobs, result receiving, Resource library and Collections routes. Inspect the actual native failure or merchant resolution there, then resume the same batch. A newly requested document or explicitly changed input belongs in a new customer batch identity after the earlier operation is resolved.

## 6. Deliver one complete collection

~~~sh
starforge document-merchant batch export \
  --directory /srv/starforge/document-batches/order-1042 \
  --workspace-options /srv/starforge/customer-options.json \
  --out /srv/starforge/document-deliveries/order-1042-r1
~~~

Export reads the original customer resource index, then saves a Collection in its existing database. Each received document contributes its result package and the four named files: the complete PDF, editable source, request, and renderer details. User edits to the Collection name, note and related members remain present. The native Collection archive reuses identical objects by content identity.

The complete delivery directory contains:

| File | Customer use |
| --- | --- |
| `documents.tar` | Original portable Resource library Collection with all received outputs |
| `batch-export.json` | Collection identity and revision, exact archive bytes and SHA256, and accompanying file identities |
| `batch-plan.json` | Original requested work, source selection and reviewed native payment maxima |
| `batch-results.json` | Complete observation of each original request, checkout, native settlement and output |
| `batch-results.csv` | Spreadsheet-ready mapping from document and task to its PDF and original operations |
| `batch-review.html` | Readable customer batch with every document and parent task set |

Export can include the received portion of a longer batch; `receivedDocuments` and every row state make the contents explicit. The original archive only includes fully received outputs. To deliver a later set or a changed Collection revision, choose a new export directory. Reopening an interrupted export with the same native edition finishes the same archive and reports.

On another installed customer machine:

~~~sh
starforge document-merchant batch receive-collection \
  --archive /incoming/order-1042-r1/documents.tar \
  --destination /srv/starforge/received/order-1042-r1 \
  --library-state /srv/starforge/received-libraries/order-1042-r1 \
  --sha256 EXACT_ARCHIVE_SHA256
~~~

Read the exact archive SHA256 from `batch-export.json`. The original collection receiver validates the incoming archive and every file, supports reopening the same receiving directory, and opens the received Collection in the normal Resource library. A receiver can browse and export those files using the original library commands without access to the merchant or sender's workspace.

Document receiving and parent task acceptance have their own meanings. An invoice and greeting card can form a complete document set for one order. Customer acceptance belongs to the original customer workflow and is retained as unknown in this batch snapshot until that workflow records it.

## Implementation and source

The installed CLI dispatches to `batch-cli.mjs` and `batch.mjs`. The public API is exported from the existing document-merchant module. The original Request, Checkout, Jobs, result and Collection APIs remain authoritative; the batch adds an immutable selection and explicit review/delivery files.

Provider behavior uses the same complete documented renderer contracts as the merchant: [MintPDF OpenAPI](https://mintpdf.dev/openapi.json), [snaplab API reference](https://snaplab.dev/docs), and [PDFMint API reference](https://pdf.mintapis.com/docs), read 12 October 2026.
