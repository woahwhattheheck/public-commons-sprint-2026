# Customer request collections

Prepare a set of merchant requests, review their exact spending caps together,
and retain every original buyer intent and delivered result in one collection.
The collection controller uses the existing SF88 inbox for enqueueing, execution,
cancellation and recovery. Its private browser and terminal commands operate the
same saved collection.

A useful collection might contain the report, source dataset and reference
documents needed for one customer handoff.
An existing request can appear in several collections when its original queue
execution configuration and retained request match exactly. Those collections
show the same original attempt and cancellation history. Each request keeps its own merchant,
network, asset, recipient, original request body, ticket, signer, operator policy
and response destination. Requests sharing an operator also share that
operator's existing spending ledger.

## Open the workspace

Use the complete installed toolkit on Linux with Node 22 or newer and the
existing util-linux `flock` command. Keep collection state and the original inbox
in private persistent directories outside the software installation.

Start with a new original inbox when one does not already exist:

```sh
starforge inbox init --root /srv/operator/buyer-inbox
starforge buyer-collections serve \
  --directory /srv/operator/request-collections \
  --queue-root /srv/operator/buyer-inbox \
  --port 8474
```

Open the private operator URL printed by the server. A reopened collection store
reads its saved inbox binding, so `--queue-root` can be omitted after the first
open. The separate `buyer-collections-workspace` command starts the same
server. From a source checkout, the command is:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/cli.mjs \
  serve --directory /srv/operator/request-collections \
  --queue-root /srv/operator/buyer-inbox --port 8474
```

Use the original [buyer workspace guide](../README.md) to prepare each complete
operator configuration. Each configuration needs its stable intent, concrete
resource, selected accepted terms, original operator and signer, private evidence
directory and intended response file. A request body or operation ticket keeps
its existing original format. Select the existing configuration files in the
collection form, inspect the request list and grouped caps, and save a named
collection. The browser provides the exact terminal command for execution.

## Review and retain the actual inputs

The equivalent terminal flow starts with a preview:

```sh
starforge buyer-collections preview \
  --config /srv/operator/report/operator.json \
  --config /srv/operator/reference/operator.json
```

The result contains `previewSha256`, every concrete request, source-config
hash, original body and ticket identities, signer and policy file pins, response
destination, and grouped maximums. Copy the returned digest into create:

```sh
starforge buyer-collections create \
  --directory /srv/operator/request-collections \
  --queue-root /srv/operator/buyer-inbox \
  --id monthly-customer-handoff \
  --name "Monthly customer handoff" \
  --preview-sha256 RETURNED_PREVIEW_SHA \
  --config /srv/operator/report/operator.json \
  --config /srv/operator/reference/operator.json
```

Creation retains the original configuration bytes and copies the actual request
body and ticket into private per-entry files. A derived execution configuration
points to those retained files. The selected signer entry and live operator
policy remain in their original locations with their observed hashes. The
original ledger and key custody stay with the original operator workspace.

The preview digest covers the actual source files, body and ticket identities,
request, operator dependency pins and response destinations. A changed input
requires a fresh preview. Collections contain 1–500 distinct original intents;
their combined original configs, bodies and tickets may occupy up to 128 MiB.
Empty request bodies retain their own zero-byte identity. Repeated URLs are
allowed with distinct original intents; repeated intent IDs within one
collection are rejected.

The immutable manifest pins membership, source and display name. To prepare a
different set, create a separately named collection with the intended original
requests. An existing identical collection reopens even after the original
authoring files have moved. If creation was interrupted before all input files
were retained, repeat the same create command with its same reviewed inputs.
Existing complete input files are verified and reused.

## Review exact cap groups

Every maximum remains an integer string in its original asset's atomic units.
The controller groups by network, asset, recipient, scheme and payment flow.
For example, two selected requests capped at 10,000 and 25,000 atomic units for
the same recipient and asset produce a reviewed maximum of `35000`.
Another asset or recipient creates another row. No floating-point arithmetic
or currency conversion is involved.

These are selected request caps. The original buyer obtains each fresh
merchant challenge and records its actual outcome. The original SF36 policy
and ledger retain their current operator-wide spending rules.

## Enqueue and operate the selected requests

Show the collection and retain its returned `manifestSha256`:

```sh
starforge buyer-collections show \
  --directory /srv/operator/request-collections --id monthly-customer-handoff

starforge buyer-collections enqueue \
  --directory /srv/operator/request-collections --id monthly-customer-handoff \
  --manifest-sha256 RETURNED_MANIFEST_SHA
```

Enqueue uses the original inbox constructor for each retained configuration. It
snapshots the original request into the existing queue, preserving its intent.
If a process stops after some entries, repeat enqueue on the same collection.
Already-matching jobs are inspected and retained; the controller continues with
the missing entries. An error is returned with the exact entry that needs
attention, and completed entries remain available.

An already-enqueued original configuration can be adopted when its exact source
bytes, normalized operation, body, ticket, signer and policy pins match. For an
input previously prepared by another retained collection, select that original
queue job's `source-config.json` as the source configuration. Existing
attempts, cancellations and outcomes stay attached to their same original jobs.
A source or intent conflict is visible in the collection. If a previously
recorded queue job is later missing, restore the original inbox through its
existing recovery procedure.

Run explicitly selected entries in the original operator terminal:

```sh
starforge buyer-collections run \
  --directory /srv/operator/request-collections --id monthly-customer-handoff \
  --manifest-sha256 RETURNED_MANIFEST_SHA \
  --intent report-original-intent --intent reference-original-intent \
  --workspace /srv/operator/shared-workspace
```

The original buyer prompts for each selected request and supplies its original
signer, spending reservation, transport, payment and response-file behavior.
The collection proceeds sequentially. It stops when the current request needs
review, returns an error, has an unresolved response, or is interrupted.
Previously recorded original attempts are inspected rather than executed again.

When requests use different existing operator workspaces, supply one mapping
per selected intent instead of a shared workspace:

```sh
starforge buyer-collections run \
  --directory /srv/operator/request-collections --id monthly-customer-handoff \
  --manifest-sha256 RETURNED_MANIFEST_SHA \
  --intent report-original-intent --intent reference-original-intent \
  --workspace-for report-original-intent=/srv/operator/report \
  --workspace-for reference-original-intent=/srv/operator/reference
```

Omitting the workspace flags uses the existing original environment-based
execution path. Each queued operation still retains its own saved configuration.

Ctrl+C pauses the collection after the original buyer finishes its cancellation
and cleanup. Reopen the same store to inspect the current outcome. After
reviewing the saved attempts, explicitly select the remaining queued requests:

```sh
starforge buyer-collections run \
  --directory /srv/operator/request-collections --id monthly-customer-handoff \
  --manifest-sha256 RETURNED_MANIFEST_SHA --remaining
```

The selected stable intents are printed before the original terminal prompts.
An interrupted queue attempt remains in the inbox and is excluded from this
remaining-request selection.

## Cancel and recover

Cancel selected requests that remain queued, or recover a selected original
attempt from its original evidence:

```sh
starforge buyer-collections cancel \
  --directory /srv/operator/request-collections --id monthly-customer-handoff \
  --manifest-sha256 RETURNED_MANIFEST_SHA --intent reference-original-intent

starforge buyer-collections recover \
  --directory /srv/operator/request-collections --id monthly-customer-handoff \
  --manifest-sha256 RETURNED_MANIFEST_SHA --intent report-original-intent
```

Cancellation and recovery call the original inbox methods. An already attempted
entry remains available with its current state and history. The original
[evidence and financial-finalization guides](../FINALIZATION.md) cover an
unresolved payment or missing settlement receipt. A recovery record continues
to distinguish its original evidence from the separately saved response file.

The private collection lock coordinates CLI and browser mutations. It is held
by the kernel and released when the owning process exits. An action that finds
another operation reports `COLLECTION_BUSY`; refresh the same collection
after that original operation finishes.

## Handoff and reopening

Export a reviewed result index to a private directory:

```sh
starforge buyer-collections export \
  --directory /srv/operator/request-collections --id monthly-customer-handoff \
  --manifest-sha256 RETURNED_MANIFEST_SHA \
  --out /srv/operator/exports/monthly-customer-handoff
```

The export contains:

| File | Contents |
| --- | --- |
| `collection.json` | Immutable collection, source files, exact request identities and grouped caps |
| `results.json` | Original queue records, attempts, outcomes, recovery and collection run history |
| `requests.csv` | Request-by-request state, native response and retained delivery index |
| `review.html` | Offline grayscale review with complete source and delivery references |
| `manifest.json` | Completion timestamp plus exact byte counts and hashes of the four files |

If export is interrupted, the retained first `results.json` freezes that
same snapshot for continuation. Repeat export into the same directory to finish
or reopen its complete original files. A new output directory creates a newer
snapshot. Keep exports outside the original inbox and the store's internal
`collections/` directory; a sibling `exports/` directory is supported.

The result index names original delivered paths and their recorded hashes and
sizes. Keep those files with the inbox, original evidence and operator ledger
when transferring the complete customer operation. Collection files use mode
0600 and their directories use mode 0700. Keep private configuration, requests,
tickets and results in the operator's normal private storage.

## Application API

```js
import { openCollections } from './collections/model.mjs';

const collections = await openCollections({
  directory: '/srv/operator/request-collections',
  queueRoot: '/srv/operator/buyer-inbox',
});
const preview = await collections.preview({configFiles: [
  '/srv/operator/report/operator.json',
  '/srv/operator/reference/operator.json',
]});
const saved = await collections.create({
  id: 'monthly-customer-handoff',
  name: 'Monthly customer handoff',
  configFiles: preview.items.map(item => item.sourceConfig.path),
  expectedPreviewSha256: preview.previewSha256,
});
await collections.enqueue({
  id: saved.id,
  expectedManifestSha256: saved.manifestSha256,
});
console.log(await collections.inspect(saved.id));
await collections.close();
```

The browser uses the same preview, create, list, inspect, enqueue, cancel,
recover and export methods. Terminal callers use
`run({id,intentIds,expectedManifestSha256,signal,workspaceByIntent})`.
Each mutable collection action carries its inspected immutable manifest digest.
Original queue errors remain visible under their existing `INBOX_*` names;
collection errors identify source review changes, missing inputs, conflicts or
a currently owned operation.

| Collection state | Meaning |
| --- | --- |
| PREPARING | Creation has retained its manifest and needs remaining input files |
| PREPARED | The complete input collection is saved |
| ENQUEUE_PARTIAL | Some original jobs are available and others remain to be enqueued |
| QUEUED | Every original entry is queued |
| PARTIAL | Some requests are attempted or cancelled and queued requests remain |
| NEEDS_REVIEW | An original attempt is running or interrupted |
| FINISHED | Every entry has an original attempt or cancellation record |
| CANCELLED | All entries were cancelled before their attempts |
| REVIEW_REQUIRED | A source, input or original queue record needs attention |

Collection state describes operating progress. Full native buyer and response
file outcomes remain available for each original request.


## Run the retained-inbox example

The included Linux example demonstrates the whole collection preparation and
handoff in a new private directory. It uses the original inbox implementation
to adopt one existing request, retain three configured requests and their exact
body bytes, group large integer caps, reuse one original request in a second customer
review, pause a selected run, cancel one original entry, export the saved result
index and reopen the same records.

Run it from a complete installed source checkout with the existing native
dependencies and util-linux `flock` available:

```sh
node --max-old-space-size=192 \
  stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/examples/lifecycle.mjs \
  /absolute/new-private-collection-example
```

The chosen parent directory must already exist. The example retains its
original inbox, request collection, exported files and
`lifecycle-result.json` there. Its three clearly named example profiles use a
preparation-only signer. Use your actual private operator configurations and
the terminal run command above for a customer purchase.
