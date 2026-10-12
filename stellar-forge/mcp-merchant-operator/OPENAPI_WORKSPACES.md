# OpenAPI merchant authoring through MCP

The merchant MCP provider now operates the original SF61 OpenAPI console from
source authoring through a saved merchant, reviewed source changes, live cache
operation, retained cache-policy revisions, complete package receiving and SF82
release staging. The browser, HAR operator and MCP client share the same console
and saved packages. A console restart updates its private connection file; the
next agent request opens that original connection again.

## Connect existing consoles

Run the original SF61 workspace or its maintained Applications command
`openapi-workspace`. Give the MCP host a private connection file with the schema
below. A `consoleUrlFile` may contain the complete printed URL, or the existing
Applications `application-url.json` record with schema
`stellar-forge.application-url.v1` and command `openapi-workspace`. The host rereads
that file for each request, including after a managed restart. An original URL
environment variable is also supported through `consoleUrlEnv`.

~~~json
{
  "schema": "stellar-forge.sf61-workspace-connection.v1",
  "workspaces": {
    "sender": {
      "label": "API authoring",
      "consoleUrlFile": "./sender-url.txt",
      "files": {
        "api_v1": {"kind": "source", "path": "./api-v1.yaml"},
        "api_v2": {"kind": "source", "path": "./api-v2.yaml"},
        "merchant_plan": {"kind": "plan", "path": "./merchant-plan.json"}
      }
    },
    "receiver": {
      "label": "Receiving merchant",
      "consoleUrlFile": "./receiver-url.txt",
      "deliveries": {
        "weather_delivery": {"directory": "./downloads/weather"}
      }
    }
  }
}
~~~

Set the configuration and URL files to mode 0600. File and delivery paths are
relative to the connection file. Optional `sha256` fields pin a declared source
or plan file; optional `manifestSha256` pins a declared receiving directory.
Workspaces expose their labels and named handles to the MCP client. API arguments
select those handles; the connection file supplies the host paths.

The shared transport uses the exact original loopback origin and
`x-workspace-token` header. It accepts the native port 80 origin as well as other
configured ports. The existing Applications descriptor is validated before its
URL is read. Source and plan files are read completely through their declared
handles, with size and change checks.

Initialize an operator with its own original SF82 store:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-openapi-workspaces \
  --dir /private/merchant-operator \
  --connection /private/sf61-connection.json
~~~

To attach an existing SF82 store, add `--release-store /private/merchant-releases`.
The normal `init` command also accepts `--openapi-workspaces CONNECTION_JSON`
alongside its initial source. The generated merchant configuration references the
private connection using `openapiWorkspaceConnection`. Start it through the
existing `serve` or stdio entrypoint and its configured MCP access token or OAuth
resource host.

The SDK initializer is
`initializeOpenApiWorkspaceMerchant({directory, connection, name, releaseStore})`
from `config.mjs`. Existing `startMerchantMcp` and `openMerchantOperator` remain
the entrypoints. Embedded HTTP hosts may supply their environment through
`startMerchantMcp({environment})`; the same environment resolves the declared
console URL aliases.

## Author and save a merchant

Begin with `merchant_openapi_workspaces` and `merchant_openapi_packages`.
Package inventory scans complete packages before pagination; follow
`nextCursor` until `complete`. `merchant_openapi_package_inspect` verifies an
existing package's original manifest, source, compiled files and revision
identity.

The following calls use the maintained MCP client. The host has already set
`MCP_ACCESS_TOKEN` and its endpoint URL.

~~~js
import { openMerchantFileClient } from './retained-download.mjs';

const client = await openMerchantFileClient({
  url: process.env.MERCHANT_MCP_URL,
  tokenEnv: 'MCP_ACCESS_TOKEN'
});
const call = (name, args) => client.call(name, args);

const inspected = await call('merchant_openapi_inspect', {
  workspace: 'sender', specFile: 'api_v1'
});
const selection = {
  workspace: 'sender',
  specFile: 'api_v1',
  expectedSourceSha256: inspected.native.sourceSha256,
  planFile: 'merchant_plan'
};
const preview = await call('merchant_openapi_preview', selection);
const saved = await call('merchant_openapi_save', {
  ...selection, name: 'weather-v1'
});
~~~

The original compiler reviews selected operations, exact atomic prices, upstream
bindings and current provider authorization. A file handle carries a complete
JSON or YAML source up to the original 4 MiB limit. Small complete source text may
instead be supplied as `specText`, up to 128 KiB. Choose exactly one source form
and one plan form. The original JSON request limit remains 10 MiB.

`merchant_openapi_save` uses the original atomic publisher. If a response is
lost, repeat the same name, exact source and plan. The client inspects the
original completed package and returns `recovered:true` when its saved input
matches. A name that belongs to different source, settings or revision returns
a conflict. `merchant_openapi_load` returns the complete editable plan, preview,
revision and source identity; `includeSource:true` includes complete source up
to 128 KiB. The package export carries the complete original source at every
supported source size.

## Continue original source revisions

Load the base package and review explicit keep, remap or drop decisions through
`merchant_openapi_revision_review`. The original matcher supplies candidate
operations, changed declarations, pending decisions and exact review hashes.
Existing atomic prices stay with their retained routes. Complete any returned
mapping or provider-authorization action in the original console, then review
the resulting candidate.

For a source edit that preserves the selected method/path coordinates:

~~~js
const {native: base} = await call('merchant_openapi_load', {
  workspace: 'sender', name: 'weather-v1'
});
const candidate = {
  workspace: 'sender', baseName: 'weather-v1', specFile: 'api_v2',
  decisions: base.preview.routes.map(route => ({
    routeId: route.id, action: 'keep'
  }))
};
const {native: review} = await call(
  'merchant_openapi_revision_review', candidate
);
await call('merchant_openapi_revision_draft', {
  ...candidate, name: 'weather-review'
});
const revision = await call('merchant_openapi_revision_save', {
  ...candidate, name: 'weather-v2',
  expectedReviewSha256: review.reviewSha256,
  expectedRefreshReviewId: review.refreshReviewId
});
~~~

The draft is the original console's saved draft. It can be reopened in the
browser or through `merchant_openapi_drafts` and
`merchant_openapi_draft_load`. Source revisions retain their original base
identity, decisions and source lineage.

A completed revision retry reopens the existing package and recomputes the
original review against the supplied decisions. Both review hashes must agree
with the saved revision. Changing the decisions while reusing an old review
hash is rejected. A change in current provider-grant readiness does not change
the identity of an already completed save; its original base remains available
for the review comparison.

## Operate cache policy and retain it for restart

`merchant_openapi_start` starts the selected package in the original console's
challenge mode. `merchant_openapi_status` returns its current runtime ID, cache
state and provider-connection state. The browser sees the same running
merchant. `merchant_openapi_stop` requires that exact runtime ID, so a stale
request cannot stop a newly selected runtime.

|Task|Merchant MCP tool|Original state used|
|---|---|---|
|Read operating history or compare snapshots|`merchant_openapi_cache_history`|Saved SQLite workspace, inspection or change|
|Capture current policy and activity|`merchant_openapi_cache_capture`|Current workspace revision and original running merchant|
|Review a retention change or invalidation|`merchant_openapi_cache_prepare`|Selected inspection, route and caller-retained operation ID|
|Apply or recover the same change|`merchant_openapi_cache_apply` / `merchant_openapi_cache_recover`|Original runtime generation and retained operation|
|Prepare a saved-package policy|`merchant_openapi_policy_review`|Selected original inspection and explicit cached route IDs|
|Reopen a policy review|`merchant_openapi_policy_reviews` / `merchant_openapi_policy_show`|Original retained review files|
|Save or recover the revised merchant|`merchant_openapi_policy_save`|Original review hash, compiler and atomic publisher|

The cache workspace revision and the live runtime's cache revision are separate
original values. Use the revision returned by the selected operating workspace
for capture/prepare/apply calls. The original preparation records the runtime
instance and generation internally.

A saved policy changes only `ttlMs`, `maxEntries`, `maxBytes` and
`maxEntryBytes` for the chosen cached routes. The original
[cache-policy guide](../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/CACHE_POLICY_REVISIONS.md)
covers the full review, retained history, restart and CLI workflow.

## Deliver every original package file

Call `merchant_openapi_export` with the saved package name and, optionally,
its inspected `expectedPackageManifestSha256`. The original console retains an
immutable complete export. `merchant_openapi_exports` recovers exports after an
interrupted initial reply; `merchant_openapi_manifest` returns the exact file
list and completion-manifest identity.

The export contains original source and plan, generated facade and bindings,
the original package UUID/manifest, compiled merchant files and selected
source-revision lineage. The original package and compiled-file readers define
that closure. See the
[complete package transfer guide](../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/PACKAGE_TRANSFER.md)
for the exact selected-file set and native receiving command.

Download the selected export through the same maintained receiver used by other
merchant files:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs download-openapi \
  --url https://merchant.example/mcp \
  --workspace sender \
  --export-id ORIGINAL_EXPORT_SHA256 \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --out /private/downloads/weather
~~~

The downloader uses the original `createRetainedDownload` with nested files
enabled. It verifies every file hash, checkpoints durable byte offsets, resumes
interrupted files and writes the original completion manifest last. The same
command continues after MCP or console restart. Complete export data remain
available after the sender package is relocated.

The SDK exports `downloadOpenApiPackage`,
`inspectOpenApiPackageDownload` and `reopenOpenApiPackageDownload` from
`openapi-workspace-client.mjs`. `downloadOpenApiPackage` accepts
`{url, workspace, exportId, directory, tokenEnv, environment, signal, chunkSize,
onProgress, expectedManifestSha256}`. The CLI also provides `inspect-openapi` and
`reopen-openapi`.

## Receive, stage and operate the saved merchant

Copy or download the complete directory to the receiving host's declared
`deliveries` handle. Then invoke:

~~~js
const received = await call('merchant_openapi_receive', {
  workspace: 'receiver', delivery: 'weather_delivery',
  name: 'weather-received',
  expectedManifestSha256: originalManifestSha256
});
const staged = await call('merchant_openapi_stage', {
  workspace: 'receiver', name: 'weather-received',
  id: 'weather-received',
  expectedPackageManifestSha256: received.native.package.manifestSha256
});
~~~

The receiver validates the complete original source and compiled closure before
publishing through the original package lease. It preserves the package UUID,
merchant manifest, compiled files and selected revision lineage. Repeating the
same completed receiving operation reopens that package. Existing different
packages and occupied names retain their original state.

Staging accepts both initial and revised saved packages. It uses the MCP host's
configured original SF82 store and current original provider authorization.
Continue with `merchant_inspect` and `merchant_compare`, select the resulting
digest and generation with `merchant_activate`, then use `merchant_start`.
The existing catalog, customer-client export, rollback and shutdown tools
continue the same release lifecycle.

The executable native receiving journey and its source inputs are documented
in [PACKAGE_TRANSFER.md](../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/PACKAGE_TRANSFER.md).
