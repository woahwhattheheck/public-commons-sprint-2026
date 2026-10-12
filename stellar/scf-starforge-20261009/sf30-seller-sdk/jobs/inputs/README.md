# Original input files for paid application jobs

A customer can attach original local files or verified resources from the existing customer library to a merchant function. The Request application stages the bytes privately, resumes missing chunks, transfers and seals the originals at the merchant, and prepares the original checkout. The purchased worker reads those same originals through bounded file handles.

The file descriptors are part of the existing canonical job input. Each descriptor names its exact byte count, SHA256, filename, media type and configured policy hash. The existing input hash, prepared job, private handoff and accepted job therefore keep the same file identity throughout approval, execution and result receiving.

## Run the supplied two-file application

The complete example reconciles invoice lines against a supplier price book:

| File | Purpose |
| --- | --- |
| example-application.mjs | Stream the invoice ledger and compute exact comparisons. |
| example-merchant.json | Configure the function, file slots, output and original payment terms. |
| example-input.json | Name the report and select the exception detail limit. |
| example-ledger.ndjson | Six original invoice lines covering matches and four kinds of discrepancy. |
| example-prices.json | Original unit prices by SKU and currency. |

Copy these files together into a merchant-owned directory. Set example-merchant.json's publicOrigin and payment fields to that merchant's actual HTTPS origin, network, asset, recipient and price. The supplied payment placeholders make the configuration explicit; use the same installed native factory and original operator setup as the [paid-jobs installation](../INSTALL.md).

For example, with the configured files under /srv/starforge/reconciliation:

~~~sh
starforge jobs serve \
  --config /srv/starforge/reconciliation/example-merchant.json \
  --state /srv/starforge/reconciliation/merchant-state \
  --native-factory /srv/starforge/native-runtime.mjs \
  --start-worker
~~~

Route the configured purchase path and /jobs customer routes through the existing merchant HTTPS proxy. The catalog and chunk receiving paths live below /jobs/intake/v1/. They use the same customer listener and original intake configuration. The example publishes only the reconcile function.

The function reads ledger as UTF-8 NDJSON. Every nonblank line supplies invoiceId, lineId, sku, quantity, chargedMinor and currency. Quantity is a positive integer. Charged and unit-price amounts are nonnegative decimal strings in that currency's minor units. The price book has schema supplier-pricebook.v1, a reference and prices containing sku, currency and unitPriceMinor.

The function streams up to 250,000 invoice lines and reads a price book of up to 4 MiB. Duplicate invoice/line identities, duplicate prices, malformed rows and unsupported numeric representations produce a job input error. A currency is matched exactly; it is never converted using an assumed exchange rate.

For the supplied six lines, the expected report contains two matches, one overcharge, one undercharge, one unknown SKU and one currency mismatch. The priced USD lines have expected 1200, charged 1220 and variance 20 minor units. The priced EUR line has expected and charged 900. Unknown or currency-mismatched lines remain separate unpriced amounts.

The report includes each original file descriptor, totals by currency, discrepancy counts and the first requested number of detailed exceptions. omittedExceptions states how many further discrepancies exist. Every row contributes to the totals and counts, even when its detail lies beyond that selected report limit.

## Use the Request application

Open the installed customer application with its existing SF88 operator. On the first open, declare directories that may supply local files:

~~~sh
starforge job-workspace serve \
  --state /srv/starforge/customer-jobs \
  --file-root /srv/starforge/request-inputs \
  --operator-workspace /srv/starforge/operator \
  --landing request
~~~

The original Applications catalog can launch the same Request landing. It uses the installed runtime, configured operator and private customer state already selected in that catalog.

Load the merchant's exact HTTPS origin and choose its function. Enter the ordinary JSON inputs, then choose **Save request and add files**. The saved request displays every configured slot, its allowed media types, per-file size limit and whether it is required.

For each slot:

1. Choose a local file, or select a verified file from **Resource library**.
2. Confirm its media type and filename. The media type is explicit when the browser cannot supply a useful value.
3. Let the application save and verify its bytes. Progress reports hashing and local staging separately.
4. When all required slots are ready, select **Prepare checkout**.

The browser hashes 256 KiB slices in a worker. It never loads the whole file into one ArrayBuffer. Library selection uses the original library's current resource identity and verified download; it retains that resource's source relationship with the request.

Preparation uploads only chunks that the merchant is still missing, verifies the complete originals there and then sends the existing input-request operation. The Request page opens its original Checkout entry. Review and approve through that configured operator. The existing Jobs view follows the worker; Fetch receives the output into Resource library, and Collections can preserve it alongside related resources.

For a function without an inputFiles policy, its existing inputs and form continue to work as before, including an ordinary application property named $files.

## Installed command workflow

Standalone commands own the same customer lease as the browser service. Close that foreground service normally before using commands against its directory.

On the first open, retain the allowed local-input directory and obtain the actual catalog:

~~~sh
starforge job-workspace request-catalog \
  --state /srv/starforge/customer-jobs \
  --file-root /srv/starforge/request-inputs \
  --origin https://jobs.example.com \
  --out /srv/starforge/request-inputs/catalog.json

starforge job-workspace request-draft \
  --state /srv/starforge/customer-jobs \
  --catalog-file /srv/starforge/request-inputs/catalog.json \
  --function reconcile \
  --input /srv/starforge/request-inputs/example-input.json \
  --reference invoices:2026.10 \
  --label "October supplier reconciliation"
~~~

Use the returned request.id and current revision. Add the original ledger:

~~~sh
starforge job-workspace request-file-add \
  --state /srv/starforge/customer-jobs \
  --request REQUEST_ID \
  --slot ledger \
  --file /srv/starforge/request-inputs/example-ledger.ndjson \
  --content-type application/x-ndjson \
  --expected-revision CURRENT_REVISION
~~~

Read request-show for its new revision, then add the original price book:

~~~sh
starforge job-workspace request-show \
  --state /srv/starforge/customer-jobs --request REQUEST_ID

starforge job-workspace request-file-add \
  --state /srv/starforge/customer-jobs \
  --request REQUEST_ID \
  --slot prices \
  --file /srv/starforge/request-inputs/example-prices.json \
  --content-type application/json \
  --expected-revision CURRENT_REVISION
~~~

Alternatively, request-file-search searches the original verified resource library, and request-file-library selects one returned resource ID:

~~~sh
starforge job-workspace request-file-library \
  --state /srv/starforge/customer-jobs \
  --request REQUEST_ID --slot prices --resource RESOURCE_ID \
  --content-type application/json --expected-revision CURRENT_REVISION
~~~

Continue with the current revision:

~~~sh
starforge job-workspace request-prepare \
  --state /srv/starforge/customer-jobs \
  --request REQUEST_ID --expected-revision CURRENT_REVISION \
  --operator-workspace /srv/starforge/operator
~~~

This saves and imports the original merchant handoff. Use the returned checkoutId with checkout-review, checkout-execute or checkout-recover; use its accepted job entry with watch and fetch. These existing commands retain their original payment, operator and delivery behavior.

| File command | Behavior |
| --- | --- |
| request-files --request ID | Show slots, hashes, saved bytes, merchant transfer progress and storage use. |
| request-file-add | Read an original file inside an existing declared file root and resume private staging. |
| request-file-library | Verify and stage the exact selected library resource. |
| request-file-remove --slot NAME | Remove a slot selection before the original request has been dispatched. |
| request-file-cleanup | Free replaced files, withdrawn-draft files, or local copies already transferred to the merchant. |
| request-file-search | Search the current verified library with query, offset and limit. |

Selection, removal and cleanup use --expected-revision. Add and library selection also accept --filename. Local add requires --content-type; library selection defaults to the original resource's media type.

## Resume after interruption

The customer retains the original request and claim before receiving bytes. Each file plan retains its complete SHA256 and ordered chunk hashes. A chunk is marked received only after its bytes have been written and synced.

If the browser closes during hashing, choose the same file again. If it closes during local staging, reselect the same bytes, slot, filename and media type. The browser recomputes the hashes and sends only missing chunks from that same plan. Once local staging is complete, the original private staged bytes are sufficient for merchant transfer after a restart.

If a local source changes while it is being read, staging stops with a source or digest error. Correct chunks already saved remain available. Reselect the intended unchanged source or replace the selection before preparation.

If merchant transfer stops, reopen the original request and Prepare again. The merchant reports its existing chunk progress, so already confirmed bytes are reused. Sealing checks the full byte hash as well as every chunk before the job can be created.

The original merchant-request attempt is retained only after all required files have been transferred and sealed. After that point, the selected input is fixed. A lost ticket response resumes that same request and private claim. It does not depend on a surviving local copy and does not create another purchase. An attempted checkout continues through its existing original native operation.

Stop aborts the active HTTP or file operation and drains its owning work. Closing the customer model drains file work before releasing its original lease. Merchant files are read by the same owned worker that handles job cancellation and interruption.

## Configure file slots and storage

A function's inputFiles policy is merchant configuration:

~~~json
{
  "slots": {
    "ledger": {
      "required": true,
      "description": "Original invoice lines",
      "mediaTypes": ["application/x-ndjson"],
      "maxBytes": 134217728
    },
    "prices": {
      "required": true,
      "description": "Original supplier prices",
      "mediaTypes": ["application/json"],
      "maxBytes": 4194304
    }
  },
  "maxTotalBytes": 138412032
}
~~~

The compiler adds the reserved $files descriptor property to that function's original input schema. Configuring inputFiles alongside an existing $files schema or example property is rejected explicitly, so an application-owned field is never silently reinterpreted.

A policy supports at most 16 named slots, 2 GiB per file and 8 GiB combined. Slot limits, required flags, allowed media types and total limit are part of the policy hash. Media type checks validate the declaration; the configured application parses and validates its actual file content.

Merchant inputFileStorage controls maxBytes and maxUploads. Defaults are 2 GiB reserved bytes and 4096 uploads. Each new upload reserves its declared complete size, including an unfinished upload. Existing uploads and original progress remain intact when capacity is reached.

The customer has the same default limits. Its JavaScript inputFileStorage option or installed --input-storage-bytes / --input-storage-files options select another capacity. Supply CLI overrides again on reopening that state. --transfer-timeout-ms selects the complete transfer deadline, defaulting to one hour; individual original HTTP requests remain cancellable.

Function/policy changes follow the merchant's existing source-bound deployment process. The catalog and policy hashes identify the actual selected version. A fresh upload or request for a changed catalog is rejected until the customer selects that catalog and prepares its corresponding original input. A retained exact upload can still resume with its claim after the general intake access key rotates.

## Storage ownership and cleanup

Customer originals live under requests/input-files in the original private customer workspace. Merchant originals live under input-files in the original merchant state. Their named upload directories contain the immutable plan, compact progress and one partial or sealed original.

Customer cleanup preserves selected files that have not yet been sent. It can release replaced selections, files from an unsent withdrawn draft, and local copies after their original complete merchant transfer. Request metadata, approved input hashes, handoff, checkout and received results remain available.

Merchant cleanup is an explicit original-owner operation:

~~~sh
starforge jobs inputs list \
  --config /srv/starforge/reconciliation/example-merchant.json \
  --state /srv/starforge/reconciliation/merchant-state

starforge jobs inputs discard \
  --config /srv/starforge/reconciliation/example-merchant.json \
  --state /srv/starforge/reconciliation/merchant-state \
  --upload UPLOAD_ID --revision CURRENT_UPLOAD_REVISION \
  --reason "Remove the abandoned upload."
~~~

Run these commands after the merchant's foreground owner closes. show --upload ID displays its exact plan. --release-orphan permits removal of a pin left before an original job was committed. Existing jobs and in-flight job creation protect their input files from this cleanup.

Keep the complete merchant input-files subtree with the original merchant state when using its maintained recovery/transfer operation. The worker checks the selected plan, whole file hash and original job pin before opening an application input. Files used by retained jobs remain with that state so their existing execution and recovery identity stays usable.

## Application API

The trusted merchant handler receives context.files for a configured file function:

~~~js
export async function reconcile(input, context) {
  const priceBytes = await context.files.read('prices', { maxBytes: 4194304 });
  const prices = JSON.parse(priceBytes.toString('utf8'));

  for await (const chunk of context.files.stream('ledger')) {
    context.signal.throwIfAborted();
    // Consume this chunk using a streaming parser.
  }

  return { priceBookReference: prices.reference, files: context.files.list() };
}
~~~

metadata(slot) returns the exact bound descriptor. read has a default limit of 8 MiB and an explicit maximum of 64 MiB; stream reads fixed bounded chunks. The worker owns these handles and closes them before accepting its result. The supplied application demonstrates a complete incremental parser and exact arithmetic.

The existing typed customer entry, @tokenjunkielabs/starforge-merchant/buyer/job-workspace, exposes workspace.intake.inputFiles. Its local, library, begin, chunk, seal, summary, cleanup and cancellation methods operate on original request IDs. Most applications should open that existing workspace, whose parent lifecycle connects the library, file receiver, checkout and result receiving.

## Run the original native file workflow

The maintained checkout continuation has a separate file-input mode. It uses the same installed native SDK, original SF62/SF36 operator, browser approval routes, merchant settlement callback, worker, customer receiving and collection transfer. The earlier completed merchant and checkout records remain at their existing identities.

Run this mode through the existing native capacity controller, after that controller's preceding operation has finished:

~~~sh
python sf88-operator-buyer-cli/job-workspace/checkout/native-continuation.py \
  --retained /absolute/original/completed-merchant-fixture \
  --node /absolute/installed/node \
  --approval browser \
  --input-files \
  --out /absolute/existing/output/input-files-result.json
~~~

The source root is the installed stellar/scf-starforge-20261009 directory. The retained argument is the original completed fixture accepted by the existing launcher. All new state stays under its checkout-input-files-continuation child. The distinct operation is SCF-JOB-INPUT-FILES-0B8D-20261012, with the original job reference input-files:2026.10. Its existing driver lock, checkout attempt and native result determine whether the same operation can continue.

The run expands the six supplied invoice lines into 1,000 distinct invoice batches, retaining the generated ledger and unchanged supplied price book before receiving either. The 6,000 actual NDJSON rows cross several 256 KiB boundaries. Its report keeps 20 detailed exceptions while every row contributes to the exact totals; 3,980 additional exceptions are counted explicitly.

It performs this full customer workflow:

1. Load the actual merchant catalog and save the request in the original customer workspace.
2. Send the first local ledger chunk through the private browser route, close the owning workspace, reopen it and resume its missing chunks.
3. Select the price book through the original declared-file-root path.
4. Transfer both inputs through the original public HTTPS transport. After the merchant returns a real successful first-chunk response, retain that response hash and interrupt its delivery once. Reopen the merchant and customer, then continue from the already saved chunk.
5. Import the original handoff, review and approve the exact disposable terms through the original browser broker, and execute the existing native SDK operation.
6. Let the original worker reconcile the two sealed files; receive and preview the verified result, export its collection, independently receive the archive, and reopen the same checkout and customer.
7. Release the now-transferred customer copies while retaining their canonical descriptors and ticket. Confirm that the retained job still protects its merchant originals.

The fixture uses local protocol settlement and a local verified TLS/CONNECT route. Those boundaries are explicit in the output. Its native result also retains the input hashes, actual source path, catalog/request/ticket identity, chunk recovery records, one original reservation, one native settlement, final resource digest and collection receiving result.

Request 1 GiB for the complete native process group plus the existing controller's 256 MiB reserve. This includes two Node heaps capped at 256 MiB, the configured 128 MiB worker, Python and native overhead; it is a requested capacity envelope, not a measured peak. The installed dependencies are reused. A 128 MiB operation disk allowance accommodates the two originals, both upload stores, native records and result/collection files.

Rerun only through that same native operation and retained directory. The existing launcher reopens a recorded checkout and recovers an attempted operation; it never clears its attempt to create a new purchase. All failed phases retain their original state for the next correction.
