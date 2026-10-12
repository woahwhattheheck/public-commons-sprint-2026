# Review, stage and receive a Huwise facilitator change

This workflow operates an existing Huwise merchant package through the original
SF82 seller release engine. It reads the host-selected facilitator with the
installed native SDK, retains the complete response and native payment
alternatives, and stages a compatible reviewed change. The Huwise workbench,
browser, CLI and merchant MCP all use the same retained reviews and seller store.

The complete source edition, published dataset, merchant handler and public
resource remain bound to the original merchant package. The new release changes
the facilitator settings through SF82's own release derivation. Its selected
release and running seller continue to use the original merchant lifecycle.

## 1. Select the original project and installed product

Continue the project that holds the completed capture, reviewed publication and
merchant export. The source release must already exist under its original
seller-releases directory. Use the ordinary [merchant workflow](MERCHANT.md)
and [package receiving guide](publisher/RECEIVING.md) to create or receive that
source release first.

Use the actual source package returned by the maintained Huwise selection
builder. Its command registration includes huwise and merchant-huwise, and its
facilitator helper is exported as
@tokenjunkielabs/starforge-merchant/seller/opendatasoft/facilitators.

For a private installed runtime, define this function in the current shell.
Replace both absolute paths with the original toolkit and prepared runtime:

~~~sh
starforge() {
  node /absolute/toolkit/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs \
    run --dir /absolute/private/huwise-runtime -- "$@"
}
~~~

The function invokes that runtime's installed dispatcher; it does not install a
global executable. [The complete product guide](../../../../products/huwise/OPERATING.md)
describes selected source receiving, native dependencies and runtime installation.

The facilitator read uses the existing installed native x402 SDK. A package with
only source inspection dependencies can read saved files, but a new compatibility
review needs the native payment dependencies declared by the existing runtime.
Install or receive them through the maintained runtime installer.

One process owns the existing workbench lease. If its browser or merchant host is
already open, use that owner's interface. Run separate huwise CLI invocations
after that original owner closes the workbench.

## 2. Declare host profiles

Copy [facilitators.example.json](facilitators.example.json) into the host's private
configuration directory. The example preserves the two testnet endpoint
definitions used by the shared facilitator component:

~~~json
{
  "schema": "stellar-forge.seller-facilitators.v1",
  "providers": {
    "vellar": {
      "label": "Vellar testnet",
      "url": "https://vellar-facilitator-testnet-production.up.railway.app",
      "timeoutMs": 10000
    },
    "periplo": {
      "label": "Periplo testnet",
      "url": "https://periplo-testnet.fly.dev",
      "timeoutMs": 10000
    }
  }
}
~~~

These are connection examples. Their presence is not a current compatibility or
availability result. Each new review reads the actual supported response and
checks this original service through the installed native SDK.

Profiles contain 1–16 named providers. Each alias is 1–64 lowercase letters,
digits, underscores or hyphens, beginning with a letter or digit. Public URLs use
HTTPS with no embedded credentials, query or fragment. timeoutMs is 1000–30000.
The original native schema also permits an explicitly enabled loopback HTTP
facilitator through allowLocalFacilitator; use that only for the selected local
native service. Browser and MCP requests choose these host aliases.

Profiles load when the workbench opens. To adopt a changed file, close and reopen
the original owning workbench or merchant process. A retained review includes
the complete provider definition that was actually reviewed. Staging checks the
definition loaded by the current owner against that retained definition.

Open the original workspace:

~~~sh
starforge huwise serve \
  --project /absolute/private/huwise-project \
  --facilitators /absolute/private/config/facilitators.json --port 0
~~~

Use the returned complete local capability URL, then choose Facilitators. This
opens /facilitators on the same authenticated server and original workbench.
The page reads the host profiles, original source-matched releases, selection
generation, active/previous selections, complete saved review history and any
native release inspection errors. Opening without profiles still permits
inspection and download of existing retained reviews.

## 3. Review the whole service

Choose the original retained release and host facilitator. Enter a new proposed
release ID and a useful label. The page binds that release to the exact merchant
export shown beside it.

The Huwise binding checks the immutable original handler SHA256 and public
resource against the retained merchant export. The original handler itself
binds the complete merchant manifest and runtime. The review's companion source
record includes the capture SHA256, dataset identity, merchant manifest,
handler, native source release digest and proposed release ID.

Choose Review native compatibility. The original workbench returns and retains
its asynchronous operation. On completion, inspect:

- The native compatibility result and original error, if any.
- Every route and every ordered native payment alternative.
- Exact atomic amount strings, recipient, scheme, network and asset.
- Timeout and every complete native extension/extra field.
- All differences from the stored payment alternatives.
- The complete supported response, native SDK identity and observed time.
- The original selection generation, source digest and Huwise capture binding.

A review can be incompatible and still retain a complete provider response and
useful native error. The saved review remains available in history. Payment
amounts stay strings throughout the browser and client; the interface does not
convert large atomic values to floating point.

The provider's canonical supported-body SHA256 is the native SDK's normalized
JSON identity. It is distinct from a separately captured HTTP body's whitespace
and byte-order identity. The full native review download preserves the original
saved review bytes.

The review reads native provider support and constructs the original native
seller requirements. It does not listen on a seller port, sign a payment, call
verification or settlement, purchase data, activate a release or claim customer
use. Those outcomes belong to the original seller and buyer operation.

History uses stable review-ID order. Each page contains up to 100 descriptors,
defaulting to 25. Follow nextCursor as after until it is null. observedAt is the
time of that particular provider observation. The browser's search filters only
the pages that are currently loaded.

## 4. Stage the selected review

Choose Stage this retained review from its full details. The only stage input is
the exact retained reviewId. The original native engine:

1. Checks the complete review's content-derived identity.
2. Checks the current host profile against the reviewed provider.
3. Reopens the original source release and its immutable files.
4. For a new proposed release, repeats the native provider review and compares
   the complete source, selection generation, supported body and alternatives.
5. Stages the derived release using the original source files, routes and
   handler, with the reviewed facilitator runtime settings.

The resulting release records derivedFrom.reviewId. If that release was already
committed before a lost reply, staging the same review reopens that exact native
release without substituting another observation. An ID used by a different
review remains a conflict. A changed provider, source or selection returns the
original native conflict instead of silently revising the approved input.

Huwise inspection reports one of:

| Observed state | Meaning |
| --- | --- |
| NOT_STAGED | No proposed release is present in the original store. |
| STAGED | The proposed release exists and names this exact review ID. |
| CONFLICT | The proposed ID exists with a different derivation. |

Stage success retains a release. Select and run it through the existing merchant
release controls in [the original receiving guide](publisher/RECEIVING.md).
Inspect the current generation before activation or rollback. The runtime that
owns the current seller stops and starts its own listener. A selected release
can differ from the observed running release. Startup uses the native
facilitator review revalidation and preserves its original errors.

Keep customer queries, accept-index choices, intent IDs, attempts and completed
downloads in their existing SF88 buyer operation. A facilitator change is not a
reason to repeat an acknowledged purchase or discard a completed customer page.

## 5. CLI between owning sessions

Every command below uses the same original project directory. Read the source
release and merchant export IDs from its actual state:

~~~sh
starforge huwise status --project /absolute/private/huwise-project
starforge huwise facilitators --project /absolute/private/huwise-project \
  --facilitators /absolute/private/config/facilitators.json
starforge huwise facilitator-history --project /absolute/private/huwise-project \
  --limit 25
~~~

Save review-input.json with actual values:

~~~json
{
  "merchantExportId": "ORIGINAL_MERCHANT_EXPORT_UUID",
  "provider": "periplo",
  "releaseId": "original-huwise-release",
  "id": "huwise-periplo-edition",
  "label": "Original Huwise service using Periplo"
}
~~~

The UUID and IDs above show the input fields. Replace them with the inspected
merchant UUID, existing release ID and a new proposed release ID.

~~~sh
starforge huwise facilitator-review --project /absolute/private/huwise-project \
  --facilitators /absolute/private/config/facilitators.json \
  --input /absolute/private/review-input.json
~~~

The CLI waits for the original workbench operation and prints its actual
COMPLETE, FAILED or CANCELLED state. A non-COMPLETE operation sets a nonzero exit
status. A completed review's result includes review, source and staged.
Copy result.review.id exactly; do not use the workbench operation UUID as the
native review ID.

~~~sh
starforge huwise facilitator-inspect --project /absolute/private/huwise-project \
  --review-id RETAINED_64_CHARACTER_REVIEW_ID

starforge huwise facilitator-stage --project /absolute/private/huwise-project \
  --facilitators /absolute/private/config/facilitators.json \
  --review-id RETAINED_64_CHARACTER_REVIEW_ID
~~~

Receive all three original companion files into an existing private directory:

~~~sh
starforge huwise facilitator-file --project /absolute/private/huwise-project \
  --review-id RETAINED_64_CHARACTER_REVIEW_ID --format review \
  --out /absolute/private/review-delivery/facilitator-review.json
starforge huwise facilitator-file --project /absolute/private/huwise-project \
  --review-id RETAINED_64_CHARACTER_REVIEW_ID --format source \
  --out /absolute/private/review-delivery/facilitator-source.json
starforge huwise facilitator-file --project /absolute/private/huwise-project \
  --review-id RETAINED_64_CHARACTER_REVIEW_ID --format guide \
  --out /absolute/private/review-delivery/FACILITATORS.md
~~~

Each command returns the complete byte count and SHA256. Publication uses an
exclusive, fsynced final file. Repeating an acknowledged command adopts only
byte-identical output. A different existing file is preserved and reported as a
conflict. The review file is the original native retained JSON; the source file
is the Huwise binding derived from that same review and immutable merchant.

## 6. Use the original merchant agent

Add facilitatorConnection to the existing private host connection. Its relative
path resolves beside that connection file:

~~~json
{
  "schema": "stellar-forge.opendatasoft-workspace-connection.v1",
  "workspaces": {
    "portals": {
      "label": "Original Huwise portal data product",
      "directory": "/absolute/private/huwise-project",
      "origin": "https://public.opendatasoft.com",
      "facilitatorConnection": "/absolute/private/config/facilitators.json",
      "imports": {},
      "merchants": {},
      "sellers": {}
    }
  }
}
~~~

Preserve any existing portal credential, tenant Automation connection, merchant
terms, runtime and seller aliases. The merchant MCP releaseStore must be this
original project's seller-releases directory for review and stage. The
maintained init-opendatasoft-workspaces entry binds it; existing hosts retain
their original configured store and current selection. See the
[merchant agent guide](../../../../stellar-forge/mcp-merchant-operator/OPENDATASOFT.md).

The added tools use the existing typed client, operation queue and transport:

| Tool suffix after merchant_opendatasoft_ | Inputs in addition to workspace | Result |
| --- | --- | --- |
| facilitators | none | Profiles, original selection, source-matched releases and first review page. |
| facilitator_history | optional after, limit | Complete descriptors and nextCursor. |
| facilitator_inspect | reviewId | Whole native review, Huwise source binding and staged observation. |
| facilitator_review | merchantExportId, provider, releaseId, id, optional label | Original operationId. |
| facilitator_stage | reviewId | Original operationId. |

The client exposes facilitatorHistory, facilitatorInspect, facilitatorReview and
facilitatorStage. This example assumes the actual existing merchant host is
already configured. Keep its returned operation IDs with the receiving request:

~~~js
import {
  openOpendatasoftClient,
  downloadOpendatasoftExport,
  reopenOpendatasoftExport
} from '@tokenjunkielabs/starforge-merchant/merchant/mcp/opendatasoft/client';

const client = await openOpendatasoftClient({ url: process.env.MERCHANT_MCP_URL });
const workspace = 'portals';
const started = await client.facilitatorReview({
  workspace,
  merchantExportId: input.merchantExportId,
  provider: input.provider,
  releaseId: input.releaseId,
  id: input.proposedReleaseId,
  label: input.label
});
// Retain started.operationId before waiting. Reopen it after an interrupted wait.
const observed = await client.awaitOperation({
  workspace, operationId: started.operationId
});
if (observed.operation.state !== 'COMPLETE')
  throw new Error(JSON.stringify(observed.operation.error));
const inspected = observed.operation.result;
const reviewId = inspected.review.id;
// Present inspected.review.nativePayments, source and the supported response
// for review. A later explicit stage receives this saved reviewId.
~~~

Stage only the selected completed review:

~~~js
const staged = await client.facilitatorStage({ workspace, reviewId });
const stageResult = await client.awaitOperation({
  workspace, operationId: staged.operationId
});
if (stageResult.operation.state !== 'COMPLETE')
  throw new Error(JSON.stringify(stageResult.operation.error));
const readback = await client.facilitatorInspect({ workspace, reviewId });
if (readback.staged.state !== 'STAGED')
  throw new Error('The original proposed release was not observed as staged.');
~~~

Awaiting an operation observes the original server operation. Aborting that wait
does not cancel or redispatch it. Inspect status and the same operation before
choosing a subsequent action. Closing a workbench is an operation of its actual
owner; do not close a borrowed operator merely to finish a file download.

## 7. Deliver the full data product with the review

Use the normal immutable Huwise export, adding facilitatorReviewId and the same
merchantExportId. The provider checks the exact merchant manifest and capture
relationship before copying any facilitator companion:

~~~js
const edition = await client.edition({ workspace, editionId: input.editionId });
const prepared = await client.export({
  workspace,
  exportId: input.deliveryId,
  editionId: edition.id,
  expectedCaptureSha256: edition.manifestSha256,
  expectedNotesRevision: edition.notes.revision,
  merchantExportId: input.merchantExportId,
  facilitatorReviewId: reviewId,
  ...(input.sourceId ? { sourceId: input.sourceId } : {}),
  ...(input.buyerRequestId ? { buyerRequestId: input.buyerRequestId } : {})
});
await downloadOpendatasoftExport({
  client, exportId: prepared.exportId,
  directory: input.receivingDirectory,
  expectedManifestSha256: prepared.manifestSha256
});
const received = await reopenOpendatasoftExport({
  exportId: prepared.exportId,
  directory: input.receivingDirectory,
  expectedManifestSha256: prepared.manifestSha256
});
~~~

The download is the existing complete Huwise delivery. It includes all four
analyst formats, original merchant archive and its receiving guide, plus:

| File | Retained authority |
| --- | --- |
| facilitator-review.json | Whole original native review, including supported response and ordered alternatives. |
| facilitator-source.json | Review ID, original workbench/capture, merchant manifest/handler and source release. |
| FACILITATORS.md | Complete installed workflow, receiving and recovery instructions. |

The immutable export manifest records the native review ID, exact review-file
SHA256 and source-file SHA256. Every file, including this guide, also has its
ordinary manifest byte count and hash. Optional existing source declaration,
buyer request and tenant delivery continue to use their original selection
fields. This new selection does not rewrite an earlier completed delivery;
choose a new exportId for an additive edition.

Read and download with the original command-line customer receiver:

~~~sh
starforge merchant-huwise call --url "$MERCHANT_MCP_URL" \
  --action export --arguments /absolute/private/export-input.json
starforge merchant-huwise inspect --url "$MERCHANT_MCP_URL" \
  --export ORIGINAL_EXPORT_ID
starforge merchant-huwise download --url "$MERCHANT_MCP_URL" \
  --export ORIGINAL_EXPORT_ID --directory /absolute/private/customer-delivery \
  --manifest-sha256 ORIGINAL_EXPORT_MANIFEST_SHA256
starforge merchant-huwise reopen --export ORIGINAL_EXPORT_ID \
  --directory /absolute/private/customer-delivery \
  --manifest-sha256 ORIGINAL_EXPORT_MANIFEST_SHA256
~~~

The export input uses the exact fields in the preceding client call. Native file
reads retain their manifest/file hashes and original offsets. Repeat the same
download and receiving directory after interruption; complete saved prefixes
are verified before continuation. Manifest and file tools work after the
workbench closes, and local reopen verifies all files without the MCP host.

The source binding explains how the facilitator review relates to the delivered
merchant. Import or receive the complete original merchant and capture through
their existing receiving commands when operating on another host. A review JSON
alone does not create its source release, grant provider access or select a
running seller. Keep the original workbench and seller store for operational
continuation, or receive their complete original authority before reopening it.

## 8. Recover the same operation

| Interruption | Original continuation |
| --- | --- |
| Review reply lost | Inspect the workbench's current operation, page saved history and reopen the matching full native review. Do not automatically issue a second provider observation. |
| Browser reload while operation runs | The page retains its request and returned operation ID under the same project identity, then observes that original operation. |
| Proposed release was committed before stage reply | Inspect the review and its proposed release. STAGED requires the exact derivedFrom.reviewId. Repeating that same stage uses native idempotent recovery. |
| Workbench operation advanced before an unresolved reply was received | Keep the unresolved local request. Select a matching retained review or stage observation when available. The browser can archive that unresolved tracking record and prepare a deliberate new review; it does not claim a native outcome or resend the old request. |
| Provider/profile/source/generation changed | Retain the failed review and native error. Inspect current state and prepare a separately reviewed change with a new proposed ID. |
| Raw file download interrupted | Repeat the same review ID, format and output path. Only exact existing bytes are adopted. |
| Complete product export/download interrupted | Reuse the original export ID, selected source/notes/review, manifest hash and receiving directory. |
| Server closes during native review | The existing workbench close path aborts and drains its original operation before releasing the lease. The SDK's bounded provider read remains owned until it returns; a saved result is inspected on reopening. |

Browser tracking records support the user's current session. The authoritative
review, source release and complete export remain in their original native
stores. Closing or clearing a tab is not evidence that a native action failed.

## Run the complete native customer programme

The installed merchant-huwise-facilitators-receive command joins this original
review and stage with full typed-client receiving, desktop/phone browser
downloads, closed-host committed-stage recovery and complete offline reopen.
Use its [full operating and receiving guide](../../../../stellar-forge/mcp-merchant-operator/FACILITATOR_RECEIVING.md)
with the same original workbench, host profiles and selected source package.
Its complete source and installation manifest remain bound to the operation.
The original capture, buyer requests and seller selection are preserved.

## Source and operating boundaries

- [Huwise facade](publisher/facilitators.mjs) adds the original merchant/capture
  binding and exact companion files.
- [Shared retained review component](../socrata/publisher-facilitators.mjs)
  owns the common native review history, inspection and original SF82 dispatch.
- [SF82 facilitator implementation](../../sf82-seller-pilot/release-facilitator.mjs)
  owns profile validation, supported-response reading, native alternatives and
  reviewed release derivation.
- [SF82 releases](../../sf82-seller-pilot/releases.mjs) own source verification,
  selection, rollback and seller lifetime.
- [Huwise merchant agent](../../../../stellar-forge/mcp-merchant-operator/OPENDATASOFT.md)
  retains complete exports and native descriptor-based customer downloads.

A compatible observation, a staged release, an activated selection, a running
seller and a completed paid acquisition are distinct native states. Report the
actual observed state and its original identity when delivering this work.
