# WebDAV client, operator and complete receiving

The installed **merchant-webdav** command operates the existing WebDAV merchant
MCP host. Its JavaScript interfaces cover all 18 original tools, durable reviewed
operations, complete export downloads and fresh native source receiving. Browser
and client operations share the original workspace, capture, mapping, edition,
publisher, release and customer records.

Use the [original operator guide](WEBDAV.md) for host profiles, payment terms and
native publisher payloads. The [WebDAV API contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/webdav/API_CONTRACT.md)
defines the source and saved operation semantics. This companion keeps those
interfaces and uses the maintained authenticated MCP transport, file reads and
durable download writer.

## Install and connect

The maintained distribution's original WebDAV contribution owns the new command,
public types, examples and exports. From an installed matching distribution:

~~~sh
starforge registrations --source webdav
starforge registrations --command merchant-webdav
starforge merchant-webdav --help
~~~

From its original checkout, replace **starforge merchant-webdav** with:

~~~sh
node stellar-forge/mcp-merchant-operator/webdav-workspace-cli.mjs
~~~

Use the original Linux/POSIX native dependencies, Node 22.16 or newer, Python
3.11 or newer linked to Expat 2.6 or newer, and Linux flock. The companion adds
no package dependency. Native source limits, source parsing, dataset typing,
merchant compilation and payment behavior remain those of the selected product.

Copy [the connection example](webdav-workspace-connection.example.json) into an
existing private host directory. Give it the actual collection URL and private
canonical workspace paths. It uses environment reference names for source
credentials. Add the operator's actual merchant terms, existing buyer workspace
and exact retained source packets as shown in the original guide. Each map is
optional; a source-only configuration can be opened before terms are added.
Keep the connection and other private JSON inputs mode 0600 and their directories
mode 0700. The host resolves relative paths from the connection file.

~~~sh
starforge merchant-webdav check-connection \
  --connection /srv/starforge/webdav-connection.json

starforge merchant-webdav setup \
  --connection /srv/starforge/webdav-connection.json \
  --directory /srv/starforge/webdav-mcp \
  --output /srv/starforge/webdav-host-registration.json
~~~

Setup uses the original initializer, then returns its configuration and standard
stdio host registration. **--merge EXISTING_PRIVATE_HOST_JSON** preserves existing
host entries and refuses a conflicting name; **--host-name** chooses that name.
**--output** creates a new private registration file. Import that returned
registration into the selected MCP client. An existing merchant host can instead
retain its current configuration and add the original webdavWorkspaceConnection
field through the original configuration workflow.

For HTTP callers, start the original host with its existing token environment:

~~~sh
starforge merchant-mcp serve \
  --config /srv/starforge/webdav-mcp/merchant-mcp.json \
  --port 8788 --token-env MCP_ACCESS_TOKEN
~~~

The following examples use http://127.0.0.1:8788. A remote deployment uses its
existing HTTPS endpoint. Tokens stay in their named environment variables;
**--token-env** chooses the reference. The client rejects URL credentials and
query parameters. Access tokens and source credential values stay outside the saved download
manifest and operation journal; the selected public source declaration is retained.

~~~sh
starforge merchant-webdav status --url http://127.0.0.1:8788
starforge merchant-webdav open --url http://127.0.0.1:8788 --workspace reports
~~~

The unscoped status lists host-declared workspaces, source and merchant profiles,
buyer aliases and exact source-packet aliases. Open returns the actual workspace
UUID, saved revision, instanceId and original browser URL. Retain them. The browser
URL is for the same host and same workspace. An independently opened native
writer must close before another process owns that directory.

## Review and save each original decision

**prepare** performs reads, assigns an original operation UUID when omitted,
captures the exact endpoint/workspace UUID, freezes the selected public source
or merchant profile, and writes the reviewed request before dispatch. Each new
decision uses one new private operation directory.

For example, source-input.json contains:

~~~json
{ "workspace": "reports", "profile": "files" }
~~~

Prepare, inspect and submit that same decision:

~~~sh
starforge merchant-webdav prepare --url http://127.0.0.1:8788 \
  --tool merchant_webdav_source --input /srv/starforge/source-input.json \
  --directory /srv/starforge/operations/source-selection

starforge merchant-webdav inspect-operation \
  --directory /srv/starforge/operations/source-selection

starforge merchant-webdav run --url http://127.0.0.1:8788 \
  --directory /srv/starforge/operations/source-selection
~~~

The prepared operation contains its original UUID, selected native revision,
full inputs, endpoint, workspace UUID and profile fingerprint. Profile values
are the host's public declaration and environment reference names. Editing a
host profile to another collection or merchant does not silently retarget a
retained operation.

Repeat this pattern for the following native decisions. The input file contains
workspace plus the additional fields below. The client fills operationId and
expectedRevision only when they are absent; explicit values are validated.

| Tool | Additional reviewed input | Retained result |
| --- | --- | --- |
| merchant_webdav_source | profile | Exact saved source and normalized source hash |
| merchant_webdav_catalogue | href?, depth?, offset?, limit? | Original collection XML and listing |
| merchant_webdav_capture | action=start, selection | Original capture UUID, validators and bytes |
| merchant_webdav_capture | action=resume, captureId | Same capture and verified prefix |
| merchant_webdav_capture | action=sample, captureId, format, recordsPointer?, limit? | Complete source count and original sample ordinals |
| merchant_webdav_mapping | captureId, expectedCaptureSha256, projection | Reviewed public projection and projectionHash |
| merchant_webdav_edition | action=build, mappingId, dataset, review | Original CSV dataset, snapshot and row count |
| merchant_webdav_merchant | editionId, profile, reviewer, note? | Native merchant terms |
| merchant_webdav_edition | action=export, editionId, merchantId, reviewer, note? | Complete merchant export and all source members |
| merchant_webdav_publisher | action, productId?, payload? | Original publisher, release or customer result |
| merchant_webdav_packet | No additional fields | Complete portable original source packet |

The native source contract defines exact collection and capture selection.
Choose an accessible file from an original retained listing, keep its href,
quoted/weak/missing ETag, contentLength and lastModified, and assign a capture
UUID distinct from the operation UUID. Keep that capture UUID during resume.
An ETag remains a provider validator; independently supplied expectedSha256 binds
actual content when available.

Page the original listing without acquiring it again:

~~~sh
starforge merchant-webdav listings --url http://127.0.0.1:8788 \
  --workspace reports --source-id ORIGINAL_SOURCE_UUID --id ORIGINAL_LISTING_UUID
~~~

Each output line is a complete original page. The client requires the retained
listing ID, SHA256, total and page positions to stay consistent.

Sampling precedes mapping. Keep exact identifiers and monetary text as strings.
A reviewed projection can explicitly map the actual id, region and amount fields:

~~~json
{
  "format": "csv",
  "recordsPointer": "",
  "columns": {
    "id": { "pointer": "/id", "type": "string", "nullable": false, "missing": "error" },
    "region": { "pointer": "/region", "type": "string", "nullable": false, "missing": "error" },
    "amount": { "pointer": "/amount", "type": "string", "nullable": false, "missing": "error" }
  }
}
~~~

Use source fields from the real sample. Dataset filters, ranges and sorts select
public columns. The edition review includes reviewer, decision=approve,
expectedCaptureSha256 and the saved projectionHash. Conversion errors retain
the native code and actual original row ordinal. The client forwards the complete
projection and dataset contract to the existing implementation.

The read-only **call** command can query a selected edition using
merchant_webdav_preview and input {workspace,editionId,query}. Query syntax and
budgets are the original [dataset API](../../stellar/scf-starforge-20261009/sf30-seller-sdk/DATASET_API.md).
**call** also exposes every original tool directly for callers already retaining
their own native intent journal; it requires their complete original arguments.

## Publication and customer work

Prepare an original publisher with merchant_webdav_publisher,
action=publisher.prepare and payload={exportId,title?}. The returned productId
identifies that host's original publisher. Subsequent calls retain that productId
and use the native action and unchanged payload.

| Native action family | Caller selects |
| --- | --- |
| publisher.status / publisher.preview | The original publisher or draft and query |
| publisher.reviewDraft / publisher.publish | The original draft review and its exact current native IDs |
| publisher.activateSnapshot / publisher.collect | The original version-store action |
| publisher.release.stage / inspect / activate / rollback | Original draft, release ID and generation |
| publisher.release.start / stop | The original owned release |
| publisher.buyer.review / prepare | The original buyer configuration and review |
| publisher.buyer.session | buyerId, declared buyerWorkspace alias and original budgets |
| publisher.buyer.run / recover / account / export | The existing customer session, attempt and native policy |

Use the exact payloads from [the native publisher guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/PUBLISHING.md)
and current returned state. The original host injects its declared runtime during
release staging and resolves buyerWorkspace to its existing private buyer.
Amounts remain decimal strings. Preparation, review, release state, readiness,
customer execution and settlement have their own native records.

Read an existing publisher through merchant_webdav_operation with
kind=publisher and its product UUID. An interrupted publisher mutation is
reconciled through that original publisher/release/session, then its original
recovery action. The client retains the unresolved original intent and does not
automatically repeat the publisher mutation.

## Complete exports and files

Create a receiving plan from a saved native export:

~~~sh
starforge merchant-webdav plan-export --url http://127.0.0.1:8788 \
  --workspace reports --export-id ORIGINAL_EXPORT_UUID \
  --output /srv/starforge/plans/reports-export.json
~~~

The plan captures the original workspace UUID, endpoint, export manifest SHA256,
edition/merchant/snapshot and **every** original manifest member. It includes
dataset.csv, dataset.json, source.json, seller.json, native manifest.json and
the full webdav/ source closure. Paths, names, byte counts and digests come from
that actual export. Optionally supply **--expected-sha256** with its known native
manifest digest. The returned plan file digest is used for subsequent commands.

~~~sh
starforge merchant-webdav download --url http://127.0.0.1:8788 \
  --plan /srv/starforge/plans/reports-export.json \
  --directory /srv/starforge/receiving/reports-export \
  --expected-sha256 REVIEWED_PLAN_SHA256

starforge merchant-webdav inspect-download \
  --directory /srv/starforge/receiving/reports-export \
  --expected-sha256 REVIEWED_PLAN_SHA256
~~~

The download writer preserves nested paths, private permissions, each native
read identity, byte offsets, verified partial prefixes and complete SHA256s.
An interrupted command continues from the **same plan and same directory**.
Completed files are reopened and hash-checked; a partial native transport handle
that expired is replaced by a read of the same original SHA256 and offset.
The final receiving manifest is published after all selected files are complete.
An export also checks its received native manifest against the full selected
member set and original edition/merchant/snapshot binding.

**inspect-download** reopens and hashes the completed files offline in a new
process. It requires the complete receiving manifest. Keep an interrupted
directory and use download to finish it first. There is one original Linux
writer lease per receiving directory. The supported plan limits are 8,001 files,
8 GiB in total, 528 MiB for a single retained packet/file and 8 MiB for the plan;
individual native source limits still apply. Chunks are at most 196,608 bytes.
File bytes stream to disk rather than collecting the complete source in memory.

To select other complete files, put an array of original file selectors into a
private JSON file and use **plan-files**. For example, replace the symbolic IDs
below with the actual returned IDs:

~~~json
[
  { "name": "source-packet.zip", "selector": { "kind": "packet", "id": "ORIGINAL_PACKET_OPERATION_UUID" } },
  { "name": "customer/session.csv", "selector": {
    "kind": "publisher", "productId": "ORIGINAL_PRODUCT_UUID",
    "publisherKind": "session-csv", "id": "ORIGINAL_SESSION_ID"
  } }
]
~~~

The remaining selectors cover source declarations, listing XML/JSON, capture
body/receipt, edition files, original publisher draft/review/buyer/session files,
and full retained operation results. Native file selector names remain those
in the original API. A receiving name is a canonical relative path selected by
the caller. Each file may additionally specify its independently known
expectedSha256.

~~~sh
starforge merchant-webdav plan-files --url http://127.0.0.1:8788 \
  --workspace reports --input /srv/starforge/selections.json \
  --output /srv/starforge/plans/source-and-customer.json
~~~

Download and inspect that plan through the same commands. Metadata and one small
read identify each selected file; acquisition is not repeated. Large tool results
normally resolve automatically from their original result file, up to 16 MiB.
JavaScript callers can set resolveResult=false and include the returned kind=result
descriptor in a disk receiving plan when they need to retain it separately.

## Fresh native source receiving

For a received source-packet member:

~~~sh
starforge merchant-webdav restore-source \
  --directory /srv/starforge/receiving/source-and-customer \
  --file source-packet.zip \
  --destination /srv/starforge/received-webdav \
  --python python3 --expected-sha256 REVIEWED_PLAN_SHA256
~~~

This verifies the entire completed receiving and the selected packet, then calls
the original packet inspector/importer into a fresh destination. The native
import preserves the source, capture, mapping, edition and export identities
and records a new receiving workspace UUID. It uses the original permission
and source-binding rules. Retain its import receipt. Publisher processes, active
release ownership and buyer state are opened on the destination using their
original native workflows.

The original host-side path is also available: declare an exact sourcePackets
alias in a **closed** receiving workspace and call merchant_webdav_receive with
action=inspect or receive, its alias and expectedSha256. Completed same-packet
receiving is read back from its existing receipt. Then open that declared
workspace. Full manifest inspection can be paged using offset/limit.

## Recover an operation and stop cleanly

~~~sh
starforge merchant-webdav reconcile --url http://127.0.0.1:8788 \
  --directory /srv/starforge/operations/source-selection
~~~

| Saved result | Continue the same work |
| --- | --- |
| COMPLETE | Consume the retained original result. A new run reads it back. |
| PENDING | Read this original operation while its native worker finishes. |
| NOT_RECORDED / NOT_APPLIED | Review the current saved state, then explicitly run the same original request. |
| RESUME_AVAILABLE | Inspect the retained capture/source operation, then run with --resume. |
| RESPONSE_UNCERTAIN | Reconcile the original UUID before choosing its continuation. |
| COMPLETE_RESULT_UNREAD | The original mutation completed; reconcile its retained full result file. |
| FAILED | Inspect the native error. Corrected input is a new reviewed decision. |
| NATIVE_RECONCILE_REQUIRED | Open the original publisher/release/customer state and its native recovery action. |

A revision conflict does not create another operation. After reviewing the actual
current native state, use **run --reviewed-revision INTEGER** to explicitly use
that revision with the original UUID and unchanged input. Source/merchant profile,
endpoint and workspace identity stay pinned. Full operation/result records remain
available by UUID even beyond the current 100-operation window.

**history** streams all pages of the retained sources, captures, mappings,
editions, merchants, exports, products and the native recent-operation window.
A concurrent saved revision makes the client report HISTORY_CHANGED; restart
paging at that revision so the resulting history is coherent.

SIGINT and SIGTERM stop the caller while preserving its existing journal or
download checkpoint. A separate **cancel** command requests cancellation of the
original native operation:

~~~sh
starforge merchant-webdav cancel --url http://127.0.0.1:8788 \
  --workspace reports --operation-id ORIGINAL_OPERATION_UUID

starforge merchant-webdav close --url http://127.0.0.1:8788 \
  --workspace reports --instance-id ORIGINAL_INSTANCE_UUID
~~~

Read the actual cancellation result. Close drains the exact owned instance,
native source work, original publisher/release and file handles. Saved workspace
and received files remain available for their next ordinary open.

## JavaScript and TypeScript

~~~js
import { createWebDavWorkspaceClient } from
  '@tokenjunkielabs/starforge-merchant/merchant/mcp/webdav/client';
import { prepareWebDavOperation, runWebDavOperation } from
  '@tokenjunkielabs/starforge-merchant/merchant/mcp/webdav/operations';
import { prepareWebDavReceiving, downloadWebDavReceiving } from
  '@tokenjunkielabs/starforge-merchant/merchant/mcp/webdav/download';

const client = await createWebDavWorkspaceClient({
  url: 'http://127.0.0.1:8788', tokenEnv: 'MCP_ACCESS_TOKEN'
});
const opened = await client.open({ workspace: 'reports' });
const prepared = await prepareWebDavOperation({
  client, directory: '/srv/starforge/operations/source-choice',
  tool: 'merchant_webdav_source',
  args: { workspace: 'reports', profile: 'files' }
});
const completed = await runWebDavOperation({ client, directory: prepared.directory });
~~~

Types preserve the original 18-tool argument variants, IDs, query inputs, capture
selection, dataset review and complete file selectors. A trusted existing MCP
client can be passed as {client:{endpoint,call}} instead of url; call returns the
original structured tool result and throws the actual native error.

[The complete reviewed-edition example](examples/webdav-reviewed-edition.mjs)
joins a retained source mapping, a reviewed dataset contract and existing merchant
terms through new native mapping/edition/export/publisher preparation, complete
export and source-packet downloads, and offline receiving. Its saved input and
step directories retain one original operation per decision across restart.

Copy [the example review input](examples/webdav-reviewed-edition.example.json) into
private storage and replace its symbolic mapping/merchant IDs with selected native
IDs. Set its dataset columns and optional projection from the reviewed actual source.
Run its original source entrypoint with --url MCP_URL --input PRIVATE_REVIEW_JSON
--directory PRIVATE_OPERATION. Reusing that directory continues the same steps and
receiving plans. Retained inactive source decisions can first be continued with the
normal run --resume command for their returned step directory. The example returns
the publisher product ID for the original review/publication and customer actions.
