# NocoDB deployment and customer receiving

This workflow starts with an originally reviewed and published NocoDB capture.
It prepares a native SF82 dataset package and continues through the existing
release store, merchant console and customer client exports.

The NocoDB bridge owns the source-to-package binding. The original SF82
implementation owns release IDs, runtime normalization, child processes,
readiness, active selection, rollback, stop, buyer discovery and client export
history. The original dataset controller remains the only version writer.

## The complete operating chain

| Stage | Original retained input | Result |
| --- | --- | --- |
| Source intake | Authorized server, v3 base/table/view/filter and field IDs | Full before/after schema and count responses plus every original page |
| Freeze | Complete original capture directory | Private source bound to the exact capture manifest |
| Candidate | Saved publisher plan and run UUID | Typed CSV, dataset schema and original extraction observation |
| Publication | Exact candidate review and target revision | Original immutable dataset snapshot |
| Package review | Published run and public seller terms | Review SHA-256 binding source, dataset and seller terms |
| Package preparation | Same review and request directory | Original five-file SF82 dataset package |
| Release stage | Exact package source hash and original release ID | Native retained VERSIONED_DATASET_PACKAGE release |
| Customer receiving | Original running release and reviewed buyer offer | Retained client configuration, OpenAPI, JS/types, package, guide and receipt |

No stage requires another NocoDB request after the candidate is published.
The customer receives the reviewed dataset contract. Private table metadata,
API tokens, original full response pages and operator configuration are not
copied into the seller package.

## 1. Finish the original publication

Follow [README.md](README.md) for discovery, complete capture, freeze, plan,
extraction, review and publication. Keep the original publisher directory and
run UUID. A READY or REVIEWED candidate is not a PUBLISHED source and cannot be
packaged as a deployed publication.

A NocoDB source plan ID identifies a local immutable publication plan. It is not
a NocoDB database revision or a new provider version number. The deployment
source stores that plan ID, its source hash and the exact captured observation
hash from the original candidate.

Close the publisher browser or merchant MCP owner before using a separate
deployment CLI process. The same original kernel lease prevents two publisher
writers. The source API may be closed while deployment, customer generation and
buyer reads continue from the retained publication.

## 2. Save the actual public seller terms

Create a private JSON file containing only the public seller configuration:

```json
{
  "origin": "https://data.example.com",
  "path": "/catalog",
  "payment": {
    "scheme": "exact",
    "network": "REPLACE_WITH_REVIEWED_NETWORK",
    "asset": "REPLACE_WITH_REVIEWED_ASSET",
    "amount": "REPLACE_WITH_REVIEWED_BASE_UNIT_AMOUNT",
    "payTo": "REPLACE_WITH_ACTUAL_RECIPIENT",
    "maxTimeoutSeconds": 60
  }
}
```

This is a shape example, not executable payment terms or a supplied wallet.
Use the already selected merchant, network, asset, recipient and amount.
The original seller compiler validates the actual offer. The origin must be a
canonical public HTTPS origin and the resource must be one fixed path. Wallet
secrets and provider tokens do not belong in this file.

## 3. Review the original candidate as a deployment

```sh
starforge nocodb-deployment review \
  --publisher /private/nocodb/publications \
  --run ORIGINAL_PUBLISHED_RUN_UUID \
  --terms /private/nocodb/seller-terms.json
```

Review the original plan, capture hash, dataset snapshot, rows, columns, public
query surface, origin, path and payment terms in the result. Keep the returned
reviewSha256. This read checks the original candidate file hashes and exact
publication/review relationship; it does not re-extract, publish or query NocoDB.

A changed candidate, source, capture, publication or payment contract invalidates
this review. Re-read the actual original state rather than supplying a guessed
digest.

## 4. Prepare the native package

```sh
starforge nocodb-deployment prepare \
  --publisher /private/nocodb/publications \
  --run ORIGINAL_PUBLISHED_RUN_UUID \
  --terms /private/nocodb/seller-terms.json \
  --review ORIGINAL_REVIEW_SHA256 \
  --out /private/nocodb/deployment-001
```

The package directory must be separate from the publisher and dataset version
directories. Preparation creates private files under its original kernel lease,
validates through the original SF82 dataset reader, and publishes the files
with identical-input recovery:

| File | Contents |
| --- | --- |
| dataset.csv | The original reviewed candidate's public scalar rows |
| dataset.json | Its original dataset contract with the local CSV path |
| seller.json | The compiled public seller terms and pinned-snapshot query surface |
| source.json | Original source-plan, capture, candidate, review, publication and merchant hashes |
| binding.json | The existing host-local dataset directory, native contract hash and baseline snapshot |

The binding is host-local. Moving the five files to another host does not copy
the underlying version store or make its absolute path valid there. A host
transfer must use the original dataset recovery/receiving workflow to retain
the full version state, then prepare against the actual retained local target.
Do not create an empty substitute store or rewind a customer's current dataset.

After a lost preparation reply, rerun the identical request against the same
directory. Changed inputs under that request directory fail as a conflict.
Inspect the original package with:

```sh
starforge nocodb-deployment inspect --package /private/nocodb/deployment-001
```

Keep the returned sourceSha256 for staging. Inspection checks through the same
original package reader and returns the actual five file hashes and native
dataset binding.

## 5. Stage through the existing release store

```sh
starforge nocodb-deployment stage \
  --package /private/nocodb/deployment-001 \
  --store /private/nocodb/releases \
  --id catalog-001 \
  --source ORIGINAL_PACKAGE_SOURCE_SHA256 \
  --label "NocoDB catalog"
```

The default runtime chooses an available local port. A private runtime JSON may
provide only the original port, facilitator and allowLocalFacilitator options.
Choose the existing merchant runtime and facilitator; a configured package is
not evidence of a paid transaction.

The stage command first inspects the original release ID. An identical package,
label and normalized runtime return that same release. If the ID already names
different work, the command preserves it and returns a conflict. Release storage
must be separate from both the package and dataset state.

## 6. Operate and deliver through the original console

```sh
starforge nocodb-deployment console \
  --store /private/nocodb/releases \
  --client-exports /private/nocodb/client-exports
```

This is the original SF82 console. Its actual startup options and help remain
available through the same command. Continue the original staged release:

1. Inspect the retained source, runtime and dataset binding.
2. Start it through the original release action and wait for actual readiness.
3. Review its returned public discovery/schema and unpaid request challenge.
4. Activate the intended release and keep its original ID.
5. Prepare the client handover through the original client-export owner.
6. Download the retained complete client files and receipt from that same export.
7. Reopen the original console and export record to verify the receiving path.

The native client handover supplies the existing JavaScript client, type
declarations, OpenAPI, package/README and exact request configuration. Use its
actual supported output files; there is no separate NocoDB client generator or
shadow export store.

Keep [SF82 client handover](../../sf82-seller-pilot/CLIENT_HANDOVER.md) with the
customer operation. Customer preparation is distinct from an authorized
signature, payment, settlement or accepted commercial scope. Report each actual
state accurately.

## Refresh and retained buyers

Future source refreshes go through the original NocoDB publisher plan and target
revision. The dataset version store continues to own snapshot IDs and retention.
An existing buyer's pinned snapshot remains governed by that original store.

Keep the source/page capture that generated each review, including its actual
time window and count/schema observations. An old capture can be replayed for
receiving and recovery; it does not become a newer provider observation.

If a new public contract changes columns, types, filters or limits, prepare and
review the new original package and release under its own intended ID. A client
configuration generated for an old contract must not silently become a client
for a different dataset.

## Failure and interruption handling

| Situation | Retained action |
| --- | --- |
| Publisher already open | Continue through the running original owner or close it before this CLI opens the same directory. |
| Unpublished or changed run | Inspect/recover that original run, complete its original review/publication, then review deployment again. |
| Source/candidate/hash mismatch | Preserve the changed source and package; review the actual original state. |
| Preparation interrupted | Repeat the identical request to the same package directory. |
| Release stage reply lost | Inspect the same original release ID; identical input reuses it. |
| Runtime readiness fails | Read the original release process/status/log through SF82 and fix that source/runtime cause. |
| Active selection reply lost | Read the original active release before issuing another action. |
| Buyer offer changes | Review the actual returned offer before preparing another client configuration. |
| Customer needs a prior snapshot | Use the original retained dataset version and buyer pin; do not manufacture a new snapshot identity. |
| Host must move | Transfer and receive the original dataset/release state through the original recovery workflow, preserving its full retained versions. |

## Module interface

The installed module is
`@tokenjunkielabs/starforge-merchant/seller/nocodb/deployment`.
It exports reviewNocoDBDeployment, prepareNocoDBDeployment,
inspectNocoDBDeployment, stageNocoDBDeployment and readNocoDBDeploymentFile.

Review and preparation receive the already opened original NocoDB publisher and
runId. The source plan and observation identity are derived from its retained
candidate. A caller cannot supply a different alleged capture version.
The package file reader permits only the original five files and verifies their
current bytes before returning a requested download.
