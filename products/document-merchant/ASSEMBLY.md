# Ordered PDF bundles

Use the installed document merchant to turn completed customer PDFs into an ordered invoice, report or document bundle. Each merge runs through the same original Request, Checkout, Jobs and Resource library used for rendering. The customer receives every final volume, every original PDF, the actual native receiving records and an independently editable source plan.

A nightly invoice bundle is the primary workflow: render one invoice for every selected order, receive the complete PDFs, select those invoice documents in business order, review the assembly merchant's actual price, assemble, and download the complete customer archive. Greeting cards can remain a separate template selection and delivery.

## Supplier and merchant configuration

The assembly function uses the original PDFMint service at [pdf.mintapis.com/docs#merge](https://pdf.mintapis.com/docs#merge), checked on 2026-10-13. This is the separate PDFMint account at pdf.mintapis.com. Its contract is:

| Item | Original contract |
| --- | --- |
| Endpoint | POST https://pdf.mintapis.com/v1/merge |
| Account | Bearer key in the merchant's configured private environment variable |
| Inputs | 2–50 complete PDFs, in array order |
| Selected transport | JSON files containing full base64 bytes, output binary |
| Source metadata | filename document.pdf, title and optional author/subject/keywords |
| Strict handling | strict true by default |
| Supplier unit | One credit per successful merge call, irrespective of input file count or PDF pages |
| Whole request limit | 12,000,000 bytes |

See the same official [limits](https://pdf.mintapis.com/docs#limits) and [quota](https://pdf.mintapis.com/docs#quota) sections when selecting the current account plan. The live supplier response and its account counters remain the usage source. Original documents, supplier credits, native purchases, PDF pages and accepted parent tasks are separate quantities.

Enable assembly explicitly in a PDFMint merchant template:

~~~sh
document-merchant template --provider pdfmint --assembly --out /private/pdfmint-merchant.json
~~~

Fill the existing publicOrigin, native payment and provider account settings. The additional assembly.payment is a complete independent original native payment object. Select the actual asset, recipient, network and atomic amount for one merged volume; it can differ from the existing per-render payment. No amount or conversion is inferred from the provider's USD plan.

~~~json
{
  "assembly": {
    "payment": {
      "scheme": "exact",
      "network": "stellar:testnet",
      "asset": "ACTUAL_ASSET",
      "payTo": "ACTUAL_RECIPIENT",
      "amount": "ACTUAL_ATOMIC_AMOUNT",
      "maxTimeoutSeconds": 120
    }
  }
}
~~~

Use the normal review, prepare and launch commands with that complete request. The original compiler validates every native term. The installed function is assemblePdfs at the merchant's retained pathPrefix plus /pdf-set. It accepts one source file with application/json and returns the same four complete output slots: document.pdf, source.json, request.json and render.json.

Assembly is opt-in. Existing setup plans without an assembly property keep their original normalized request and generated function list. Existing prepared installations retain their original application bytes. To offer the new function, select an appropriately prepared new merchant setup through the existing review and deployment process; do not mutate a retained setup plan or original paid job.

The provider key stays in the configured environment. The customer accesses the merchant's public catalog and original checkout; it does not receive the supplier key.

## Browser workflow

Open the existing **Document production** application. Its dataset/template, source, merchant price and rendering steps are unchanged.

1. Complete rendering and receiving for the document set. Every selected invoice must have its full PDF received.
2. In **Ordered PDF bundle**, enter a bundle ID, customer-facing name, title, original task reference and the actual PDFMint-backed assembly merchant origin.
3. Select the invoice template, or leave all templates selected. The default order is the complete composition order. To choose a different order, paste the exact document IDs in the order required. Each source appears once.
4. Choose **Prepare ordered PDF bundle**. The browser reads every page of the saved document selection and the controller receives the complete original PDF bytes. The saved source identity pins the composition, original batch and document order.
5. Open the saved bundle and choose **Prepare assembly price**. Review its actual network, asset, recipient, maximum atomic amount and complete native plan SHA.
6. Choose **Assemble at this saved price**. This runs the exact prepared native plan through the existing customer owner.
7. If a job continues after the current wait, choose **Receive existing assemblies** or continue the original run as indicated. Existing request, ticket and job identities remain authoritative.
8. Download a received volume, or choose **Export complete PDF bundle** when every volume has arrived. **Download complete PDF bundle** returns the whole archive, including source and native Collection.

The exact price review occurs before the original native purchase. Background work belongs to the same original customer host and shuts down with that owner. Download routes use the original authenticated whole-file delivery path; customer data is never a public static browser asset.

If the document set was rendered by MintPDF or snaplab, assembly can use the same customer's separately selected PDFMint-backed merchant. The original source origin and paid job references remain pinned in the bundle.

## Source, volume and payment units

The complete source plan is assembly-plan.json. It contains the original full PDF bytes, filename, exact byte count and SHA256 for every selected document, plus the ordered volume layout and original task reference. It also retains the exact originating batch and composition identities when sourced from an existing document set.

The installed source limits are:

| Scope | Allowance |
| --- | --- |
| One source PDF | Up to 32 MiB |
| One bundle | Up to 2,000 original PDFs and 96 MiB of original PDF bytes |
| Complete source plan | Up to 192 MiB |
| One paid volume | 2–50 PDFs; source JSON at or below selected maxVolumeBytes |
| Default volume source JSON | 10,000,000 bytes |
| Supplier request body | At or below the original 12,000,000-byte limit |
| Complete customer archive | Up to 2 GiB, or a smaller selected allowance |

Source JSON includes base64 encoding and metadata. The volume planner measures those complete encoded bytes; it never estimates from file counts alone.

Every input remains in customer order. When a set exceeds a volume limit it becomes multiple ordered volumes. Where possible, the final single file is paired with the previous volume's last file without changing overall order. If only one file fits a volume, that volume is the exact original PDF, with no supplier merge or new native purchase. A large single PDF can therefore be delivered unchanged even when it cannot share a source packet with another file.

For 51 small PDFs, the normal layout is 49 followed by 2. For 101 small PDFs it is 50, 49, 2. Exact encoded-size limits can produce different boundaries. The displayed counts and prepared native quote are authoritative for the actual selection.

A merge volume is one original paid assembly request. The returned record separately retains how many source PDFs it contains. A 50-PDF volume consumes one documented successful supplier merge credit; its 50 documents and any page count do not become 50 native purchases. Returning a bundle does not automatically mark the original business task accepted.

## Complete CLI operation

The same installed command exposes assemble. All paths below are examples to replace with actual owned private paths. Reuse the original full customer options JSON, including its nested checkout object.

### Stage existing received document jobs

Create the assembly request from an installed merchant:

~~~sh
document-merchant assemble template \
  --merchant-directory /private/merchant/pdfmint \
  --out /private/customer/invoice-bundle-request.json
~~~

Edit its customer-facing name, original task reference and ID. The template selects the actual installed merchant origin and confirms assemblePdfs is available.

Write the ordered original batch document IDs as one complete JSON array:

~~~json
["order-001-invoice", "order-002-invoice", "order-003-invoice"]
~~~

Select the exact saved batch plan SHA and prepare the full source bundle:

~~~sh
document-merchant assemble from-batch \
  --workspace-options /private/customer-options.json \
  --directory /private/customer/artifacts/invoice-bundle \
  --request /private/customer/invoice-bundle-request.json \
  --batch-directory /private/customer/artifacts/orders/batch \
  --batch-sha256 EXACT_ORIGINAL_BATCH_SHA256 \
  --items /private/customer/invoice-document-ids.json
~~~

The native receiving records supply each PDF path, resource ID, complete bytes and identity. Every selected original job must already be fully received. There is no second render or silent substitution.

### Stage original local PDFs

For customer PDFs already present under the original customer's allowed file roots, supply a complete file list:

~~~json
[
  {
    "id": "invoice-001",
    "path": "/private/customer/artifacts/invoice-001.pdf",
    "filename": "invoice-001.pdf",
    "reference": "original-order-001"
  },
  {
    "id": "invoice-002",
    "path": "/private/customer/artifacts/invoice-002.pdf",
    "filename": "invoice-002.pdf",
    "reference": "original-order-002"
  }
]
~~~

Optional bytes and sha256 select previously measured source identities. If supplied, both must match the original full file.

~~~sh
document-merchant assemble stage \
  --workspace-options /private/customer-options.json \
  --directory /private/customer/artifacts/invoice-bundle \
  --request /private/customer/invoice-bundle-request.json \
  --files /private/customer/invoice-files.json
~~~

Both staging commands return the complete source SHA, counts and volume order. They preserve the original source plan on a repeated identical call. A changed source requires a new explicit bundle ID/directory; a saved customer selection is never silently replaced.

### Inspect source and prepare native price

~~~sh
document-merchant assemble source \
  --directory /private/customer/artifacts/invoice-bundle \
  --sha256 EXACT_COMPLETE_SOURCE_SHA256

document-merchant assemble prepare \
  --workspace-options /private/customer-options.json \
  --directory /private/customer/artifacts/invoice-bundle \
  --sha256 EXACT_COMPLETE_SOURCE_SHA256
~~~

The source command is read-only and opens no customer. Preparation uses the original merchant catalog, input-file upload and Request engine. It returns the saved native batch directory, plan SHA and exact grouped price totals. If every volume is unchanged, there is no native batch or merge payment.

For a merchant requiring an intake access key, add --intake-key-env ORIGINAL_ENVIRONMENT_NAME to prepare and run. The value stays in the private environment.

### Review and fulfill

~~~sh
document-merchant assemble review \
  --workspace-options /private/customer-options.json \
  --directory /private/customer/artifacts/invoice-bundle \
  --sha256 EXACT_COMPLETE_SOURCE_SHA256 \
  --out /private/customer/reviews/invoice-bundle

document-merchant assemble run \
  --workspace-options /private/customer-options.json \
  --directory /private/customer/artifacts/invoice-bundle \
  --sha256 EXACT_COMPLETE_SOURCE_SHA256 \
  --approve-plan EXACT_RETURNED_NATIVE_PLAN_SHA256
~~~

The full review includes assembly-review.json and the original batch's JSON, CSV, readable HTML and native plan. The command checks approval syntax before opening the customer and exact plan equality before entering the original native run.

The existing native operator handles settlement, ticket, job execution and full output receiving. Run does not automatically retry an uncertain supplier response. Original job/native errors remain available for explicit continuation through the maintained customer workflow.

If the configured wait expires while jobs continue, run retains the original requests and returns exit code 2 with unfinished volumes. To receive already accepted jobs:

~~~sh
document-merchant assemble receive \
  --workspace-options /private/customer-options.json \
  --directory /private/customer/artifacts/invoice-bundle \
  --sha256 EXACT_COMPLETE_SOURCE_SHA256
~~~

Use --deadline-ms and --poll-ms only to change the current wait. Neither changes the saved source, quote or customer task. Ctrl-C aborts the current wait and closes the owned customer while preserving its journals.

Open the same original customer Checkout when its normal payment review is needed:

~~~sh
document-merchant assemble open \
  --workspace-options /private/customer-options.json \
  --directory /private/customer/artifacts/invoice-bundle \
  --sha256 EXACT_COMPLETE_SOURCE_SHA256
~~~

### Export the complete delivery

~~~sh
document-merchant assemble export \
  --workspace-options /private/customer-options.json \
  --directory /private/customer/artifacts/invoice-bundle \
  --sha256 EXACT_COMPLETE_SOURCE_SHA256 \
  --out /private/customer/deliveries/invoice-bundle
~~~

Export requires every paid volume's complete four-file receiving. The customer gets:

| File | Contents |
| --- | --- |
| complete-pdf-bundle.tar | All files below, with original byte identities |
| index.html | Readable ordered volume list and PDF links |
| pdfs/volume-NNNN.pdf | Every complete final PDF in customer order |
| assembly-plan.json | Every original source PDF, selected order, layout and task |
| assembly-delivery.json | Delivery metadata and each file identity |
| assembly-results.csv | Ordered volume and source membership table |
| native/documents.tar | The original paid-job Resource Collection, when merges were required |
| native/batch-plan.json | The exact original native price and request selection |
| native/batch-results.json, .csv and batch-review.html | Complete original native receiving records |
| native/batch-export.json | Original Collection edition and archive identity |

assembly-archive.json remains next to the customer archive and identifies its whole-byte SHA and delivery manifest. The archive is standard POSIX ustar with complete nested Collection bytes. It is an artifact of the existing source/receiving workflow, not another payment or job database.

The original Collection edition is retained during a repeated export. Later resource annotations do not rewrite a previously delivered customer edition. An interrupted export can continue in its original directory. The writer compares existing complete bytes rather than overwriting a changed file.

A bundle with only unchanged volumes exports the same complete source and final PDFs without a native Collection, because it did not create paid merge jobs.

## Receiving on another machine

Extract complete-pdf-bundle.tar with a standard tar application. index.html opens directly and links to every final PDF. The full original PDFs are retained in the complete source plan; they can be materialized into a new owned source directory using its exact SHA:

~~~sh
document-merchant assemble receive-source \
  --source /private/received/assembly-plan.json \
  --directory /private/customer/artifacts/received-invoice-bundle \
  --sha256 EXACT_COMPLETE_SOURCE_SHA256
~~~

Receiving the source preserves its exact portable plan and byte identity. It does not purchase anything or invent the former customer's local native journal.

The existing native Collection can be independently received through the original library:

~~~sh
document-merchant assemble receive-collection \
  --archive /private/received/native/documents.tar \
  --destination /private/received/native-library \
  --library-state /private/received/native-library-state \
  --sha256 EXACT_ORIGINAL_COLLECTION_SHA256
~~~

That command returns the original Collection and independent library status. It uses the maintained original Collection receiver.

## Operating behavior

The worker receives one complete ordered source JSON, validates each original PDF's full bytes and SHA, then makes one supplier request. It receives the entire binary PDF and all response counters before completing the original job. Returned source.json is the complete exact customer source, including every original PDF, rather than a URL list that could change later.

Supplier authentication, quota, input, uncertain response and interrupted output errors retain the existing native Worker categories. A supplier may have accepted a request even when its response was lost. The current job and account usage determine explicit recovery; automatic duplicate merge calls are not introduced.

File counts and raw-byte limits are local source allowances. The provider request is measured separately. Final PDFs retain the configured maxPdfBytes output allowance. A source set that exceeds the local complete-plan limit should be deliberately divided into separate original business selections; the application does not truncate it.

The merchant application, customer source, native price plan, original paid output, source plan and delivery artifact each retain their actual identity. The application’s existing shutdown order stops HTTP admission, drains document operations, then closes the original customer. Every browser and CLI route uses those same owners.
