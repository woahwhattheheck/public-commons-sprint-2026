# gRPC contract upgrades: merchant agents, CLI and complete receiving

A retained upgrade joins an existing saved merchant revision, an explicitly
selected candidate contract, a complete proposed merchant plan and the original
native compatibility review. Its review UUID and SHA256 remain the reference
through field inspection, correction, adoption and transfer to another operator.

Use this workflow when a supplier changes a captured protobuf contract, reflected
descriptor, connection limits, method selection, request example, public route or
payment terms. The original [native upgrade engine](../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/UPGRADES.md)
computes the field, map, presence, oneof, method and route consequences. The
merchant tools and CLI operate that same saved review and revision writer.

## Installed entrypoints

The source-owned distribution contribution is
distribution/contributions/grpc-upgrade-agent.json. It adds the installed
grpc-upgrade command and these interfaces:

| Interface | Purpose |
| --- | --- |
| ./seller/grpc/upgrade-cli | upgradeMain for the original local or running workspace |
| ./seller/grpc/upgrade-receiving | collect, receive and reopen the four complete native records |
| ./merchant/mcp/grpc/upgrades | Original merchant-agent upgrade continuation |
| ./merchant/mcp/grpc/upgrade-receiving | Resumable MCP receiving followed by source/review verification |

The existing grpc/cli.mjs also delegates its upgrade subcommand to this command.
The six tools appear in the original merchant MCP when its gRPC workspace
configuration is installed. Reuse the same workspace alias, private console
reference, merchant export directory and credentials described in
[GRPC_WORKSPACE.md](GRPC_WORKSPACE.md).

The native workspace must contain contract-upgrade.mjs and workspace/upgrade.mjs
with the four upgrade routes. An older workspace reports GRPC_UPGRADE_SOURCE_REQUIRED
when its upgrade index is requested. Install the selected complete source and
reopen that original workspace.

## Review an existing merchant change

First read merchant_grpc_status and merchant_grpc_revision for the selected base
revision. Keep its complete plan, including publicOrigin, top-level and per-route
payment/paymentOptions, route order, examples and descriptions.

Select one candidate:

- An existing saved revision by its original SHA256.
- A retained reflection capture by its original UUID and captureSha256. The
  existing reflection workflow provides the reviewed service inventory, selected
  services, exact descriptor bytes and full import closure.

Capture the supplier update once. Subsequent upgrade operations use those
retained bytes. A reflected candidate's connection is normalized through the
original source configuration, preserving its environment references and limits.

Call merchant_grpc_upgrade_review with a newly chosen UUID, the current base
revision, the selected candidate, the full proposed plan and a title:

~~~json
{
  "workspace": "analytics",
  "operationId": "c58f5643-c59a-4faf-9631-c46f0c2cd01a",
  "baseRevision": "BASE_REVISION_SHA256",
  "candidate": {
    "kind": "reflection",
    "id": "RETAINED_CAPTURE_UUID",
    "captureSha256": "RETAINED_CAPTURE_SHA256"
  },
  "title": "Analytics supplier contract update",
  "plan": {
    "schema": "stellar-forge.grpc-merchant-plan.v1",
    "publicOrigin": "https://merchant.example",
    "paymentOptions": [],
    "routes": []
  }
}
~~~

Replace the illustrated plan with the full current merchant plan and intentional
edits. Empty payment/route lists in the illustration are placeholders; the native
review retains an invalid plan with its exact correction reason.

For a saved-revision candidate, supply
{"kind":"revision","id":"CANDIDATE_REVISION_SHA256"} instead. The base must be the
original workspace's selected revision when a new review is created.

Review creation returns the original review digest, candidate/source identity,
contract and route summaries, plan validation and the selection generation.
Its native request examples are normalized and serialized against the candidate
contract during review. The report retains the actual error when a selected
example or merchant plan needs correction.

## Inspect the complete consequences

| Tool | Original state it operates |
| --- | --- |
| merchant_grpc_upgrade_reviews | Complete saved review index, with snapshot paging |
| merchant_grpc_upgrade_review | Immutable review UUID and complete input |
| merchant_grpc_upgrade_open | Original report, plan, source, adoption, or paged changes |
| merchant_grpc_upgrade_method | Candidate method's original request/response schema |
| merchant_grpc_upgrade_adopt | Exact reviewed SHA256 and original selection/generation |
| merchant_grpc_upgrade_export | Complete original review and three associated source/plan files |

Open the same review with section changes, methods and routes. Continue pages
using nextOffset and expectedSnapshot. Page offsets above zero require that
snapshot, and a changed inventory returns GRPC_INVENTORY_CHANGED.

The changes and methods sections retain the native comparison IDs, levels and
affected request/response methods. The routes section carries both original and
candidate route identities, ordered payment options, public paths, method
changes, contract hashes and the original/selected request example results.
Use section plan for the entire selected plan and section source for both exact
connection configurations.

merchant_grpc_upgrade_method supplies the candidate's full native schema,
including protobuf field metadata. Use it to make a concrete request correction.
An oversized complete response returns COMPLETE_RESULT_RETAINED and its delivery;
receive that JSON through the original export tools before continuing.

After editing any review input, choose a new review UUID and submit the complete
corrected plan against the intended current base. The former review remains in
history. Reusing an ID with changed input returns GRPC_UPGRADE_OPERATION_REUSED.

If a review response is interrupted, call merchant_grpc_upgrade_open with its
same operationId. The retained review becomes the continuation. If creation
never reached the native store, repeat the original review input and same UUID.

## Adopt and prepare the reviewed merchant

Call merchant_grpc_upgrade_adopt with workspace, operationId and the exact
expectedReviewSha256 returned by the review. The original store checks the
review digest, validated plan and saved base revision/generation, then writes
the candidate contract and full plan through its existing revision save.

The result includes the original adoption and saved revision. Keep that revision
SHA for the following workflow:

1. Read merchant_grpc_revision and merchant_grpc_method for the adopted revision.
2. Use merchant_grpc_review for its actual channel/readiness check.
3. Run an intentional typed request through merchant_grpc_call when needed,
   retaining that call's own operationId and original result.
4. Prepare with merchant_grpc_prepare and a separate explicit preparation UUID.
5. Export the complete customer through merchant_grpc_export, kind customer.
6. Use the original stage/diff/activate/run/drain/rollback controls for the
   prepared merchant and the observed release generation.

The upgrade and call/preparation UUIDs represent different original actions.
Keep each result under its own identity.

An interrupted adoption is recovered by opening its same review, then repeating
the same adoption digest when necessary. The native store retains its adoption
intent and completed revision. A completed adoption reopens that same result
even if the workspace later selects another revision. A stale, incomplete
adoption returns the original selection conflict so the operator can inspect
the new current revision and create a fresh review.

## Complete portable receiving

Call merchant_grpc_upgrade_export with the original review UUID and digest.
The export retains four complete JSON files:

| File | Retained content |
| --- | --- |
| grpc-upgrade-review.json | Original immutable report plus current adoption/intent/selection |
| grpc-upgrade-base.json | Full original base revision, source, proto/import closure and plan |
| grpc-upgrade-candidate.json | Full candidate revision or original reflected descriptor capture |
| grpc-upgrade-plan.json | Complete selected merchant plan, including ordered payment terms |

The original grpc-workspace-export.json manifest pins every file's byte count
and SHA256, the base revision, review UUID and review digest. Its exportId also
covers that complete manifest identity. The review record is capped at9MiB,
each complete source record at40MiB, the plan at262,145 bytes and the entire
upgrade transfer at96MiB.

Use the existing original transport from Node:

~~~js
import { downloadGrpcUpgrade } from
  './stellar-forge/mcp-merchant-operator/grpc-upgrade-download.mjs';

const received = await downloadGrpcUpgrade({
  url: process.env.ORIGINAL_MCP_URL,
  tokenEnv: 'ORIGINAL_MCP_TOKEN',
  exportId: process.env.REVIEWED_EXPORT_ID,
  expectedManifestSha256: process.env.REVIEWED_MANIFEST_SHA256,
  expectedReviewSha256: process.env.REVIEWED_UPGRADE_SHA256,
  directory: '/private/receiving/analytics-upgrade',
  chunkSize: 196608,
  verifyNative: true
});
console.log(JSON.stringify(received, null, 2));
~~~

A supplied original {endpoint, call} client may replace url for an installed
adapter. The receiving engine checkpoints verified prefixes under transfer/,
reopens expired read snapshots, verifies complete files and materializes the
four original paths beside the completion manifest. Repeat the same invocation
to resume or verify the completed transfer. Every input digest remains pinned.

The receiver checks the native review/request hashes, original revision
identities, reflected capture identity when selected, both source configurations,
the complete plan and any adoption's target revision/generation. verifyNative
also compiles both original captured contracts and the candidate merchant plan,
then compares the native customer-method/service identities with the review.

Hash/source receiving works with the merchant HTTP client dependencies alone.
Enable native compilation on an equipped original gRPC runtime. Its pinned
compiler handles descriptors directly, including maps, presence and default
metadata.

To use the existing command-line downloader first:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs download-grpc \
  --url http://127.0.0.1:3211 \
  --export-id REVIEWED_EXPORT_SHA256 \
  --manifest-sha256 REVIEWED_MANIFEST_SHA256 \
  --out /private/receiving/analytics-upgrade \
  --chunk-bytes 196608

node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/upgrade-cli.mjs inspect \
  --directory /private/receiving/analytics-upgrade \
  --review-sha REVIEWED_UPGRADE_SHA256
~~~

A later export after adoption or another selection can carry updated visible
adoption metadata and therefore a different exportId. Give that complete export
its own receiving directory. Keep the original immutable review UUID/digest
while retaining each selected export's exact identity.

The separate original customer export still contains all seven usable customer
paths: methods.json, openapi.json, client/seller-client.mjs,
client/seller-client.d.mts, client/seller-openapi.json, client/package.json and
client/README.md. That receiver reconstructs client/ and supports the same
interrupted, resumed and repeated delivery.

## Operate the running workspace from the CLI

Store the exact native workspace URL in a private file. It contains the
loopback origin and existing capability fragment printed by the workspace.
The CLI reads it in memory and authenticates to the same original routes.
Use --console-url-file while the browser/workspace is running.

~~~sh
grpc-upgrade list --console-url-file /private/grpc-console.url

grpc-upgrade open --console-url-file /private/grpc-console.url \
  --id REVIEW_UUID --section plan --out /private/reviewed-plan.json

grpc-upgrade review --console-url-file /private/grpc-console.url \
  --id NEW_REVIEW_UUID --base BASE_REVISION_SHA256 \
  --capture RETAINED_CAPTURE_UUID --capture-sha RETAINED_CAPTURE_SHA256 \
  --plan /private/corrected-plan.json --title "Corrected supplier update"

grpc-upgrade open --console-url-file /private/grpc-console.url \
  --id NEW_REVIEW_UUID --section routes --limit 50

grpc-upgrade method --console-url-file /private/grpc-console.url \
  --id NEW_REVIEW_UUID --method /supplier.Analytics/Lookup

grpc-upgrade adopt --console-url-file /private/grpc-console.url \
  --id NEW_REVIEW_UUID --review-sha REVIEW_SHA256

grpc-upgrade export --console-url-file /private/grpc-console.url \
  --id NEW_REVIEW_UUID --review-sha REVIEW_SHA256 \
  --out /private/analytics-upgrade
~~~

For a closed local workspace, replace --console-url-file with --state and its
existing private directory. The CLI acquires that original workspace's writer
lease and releases it when the command finishes. Choose exactly one connection.
Read-only inspection of a received directory needs neither connection.

Commands producing one JSON result support --out NEW_JSON, written atomically
as a new private file. Existing destinations remain preserved. The export
command writes four complete private files. Repeating an export for the same
immutable review keeps the first saved review observation, including its original
current-selection and adoption state, and completes any missing source/plan file.
Later workspace selection changes leave those received bytes intact. Use a new
directory to capture a later adoption observation. Different review/source/plan
closures continue to conflict with an existing destination.
Offline inspect defaults to native compilation; use --verify hashes on an
operator host that only has the HTTP receiving dependencies.

## Receiving boundaries and recovery

A received upgrade remains a portable record of its original review and sources.
To operate it in another native workspace, use the original complete revision
import with the destination's current base revision, then create that workspace's
new review from the retained candidate. Its writer generation and current
selection belong to that destination. The original exported review stays
available for comparison and handover.

Connection values preserve the original environment references. Set their
actual credentials in the receiving host's existing private environment before
channel review or intentional calls. Keep the original source, review,
preparation and release identities in the customer's handover.

## Join the original native receiving operation

The composable driver experiments/grpc-upgrade-agent-phase-20261012-9b23.mjs
accepts the original running console's private URL file, adopted review UUID
and already-prepared customer UUID. Its exported runGrpcUpgradeAgentReceiving
function takes sourceRoot, sourceCommit, directory, consoleUrlFile, reviewId,
preparationId and the original environment. Supply client and workspaceAlias to
reuse the original initialized retained-file MCP client and configured workspace;
its listener remains with the native owner. The native owner can supply an
applicationCalls callback to record the same service's call count before/after.

It operates all six agent tools over the actual MCP endpoint, pages complete
native changes/methods/routes, recovers the original review/adoption through
both agent and CLI, interrupts/resumes/repeats four-file receiving, reopens the
CLI export through the original compiler, and receives/loads all seven original
customer files. It closes an MCP listener only when it created that listener.
Finalization separately retains receiving errors, owned-listener close errors and
the current application call count, then checkpoints the original IDs and hashes
under upgrade-agent-receiving.json. Completion is saved after successful owned
cleanup; the original failure propagates after the checkpoint attempt.
Invoke it within the owner's original upgrade journey once its adopted review
and preparation are available.
