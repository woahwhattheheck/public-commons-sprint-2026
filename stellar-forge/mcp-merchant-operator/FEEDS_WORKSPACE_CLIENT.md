# Feed workspace customer SDK and CLI

The feed workspace client operates the existing RSS/Atom/OPML merchant tools from
a Node application or terminal. It covers all 17 original tools, all 12 native
feed and collection actions, complete result files, publisher/customer operations
and portable receiving. The configured feed console remains the original
workspace writer.

Use this client when an agent, scheduled process or customer application needs
the same source, review, edition and customer workflow as the feed console.
The native console's Applications entry and original merchant MCP connection
supply the running service. [FEEDS_WORKSPACE.md](FEEDS_WORKSPACE.md) contains the
complete host connection, input declarations, merchant profiles and buyer setup.

## Start with the original connection

Use the actual MCP URL printed by the existing merchant listener, the configured
workspace alias and its existing token environment variable. The MCP URL is
separate from the private feed-console capability. The capability stays in the
host's original launch record.

The installed source package provides:

~~~sh
starforge feeds-workspace-client --help

starforge feeds-workspace-client workspaces \
  --url "$MCP_URL" --token-env MCP_ACCESS_TOKEN

starforge feeds-workspace-client status \
  --url "$MCP_URL" --workspace research --token-env MCP_ACCESS_TOKEN
~~~

The original-source equivalent is:

~~~sh
node stellar-forge/mcp-merchant-operator/feeds-workspace-cli.mjs status \
  --url "$MCP_URL" --workspace research --token-env MCP_ACCESS_TOKEN
~~~

A workspace alias names the original host declaration. Source inputs, merchant
profiles and buyer workspaces are named there too. The client accepts the exact
tool arguments; it injects its selected workspace and rejects an argument trying
to replace it. Use owned canonical private directories for local requests,
downloads and result files. New files are created privately and conflicting
existing output is preserved.

### Typed Node entry

~~~js
import { openFeedsWorkspaceClient } from
  '@tokenjunkielabs/starforge-merchant/merchant/mcp/feeds/client';

const feeds = await openFeedsWorkspaceClient({
  url: process.env.MCP_URL,
  workspace: 'research',
  tokenEnv: 'MCP_ACCESS_TOKEN',
  resultsDirectory: '/private/feed-customer/results',
});

try {
  const status = await feeds.resolveResult(await feeds.status());
  console.log(status.native.activity);

  for await (const page of feeds.inventoryPages({ kind: 'collections', limit: 25 })) {
    for (const collection of page.native.items) console.log(collection);
  }
} finally {
  await feeds.close();
}
~~~

The paired declarations expose each native action input, tool argument/result
map, operation observation, request record and delivery manifest. Package
entries are:

| Import suffix after the package name | API |
|---|---|
| `/merchant/mcp/feeds/client` | Complete workspace SDK and original receiving helpers. |
| `/merchant/mcp/feeds/request` | Local prepare, exact request/response records and inspection. |
| `/merchant/mcp/feeds/download` | Original downloader plus completed-file local reopen. |
| `/merchant/mcp/feeds/client-cli` | `runFeedsWorkspaceCli` and full command help. |

For an embedded original merchant factory, supply its already configured
protocol client as `client` instead of `url`. It must expose a stable
`endpoint` identity and `call(name, arguments, {requestSignal, timeoutMs})`.
The factory keeps its own lifetime; close this feed client before closing that
factory. Every returned workspace and original file identity is still checked.

## Read full native data and pages

The provider returns ordinary complete native results inline when they fit its
64 KiB presentation bound. Larger replies contain `completeResult`, a retained
delivery for the complete original `result.json`. Call `resolveResult` to
receive and parse that file. Its manifest, byte count, SHA256 and selected
workspace are verified. Native JSON is limited by the provider's original
32 MiB bound.

~~~js
const response = await feeds.read({
  kind: 'collection',
  id: originalCollectionId,
});
const { native, delivery } = await feeds.resolveResult(response);
// native is the whole original collection response.
// delivery identifies the retained result.json when the response was large.
~~~

Select `resultsDirectory` once to keep each complete result in its own export-ID
directory, or pass a specific `directory` for one result. Repeating the same
receiving operation uses its existing verified files and checkpoint.

~~~sh
starforge feeds-workspace-client read \
  --url "$MCP_URL" --workspace research \
  --kind collection --id "$COLLECTION_ID" \
  --complete /private/feed-customer/collection-view \
  --output /private/feed-customer/collection-view.json
~~~

Pagination keeps each original route's semantics:

| Selection | Client method | Continuation |
|---|---|---|
| Feeds, editions, subscription sources, collections | `inventoryPages` | Original snapshot and `nextOffset`. |
| Requests or a selected response array | `readPages` | Original snapshot and `nextOffset`. |
| Captures, review, records, changes | `readPages` | Original live `nextOffset`; omit `array` and `expectedSnapshot`. |
| Retained exports | `exportPages` | Original export-list snapshot and `nextOffset`. |

For a non-live read, select the original array, such as `entries` for a
subscription plan or `collection.members` for a collection. The requests route
already selects its original requests array. Starting a snapshot page after
offset zero requires the snapshot returned by that same selection. A changed
snapshot is reported rather than combined into a new result.

~~~sh
starforge feeds-workspace-client read \
  --url "$MCP_URL" --workspace research \
  --kind subscription-plan --id "$OPML_SHA256" --array entries \
  --limit 100 --all --results /private/feed-customer/results \
  --output /private/feed-customer/subscription-entries.jsonl

starforge feeds-workspace-client read \
  --url "$MCP_URL" --workspace research \
  --kind records --id "$FEED_ID" --state all --limit 100 --all \
  --results /private/feed-customer/results \
  --output /private/feed-customer/feed-record-pages.jsonl
~~~

The CLI streams one complete page per JSONL line and publishes a selected output
file only after all selected pages finish. It keeps one page in memory. Complete
large response files remain in their own retained directories. With no
`--output`, pages stream to stdout with backpressure. Use `--max-pages` only
when deliberately selecting a shorter page sequence.

## From an original OPML source to a retained edition

Read `workspaces` first and use a declared input of kind `opml` and its exact
SHA256. The host verifies that file before the console starts intake. The
following input-file examples use the IDs, URL/configuration and revisions from
your actual source plan and workspace.

### Intake and select subscriptions

Save a private `intake.json` with the declared file handle and a durable native
operation ID:

~~~json
{
  "file": "research-subscriptions",
  "operationId": "research-opml-intake-20261012"
}
~~~

~~~sh
starforge feeds-workspace-client intake \
  --url "$MCP_URL" --workspace research \
  --input /private/feed-customer/intake.json \
  --record /private/feed-customer/requests/intake --wait \
  --results /private/feed-customer/results \
  --output /private/feed-customer/intake-result.json
~~~

Read `subscription-plan` by the actual OPML source SHA. Each original entry
carries its source ID, entry ID, outline path, URL, source metadata and any
registration match. Keep source/entry IDs together. Save the selected collection
with `collection-save` and its complete input:

~~~js
const collectionInput = {
  collectionId: selectedCollectionId,
  title: selectedTitle,
  expectedRevision: currentCollectionRevision, // 0 for a new collection
  operationId: originalCollectionSaveOperation,
  members: selectedOriginalEntries.map(entry => ({
    sourceId: entry.sourceId,
    entryId: entry.entryId,
    feedId: selectedFeedIds[entry.entryId],
    enabled: selectedEnabled[entry.entryId],
  })),
  newFeeds: completeNewRegistrationConfigs,
};
~~~

Use the plan's actual URL/configuration for each new registration. A retained
disabled entry can remain saved without a new registration. Manual members use
null source/entry IDs and an existing feed ID. Preserve the full original folder
and source history by retaining the source IDs, rather than synthesizing another
OPML document. Native collection limits remain 10,000 saved members and
1–100 enabled feeds.

Every native action can use an exact local request record:

~~~js
const prepared = feeds.prepare('merchant_feeds_action', {
  action: 'collection-save',
  input: collectionInput,
});
const received = await feeds.execute(prepared, {
  directory: '/private/feed-customer/requests/collection-save',
});
const accepted = await feeds.resolveResult(received.response.result);
const finished = await feeds.waitForJob(accepted.native.id);
~~~

A saved HTTP response may be the original RUNNING acceptance. Its native job
and operation remain separate from the local request record.

### Capture, review and apply

Read the saved collection and current feed revisions. Supply the exact
collection revision and an `expectedRevisions` entry for every enabled feed in
`collection-capture`. The original run freezes that selection. Its per-source
progress and original child capture IDs remain available through
`collection-run`.

~~~js
const captureInput = {
  collectionId: originalCollectionId,
  expectedRevision: selectedCollectionRevision,
  expectedRevisions: actualSelectedFeedRevisions,
  operationId: originalCollectionCaptureOperation,
};
const accepted = await feeds.resolveResult(await feeds.captureCollection(captureInput));
const observation = await feeds.waitForOperation({
  family: 'collection',
  operationId: captureInput.operationId,
  jobId: accepted.native.id,
});
~~~

Read each original capture's review before applying it. `apply` takes its
`captureId`, the actual feed `expectedRevision`, a durable `operationId`
and the original conflict `decisions`. Each decision maps a record identity
to `keep` or an exact candidate `contentHash`. An Atom identity change uses
the native explicit `acceptIdentity` choice. Notes, tags and starred state
are updated through `annotate` with their own original note revision.

A partial acquisition stays on its original run. Read the native operation
with its family and use the returned continuation:

~~~js
const original = await feeds.resolveResult(await feeds.operation({
  family: 'collection',
  operationId: originalCollectionCaptureOperation,
}));
const next = original.native.continuation;
if (next?.action === 'collection-resume') {
  const accepted = await feeds.resolveResult(await feeds.resumeCollection({ runId: next.runId }));
  await feeds.waitForJob(accepted.native.id);
}
~~~

### Freeze and query the original edition

After the selected captures are applied, `collection-edition` takes the
original run ID, chosen name, native fields including `key`, exact applied
feed revisions and a durable operation ID. The original result has an edition
identity and a collection binding identity. Keep both:

| Identity | Used for |
|---|---|
| Edition ID | Native query, dataset/feed-project export, comparison and publisher preparation. |
| Collection binding ID | Complete selected collection-project export. |
| Run ID | Original multi-feed acquisition, review and continuation. |
| Collection ID/revision | Saved subscription selection and OPML export. |

For a single feed, the same flow uses `register`, `capture`, `apply` and
`edition`. A source-file intake records its actual source URL/hash; HTTP
captures retain their actual response history.

### Complete original action inputs

All input JSON files passed to a named CLI action contain that action's inner
input object.

| CLI action / SDK method | Required original input |
|---|---|
| `register` / `register` | feedId, config, expectedRevision, operationId |
| `capture` / `capture` | feedId, operationId |
| `resume` / `resume` | captureId |
| `apply` / `apply` | captureId, expectedRevision, operationId |
| `annotate` / `annotate` | feedId, identity, expectedRevision, operationId |
| `edition` / `edition` | feedIds, name, fields, expectedRevisions, operationId |
| `query` / `query` | editionId; optional params of scalar strings |
| `compare` / `compare` | beforeId, afterId |
| `collection-save` / `saveCollection` | collectionId, title, members, expectedRevision, operationId |
| `collection-capture` / `captureCollection` | collectionId, expectedRevision, expectedRevisions, operationId |
| `collection-resume` / `resumeCollection` | runId |
| `collection-edition` / `collectionEdition` | runId, name, fields, expectedRevisions, operationId |

The declarations include every optional source field. `action` and the generic
`call` preserve the same complete input contracts when a tool name is selected
dynamically. Atomic amounts, query values and high-precision identifiers stay
strings; unsafe JSON integer values are rejected before dispatch.

## Publish the edition and receive a customer acquisition

Read the host's declared merchant profiles and buyer workspaces. Use
`preparePublisher({productId, editionId, profile})` with a durable product UUID,
the selected original edition and one named profile. The existing publisher
imports the original native CSV contract and both provenance files, then owns
its draft/version/release state.

~~~js
const prepared = await feeds.resolveResult(await feeds.preparePublisher({
  productId: originalProductId,
  editionId: originalEditionId,
  profile: selectedMerchantProfile,
}));
const current = await feeds.resolveResult(await feeds.publishers({
  productId: originalProductId,
}));
~~~

Use the actual returned publisher state and native revision/snapshot/generation
values for each next action. The SDK exposes all original publisher actions
through `publisher(productId, action, input)`; the CLI uses
`publisher --input PRIVATE_JSON`.

| Phase | Original action and selection |
|---|---|
| Inspect/preview | publisher.status; publisher.preview with target and query. |
| Review/publish | publisher.reviewDraft or publisher.publish with draftId, expectedSnapshot, expectedRevision. |
| Retained version | publisher.activateSnapshot with snapshot, expectedSnapshot and expectedRevision; publisher.collect with an empty input. |
| Stage/inspect | publisher.release.stage with draftId/id; publisher.release.inspect. |
| Activate/start | publisher.release.activate with id/expectedGeneration; publisher.release.start with expectedGeneration. |
| Stop/rollback | publisher.release.stop; publisher.release.rollback with expectedGeneration. |
| Review buyer offer | publisher.buyer.review with snapshot and first-page query. |
| Prepare buyer | publisher.buyer.prepare with exact review, intentId, acceptIndex and offerSha256. |
| Bind original buyer | publisher.buyer.session with buyerId, named buyerWorkspace, maxPages and maxTotalAtomic. |
| Execute/recover | publisher.buyer.run or publisher.buyer.recover with the original session ID. |
| Account/export | publisher.buyer.account or publisher.buyer.export with that session ID. |

The original SF82 publisher and configured SF88/SF100 buyer enforce their real
payment/approval and recovery contracts. A client disconnect leaves their
original saved state. Read `publishers({productId})` and retain the original
session/revision before continuing that state.

After the native buyer export exists, receive all four customer files in one
operation:

~~~js
const customer = await feeds.customerAndDownload({
  productId: originalProductId,
  operationId: originalCustomerDeliveryOperation,
  id: originalCustomerSessionId,
}, {
  directory: '/private/feed-customer/acquisition',
  onProgress: ({ file, bytes, total }) => console.error(file, bytes, total),
});
~~~

The original acquisition manifest, CSV, JSONL and HTML review are received
together. The helper checks the product/session binding and all four manifest
entries. It reads the existing export; it does not invoke a buyer execution.

The CLI's `customer.json` contains that same productId, operationId and id:

~~~sh
starforge feeds-workspace-client customer \
  --url "$MCP_URL" --workspace research \
  --input /private/feed-customer/customer.json \
  --record /private/feed-customer/requests/customer-delivery \
  --directory /private/feed-customer/acquisition
~~~

Use `publisher-export` for complete `draft-csv`, `draft-review` or
`buyer-config` selections as well. Native publisher results can also require
`resolveResult` / `--complete`.

## Portable project receiving, resume and local reopen

Create an export with its original operation ID and actual selection. Every
delivery has exact `feed-delivery.json`, native member names, byte counts,
SHA256 values and source selection.

| Export kind | Selected original ID |
|---|---|
| collection-project | Collection binding ID |
| feed-project, dataset | Edition ID |
| opml | Collection ID, optional exact revision |
| opml-source, source, http-body | Retained source/body SHA256 |
| changes | Original comparison ID |

~~~js
const result = await feeds.exportAndDownload({
  operationId: originalProjectExportOperation,
  kind: 'collection-project',
  id: originalBindingId,
}, {
  directory: '/private/feed-customer/collection-project',
});
~~~

For a delivery prepared by another agent, use `manifest` / `inspectDelivery`
and its reviewed export ID and manifest SHA:

~~~sh
starforge feeds-workspace-client inspect-delivery \
  --url "$MCP_URL" --workspace research --export "$EXPORT_ID"

starforge feeds-workspace-client download \
  --url "$MCP_URL" --workspace research --export "$EXPORT_ID" \
  --manifest-sha256 "$MANIFEST_SHA256" \
  --directory /private/feed-customer/collection-project
~~~

Repeat the identical download selection and directory after interruption.
The original downloader verifies the saved prefix, resumes its durable byte
checkpoint and reopens expired remote read handles. An uncheckpointed suffix
belongs to the same partial file and is reconciled by that original engine.
The final complete member is published create-only after its SHA matches.

The checkpoint binds the original endpoint, workspace, export and manifest.
Restart a remote MCP factory on its saved original endpoint when continuing a
partial transfer. A different export or endpoint is a different receiving
selection. A completed delivery can be opened without a live endpoint:

~~~sh
starforge feeds-workspace-client reopen \
  --workspace research \
  --directory /private/feed-customer/collection-project \
  --export "$EXPORT_ID" --manifest-sha256 "$MANIFEST_SHA256"
~~~

Local reopen checks the original manifest, checkpoint and every complete file
under the same local lease. It returns `state: "REOPENED"` with the whole
manifest and exact file/byte totals. Optional `--expected-endpoint` compares
the retained original endpoint identity. It opens no network connection.

### Import into the original receiving workspace

Connect another client to the declared destination workspace, then use either a
declared packet input or a retained source-workspace export:

~~~js
const receiving = await openFeedsWorkspaceClient({
  url: process.env.MCP_URL,
  workspace: 'receiving',
  tokenEnv: 'MCP_ACCESS_TOKEN',
  resultsDirectory: '/private/feed-receiving/results',
});
try {
  const accepted = await receiving.resolveResult(await receiving.receive({
    operationId: originalReceiveOperation,
    fromWorkspace: 'research',
    exportId: originalProjectExportId,
  }));
  await receiving.waitForJob(accepted.native.id);
  const view = await receiving.resolveResult(await receiving.read({
    kind: 'collection',
    id: originalCollectionId,
  }));
  console.log(view.native);
} finally {
  await receiving.close();
}
~~~

The destination's native receiver reconstructs the original registrations,
selected edition/source, collection history and operation lineage. Follow its
original feed or collection ledger family after a restart. Use its existing
Applications Stop/reopen flow, then query the imported original edition again.
The downloaded project can also enter the native feed/collection CLI described
in the original product guides.

## Exact local requests and uncertain transport recovery

`prepare` is local. It freezes the exact endpoint, workspace, tool arguments
and optional native recovery family/operation, and computes the request SHA.
Neither tokens nor the feed capability enter the record.

~~~sh
starforge feeds-workspace-client prepare \
  --url "$MCP_URL" --workspace research --tool collection-capture \
  --input /private/feed-customer/capture.json \
  --request /private/feed-customer/capture-request.json \
  --record /private/feed-customer/requests/capture

starforge feeds-workspace-client execute \
  --request /private/feed-customer/capture-request.json \
  --record /private/feed-customer/requests/capture \
  --token-env MCP_ACCESS_TOKEN
~~~

Native action operation IDs automatically retain their original feed/collection
family. Other tools can explicitly select a known native recovery family and
operation during prepare; both remain part of that saved exact request.

The local record states mean:

| State | Retained local evidence | Next original action |
|---|---|---|
| PREPARED | Exact request, no invocation marker. | Execute that saved request. |
| RECONCILIATION_REQUIRED | Invocation marker, no saved response. | Read the existing native worker/operation first. |
| RESPONSE_RETAINED | Exact original structured response and digest. | Reopen locally; follow its native job/result separately. |

A second `execute` returns the saved response locally when it exists. If
dispatch may have happened and the response is absent, it reports that state
instead of automatically resending a mutation.

~~~sh
starforge feeds-workspace-client inspect-request \
  --record /private/feed-customer/requests/capture

starforge feeds-workspace-client reconcile \
  --record /private/feed-customer/requests/capture \
  --token-env MCP_ACCESS_TOKEN --results /private/feed-customer/results

starforge feeds-workspace-client wait \
  --url "$MCP_URL" --workspace research \
  --operation "$ORIGINAL_OPERATION_ID" --family collection \
  --job "$ORIGINAL_ACCEPTED_JOB_ID" --results /private/feed-customer/results
~~~

Reconcile reads the original console status and, when its worker is idle, the
same family-scoped native ledger and selected publisher state. It preserves the
exact request, invocation and received response. A native normalized ledger
payload is returned as that original observation; it does not replace the saved
client request.

`INTENT_RETAINED` can include the original partial capture/run and its supported
continuation. `RESULT_RETAINED` preserves its actual native result status.
Carried `historyOnly` remains retained history. An actual unknown-operation
404 is returned as `OPERATION_NOT_FOUND`; it does not establish that an
ambiguous request was never dispatched. A different current console job is
reported with its own identity.

After inspecting that state, use the original native continuation or explicitly
repeat the identical prepared request with `execute --repeat` when that is
the appropriate native operation. The flag changes neither its arguments nor
its operation ID. Reconcile never starts a capture, import or payment.

## Cancellation and shutdown

Per-call `signal`, client lifetime `signal`, `timeoutMs` and wait limits
cover original HTTP calls and local receiving/hash work. `requestClose()`
stops new client admission and aborts current client work. `close()` drains
accepted calls and retained local cleanup owners. When native cleanup reports a
failure, retry `close()` on that same client instance.

A client cancellation does not stop the independently accepted console worker.
Use `cancel(originalJobId)` or `cancel --job ORIGINAL_JOB_SHA256` for that
explicit native action. The host checks the currently running exact job under
its original worker lock.

The CLI retains SIGINT/SIGTERM and stdout/stderr error listeners through its
cleanup. It stops its calls, drains the original owners, then returns 130 for
SIGINT, 143 for SIGTERM, or a nonzero failure code for an output error. A broken
stderr cannot interrupt that cleanup. The original managed Applications owner
retains the feed console and its own worker Stop/drain.

## Installed source and receiving integration

The original `merchant-provider-feeds-workspaces` contribution includes this
command, typed exports and guide beside its unchanged provider registration.
The package closes imports to the existing lightweight retained downloader,
manifest parser and request lease. No client dependency on the whole running
merchant factory is introduced.

For an existing complete native receiving journey, add this client at the
original opened MCP phase. Preserve its listener endpoint, native source
binding, workspace, operation/run/edition/product and buyer session. Exercise
a complete original large result, stream a retained project, interrupt after an
actual durable non-final chunk, close/reopen that same factory, resume the same
directory and verify completed files locally. The same receiver then uses the
original destination console and publisher/customer results. Retain its
observed manifest and final original native results with that one operation.

Source map:

- `feeds-workspace-client.mjs`: all original tools, paging, full JSON results,
  exact request/native reconciliation and customer delivery.
- `feeds-workspace-request.mjs`: private immutable request, invocation and
  response publication with the original lease.
- `feeds-workspace-cli.mjs`: complete terminal workflow and output lifetime.
- `feeds-download.mjs`: original streaming engine adapter and local reopen.
- Matching `.d.mts` files: complete public Node types.
- `feeds-workspace.mjs` / `catalog/feeds-workspace.mjs`: original provider
  and native tool authority.
