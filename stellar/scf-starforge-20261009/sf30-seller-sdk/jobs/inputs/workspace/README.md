# Merchant input receiving

**Input receiving** is part of the original paid-job merchant workspace. It shows customer originals as they arrive, the exact storage reserved for them, their sealed manifests, and the original jobs that retain them. The customer’s Request workspace still owns file selection, transfer and purchase preparation.

Launch the merchant with the installed runtime’s existing command:

~~~sh
starforge jobs serve --config /srv/merchant/merchant.json \
  --state /srv/merchant/state --native-factory /srv/merchant/native-runtime.mjs
~~~

Open the private operator address printed by that command, then choose **Input receiving**. This page uses the same merchant process, state lease and private session. No additional port or input directory is required. The host also returns an `inputReceivingUrl` to application launchers.

The accompanying [two-file reconciliation example](../README.md) configures a required invoice ledger and supplier price book. That complete example is a useful first workload: the customer selects the originals in Request; the merchant can follow both transfers here; purchase review binds both file descriptors; and the configured worker reconciles their contents.

## Follow a customer’s originals

The first row appears when the merchant accepts an original upload plan. Each row includes its filename, declared byte count and media type, request reference, function, slot, received chunk count and current job association.

Use the search field for a filename, slot, reference or SHA-256 digest. Function, transfer and use filters combine with that search. **Awaiting a job** shows unassigned uploads. **Pinned before job commit** identifies files whose pin exists while no retained job is visible. A request may still be preparing; the original store checks that fact again when an operator asks to release it.

Select a file to inspect:

- The exact original request, slot, file digest and full chunk manifest.
- Which chunk indexes are still missing and how many bytes have arrived.
- Its current revision, creation time and seal time.
- The retained job and whether that job’s saved input contains this exact descriptor.
- The original file policy and the currently configured slot policy.

**Open retained job** returns to Paid jobs and selects that original job. The job detail’s **Open original input files** returns to the receiving desk filtered to its request. These links retain the existing private session.

An **Arriving** file can resume through the customer’s original Request after browser, customer workspace or merchant restart. A **Sealed** file has all expected chunks and a matching whole-file SHA-256. Refresh reads the current original store; it does not recreate a request.

The storage total is reserved capacity, so a partially uploaded file reserves its complete declared size. Counts distinguish arriving files, sealed files, unassigned files and files retained by jobs. This makes a stalled large transfer visible before it consumes all configured input capacity.

## Preview and download

**Preview original** verifies the complete sealed original, then displays at most 256 KiB. A text preview preserves UTF-8 boundaries. Binary inputs show a short hexadecimal prefix. The preview displays the actual complete byte count and SHA-256 separately from its displayed prefix.

**Download original** verifies the same original and opens a native browser download. The maintained resource-library download service streams the file from its retained descriptor. It does not first turn a multi-gigabyte input into a browser `Blob`.

The private registration request returns a one-use ticket with the expected byte count and digest. The same-origin browser transfer consumes that ticket, returns `Content-Length` and `X-Content-SHA256`, and closes its retained file handle on completion or disconnect. Tickets expire after 60 seconds; at most four preparations, tickets or streams occupy the shared desk’s download slots. Request another download if a ticket expires.

**Stop reading** cancels a pending verification or preview. Once a download is handed to the browser, the browser manages that download’s progress and cancellation. Closing the merchant operator host aborts and drains its verification and stream work before the owning merchant releases its lease.

## Release unused storage

Use **Release this upload** when an unassigned transfer is no longer needed. Enter a reason. The action includes the revision displayed in the file detail; an upload that changes before release produces a revision conflict and remains available for review.

For a pin left before a failed original job commit, select the explicit orphan-pin option. The original input store still checks the merchant’s in-flight preparation reservation and retained job records under its own serialized operation. A job’s input remains retained through completed execution, retries and recovery.

Deleting an unassigned upload retires its original directory atomically and releases its reserved capacity. If a customer continues that request later, its client must transfer the original bytes again. Customer-side copy cleanup and merchant-side release are separate operations: a customer may remove its staged copies after confirmed merchant receiving while the merchant continues to retain the original files needed by the job.

If the slot policy has changed, the desk shows the retained policy alongside the current configured policy. Earlier originals remain inspectable. A new customer request reads the current catalog and must satisfy that policy; editing a displayed manifest does not reauthorize an earlier ticket.

## Terminal receiving and recovery

The installed `jobs inputs` command uses the original merchant model and state lease. Close the live merchant owner before using the offline command. The browser desk is the live route when that owner should keep serving customers.

~~~sh
starforge jobs inputs list --config /srv/merchant/merchant.json \
  --state /srv/merchant/state --reference invoice-review-2026-10

starforge jobs inputs show --config /srv/merchant/merchant.json \
  --state /srv/merchant/state --upload UPLOAD_ID

starforge jobs inputs preview --config /srv/merchant/merchant.json \
  --state /srv/merchant/state --upload UPLOAD_ID --max-bytes 65536

starforge jobs inputs download --config /srv/merchant/merchant.json \
  --state /srv/merchant/state --upload UPLOAD_ID --out /srv/exports/original-ledger.ndjson
~~~

`show` retains the existing `upload` and `original` fields and adds policy, retained-job and release information. `list` preserves its existing output schema and pagination options.

Download creates a private output with exclusive creation. If the command is interrupted, the partial output remains at the explicit path. Continue that same copy with:

~~~sh
starforge jobs inputs download --config /srv/merchant/merchant.json \
  --state /srv/merchant/state --upload UPLOAD_ID \
  --out /srv/exports/original-ledger.ndjson --resume
~~~

Before writing any additional bytes, the command compares every retained output-prefix byte with the same verified original. A mismatched prefix, oversized output, symlink or nonprivate existing file is refused. A complete matching output is reused. The final output is hashed, synchronized, and reported with its full SHA-256, byte count and starting offset. The original upload, customer capability and paid job identity remain the same.

An unused upload can be released through the same original store:

~~~sh
starforge jobs inputs discard --config /srv/merchant/merchant.json \
  --state /srv/merchant/state --upload UPLOAD_ID --revision 4 \
  --reason "Customer replaced this unassigned request"
~~~

Add `--release-orphan` only for the displayed pin left before a job commit. The command applies the same retained-job and active-preparation checks as the browser desk.

## Application integration

The maintained input entry point exports:

~~~js
import { openJobInputWorkspace, jobInputWorkspaceExtension } from
  './sf30-seller-sdk/jobs/inputs/index.mjs';

const desk = openJobInputWorkspace({ model: originalMerchant });
const page = await desk.query({ reference: 'invoice-review-2026-10', limit: 50 });
const original = await desk.get(page.items[0].id);
const preview = await desk.preview(original.upload.id);
await desk.close();
~~~

`query`, `get`, `preview`, `download`, `save` and `discard` use the original input store. A direct `download` caller owns the returned descriptor and must call its `dispose()`. A `save` caller supplies an absolute output path and can pass an AbortSignal and progress callback.

The standard merchant host already mounts the HTTP extension. A custom host can consume its `assets`, invoke `publicRoute` after its original Host/Origin checks, and invoke `authenticatedRoute` after its private authentication. The callback uses the resource-library shape: `{request,response,url,signal,body,send}`, where `send(value,status)` sends JSON. The extension registers `/api/inputs/**` and one-use `/input-transfer/**` downloads. Close the extension before closing its borrowed merchant model.

The original SF101 merchant receiver captures the complete merchant state tree, including these input manifests and bytes. Its existing file and aggregate capture limits still apply. Restoring that original state preserves the file identities and pinned job input without a second collector or input writer.

## Continue the original native file-input operation

The existing `checkout/native-continuation.py --approval browser --input-files` operation also consumes this desk after the same purchased reconciliation completes. It reads both actual merchant manifests through the private HTTP host, previews and streams their original bytes, resumes a partial operator copy, verifies the retained job prevents release, and reopens the same receiving host over the same model. Its result records these observations in `inputFiles.merchantReceiving`.

This continuation preserves the original file-input operation ID, two input identities, purchased job and native approval. It uses the existing operation’s controller and retained directory. Follow [the original invocation and runtime requirements](../README.md#run-the-original-native-file-workflow) when assigning that operation to an equipped worker.
