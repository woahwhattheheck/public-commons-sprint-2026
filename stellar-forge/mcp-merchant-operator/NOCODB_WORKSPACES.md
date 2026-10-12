# NocoDB source authoring through the merchant MCP

Operate the original NocoDB source workspace, publisher and managed seller
through the maintained merchant MCP. Browser and agent share the same saved
draft, metadata/capture records, reviewed source versions, publication runs
and request receipts.

The host selects existing private workspaces, NocoDB connection references
and original input files. MCP arguments select those aliases and original
record IDs. The source model owns its browser, publisher, scheduler and
deployment console. The publisher tools call the existing merchant publisher
dispatcher against those same native handles.

## Runtime and original source

Use Linux, Node 24 and the original source dependencies. The source workspace
uses Node SQLite and its existing POSIX workspace lease. This adapter has no
additional npm package, frontend build or provider credential store.

For an installed source distribution, use the original runtime installer and
its MCP feature. A full receiving operation that also purchases on Stellar
testnet uses --native --feature mcp --operator; keep its exact reviewed native
dependency pins. [TESTNET_RECEIVING.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/TESTNET_RECEIVING.md)
contains that complete receiving setup. Source authoring itself does not
purchase data.

The original product guides remain the contract for provider behavior:

- [NocoDB source](../../stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/README.md):
  actual v3 table/view/filter, pagination, count/schema observations and types.
- [Source workspace](../../stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/WORKSPACE.md):
  browser, original capture/import, draft review and saved source versions.
- [Publisher](PUBLISHERS.md): retained plans, extraction, review, publication,
  schedule and original buyer handoffs.
- [NocoDB deployment](../../stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/DEPLOYMENT.md):
  original five-file dataset package and SF82 selection, restart and rollback.
- [Applications](../../stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/APPLICATIONS.md):
  managed launcher ownership of the original source workspace.

All paths and IDs in examples below are placeholders. Use the actual saved
workspace, observed provider IDs and returned revisions/hashes.

## Host configuration

Create an original source workspace once, or use an existing workspace:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/workspace/cli.mjs init \
  --directory /private/nocodb/catalog
~~~

The installed command is nocodb-workspace with the same arguments. Its
original --target option selects the dataset directory at initialization.
Reopening keeps that immutable original target.

Stop a separately running source CLI, browser or managed Application before
MCP opens the same source workspace. Use its normal Stop/close operation;
leave the original workspace and its saved lease records intact.

Save a mode-0600 connection declaration outside the repository:

~~~json
{
  "schema": "stellar-forge.nocodb-authoring-connection.v1",
  "workspaces": {
    "catalog": {
      "label": "Merchant catalog",
      "directory": "/private/nocodb/catalog",
      "connections": "/private/nocodb/provider-connections.json",
      "inputs": {
        "captured_catalog": {
          "kind": "source",
          "file": "/private/nocodb/received/catalog-source.json",
          "label": "Original frozen catalog source"
        },
        "portable_source": {
          "kind": "packet",
          "file": "/private/nocodb/received/catalog-packet.json",
          "label": "Received complete source packet"
        }
      },
      "seller": "http://127.0.0.1:8400",
      "resource": "https://merchant.example/catalog"
    }
  }
}
~~~

connections, inputs, seller and resource are optional. Declare seller and
resource together when the original running seller is available for buyer
preparation. They identify the actual seller endpoint and public resource;
they do not start a seller or create a signer.

Each workspace must be an existing canonical private directory with its
original mode-0600 single-link sources.sqlite. The reader rejects symlink
databases, duplicate directory aliases and nonprivate storage. It records
the original native workspace identity, covering directory/database inodes
and immutable settings. Explicit open rechecks that identity through the
original model. Normal source revisions do not change the identity. Restoring
a workspace into a new directory requires reviewing and reloading its host
configuration.

Workspace and input aliases use 1–64 lowercase letters, digits, underscores
or hyphens. At most 32 workspaces and 64 input aliases per workspace are
declared. Relative paths resolve beside the host connection file.

### Existing NocoDB connection

provider-connections.json uses the original named connection map:

~~~json
{
  "merchant": {
    "label": "Existing merchant NocoDB account",
    "server": "https://nocodb.example",
    "tokenEnv": "NOCODB_READ_TOKEN",
    "pageSize": 100,
    "maxRows": 1000000,
    "requestIntervalMs": 250
  }
}
~~~

The existing token stays in the process environment. The file contains its
environment variable name, never a token value. Connection aliases use the
original 1–48-character identifier rules. Optional original request timeout,
page/count/byte limits and allowHttp retain their native validation.

Use HTTPS for remote service access. The original reader supports an existing
localhost HTTP service; a different private HTTP server requires the host's
explicit allowHttp setting. MCP arguments cannot change the server URL,
token environment reference, executable or a local source path.

Configuration validation performs no NocoDB request. Only explicit discovery
or capture tools read the provider.

### Attach to the original merchant operator

For an existing merchant-mcp.json, add this host field while preserving its
other configuration:

~~~json
{
  "nocodbWorkspaceConnection": "/private/nocodb/workspaces.json"
}
~~~

Reload the original MCP process to adopt the new connection snapshot.

For a new operator configuration:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-nocodb-workspaces \
  --dir /private/nocodb/merchant-operator \
  --connection /private/nocodb/workspaces.json \
  --name "NocoDB merchant authoring"
~~~

Then start the original authenticated transport using its existing private
MCP_ACCESS_TOKEN value:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /private/nocodb/merchant-operator/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
~~~

[README.md](README.md), [STDIO.md](STDIO.md) and the original OAuth resource
guide cover supported client connections. This integration uses that same
transport and authentication. Its NocoDB request budget is 1 MiB, sufficient
for the original maximum 32 query definitions with 64 columns each. Private
source packets travel through named input files or chunked output rather
than a giant tools/call argument.

## Open the original source and browser

Call merchant_nocodb_workspaces, then merchant_nocodb_open:

~~~json
{
  "workspace": "catalog"
}
~~~

The result contains workspace, instanceId, browserUrl, native and packetReads.
The complete browserUrl contains a private fragment capability; open it only
on the operator host or through its authorized local access. Preserve it
privately.

The browser and MCP share one model handle. A browser save changes the draft
revision seen by MCP. An MCP save appears in the original browser after
refresh. Both must use the original current revision when saving an edit.

Opening an already owned alias returns that same instance. Reopening after
MCP restart creates a new process instance and browser capability while
retaining original source state. Opening does not capture provider rows or
open the publisher.

merchant_nocodb_status pages original discoveries, captures and versions
using discoveriesOffset, capturesOffset, versionsOffset and limit. The
original pages object supplies the total counts. The latest preview is
returned only when it still matches the saved draft revision. Original
operation summaries retain their request IDs and current status.

## Acquire or receive the real source

### Import a complete frozen declaration

List merchant_nocodb_inputs with workspace. Inspect one declared source:

~~~json
{
  "workspace": "catalog",
  "input": "captured_catalog"
}
~~~

The result reports its kind, basename, complete byte count and SHA256.
A kind source input is an original frozen NocoDB declaration whose capture
connection pins a complete original capture. A live REST declaration must
first be captured and frozen through the original provider intake.

Send the inspected hash and current draft revision to merchant_nocodb_import:

~~~json
{
  "workspace": "catalog",
  "input": "captured_catalog",
  "expectedSha256": "SHA256_FROM_INPUT_INSPECTION",
  "title": "Reviewed original catalog",
  "expectedDraftRevision": 0,
  "requestId": "A_FRESH_UUID"
}
~~~

Use the actual revision instead of the example zero. The original packet
builder hashes the same declaration it interprets and verifies its pinned
capture, including every original metadata/count/page member. The adapter
compares that original sourceSha256 with expectedSha256 before passing the
complete packet into the native importer. It does not verify one file read
and then import a different read.

The original result returns capture.id, manifestSha256, rowCount,
draftSaved and draftRevision. A concurrent edit can make draftSaved false:
the observation remains retained, and the newer current draft remains.
Inspect the capture and current draft before deliberately saving the wanted
projection.

### Receive an original private packet

For a kind packet input, inspect the whole file hash and call
merchant_nocodb_import_packet with the same fields shown above. The adapter
reads the same private bytes once, checks the complete SHA256 and calls the
original packet validator/importer. A packet is capture-backed and does not
import a live account or token reference.

Source and packet inputs must be private regular single-link files. The
source declaration limit is 1 MiB. Packet validation uses the original
MAX_PACKET_BYTES limit, 553,648,128 bytes, including encoded original
resources. Every resource is separately checked against its original
manifest.

If the input file changes after an import's reply is lost, read
merchant_nocodb_operation or resume the same retained request. The original
import has saved its own complete input. A new external file import requires
its own freshly inspected hash and intentional request UUID.

### Discover the existing service

merchant_nocodb_discover takes workspace, a host connectionAlias, actual
baseId/tableId, optional viewId and where, and a fresh requestId:

~~~json
{
  "workspace": "catalog",
  "connectionAlias": "merchant",
  "baseId": "ACTUAL_BASE_ID",
  "tableId": "ACTUAL_TABLE_ID",
  "viewId": null,
  "where": null,
  "requestId": "A_FRESH_UUID"
}
~~~

It calls the original v3 metadata reader and retains actual field IDs,
provider types, scalar support, generated identity semantics and exact
table/view/filter binding. Read that same result later with
merchant_nocodb_discovery and its requestId.

The provider selection must come from those actual observations. Display
titles, linked-record previews and guessed field IDs are not substitutes.

### Capture complete original pages

merchant_nocodb_capture takes the retained discoveryId, the same
connectionAlias, title, expectedDraftRevision, requestId, a stable
sourceOrder and explicit queries:

~~~json
{
  "workspace": "catalog",
  "discoveryId": "ORIGINAL_DISCOVERY_UUID",
  "connectionAlias": "merchant",
  "title": "Complete catalog observation",
  "expectedDraftRevision": 0,
  "requestId": "A_FRESH_UUID",
  "sourceOrder": [
    {"field": "ACTUAL_NATIVE_ID_FIELD", "direction": "asc"}
  ],
  "queries": {
    "catalog": {
      "columns": {
        "record_id": {
          "source": "$recordId",
          "type": "string",
          "encoding": "identity-text",
          "nullable": false,
          "empty": "preserve"
        },
        "title": {
          "source": "ACTUAL_TITLE_FIELD_ID",
          "providerType": "SingleLineText",
          "type": "string",
          "encoding": "native",
          "nullable": false,
          "empty": "preserve"
        }
      }
    }
  }
}
~~~

Use the exact actual provider type; for example, an observed LongText field
must remain LongText. sourceOrder uses actual provider field IDs and includes
every generated native identity field. $recordId is a projection source,
not a provider sort field.

The original reader acquires every page, follows native pagination, verifies
unique ordered identities, and retains opening/closing metadata and count
observations. A successful capture is a complete observed paged read. It
does not claim a database transaction spanning those requests.

The source owner may perform required actual metadata/count reads or a new
complete capture on the same authorized service. Preserve earlier capture
history. The reader never joins partial pages from different observations.

merchant_nocodb_capture_attempt reports original saved attempt members and
their hashes/completeness after interruption. Resume can adopt a fully
retained original manifest; it does not repeat an uncertain provider call.
If no complete manifest was retained, inspect that original outcome and
request the needed new observation explicitly.

## Author and review the public projection

Call merchant_nocodb_columns with a retained captureId. It returns original
field IDs/types, native primary-key names, null/missing/scalar counts and
short original samples. Numeric samples preserve original JSON number
tokens; string values remain strings.

A draft is exactly:

~~~json
{
  "captureId": "ORIGINAL_CAPTURE_UUID",
  "title": "Merchant catalog",
  "queries": {
    "catalog": {
      "columns": {
        "record_id": {
          "source": "$recordId",
          "type": "string",
          "encoding": "identity-text",
          "nullable": false,
          "empty": "preserve"
        },
        "title": {
          "source": "ACTUAL_TITLE_FIELD_ID",
          "providerType": "SingleLineText",
          "type": "string",
          "encoding": "native",
          "nullable": false,
          "empty": "preserve"
        }
      }
    }
  }
}
~~~

Read current draftRevision, then call merchant_nocodb_draft_save with draft,
expectedRevision and requestId. Use the whole captured field/type union and
its original server/table/view/filter/source order. Edit public aliases,
explicit scalar encoding and null policy within that observation. The
original publisher plan can later select a published subset.

The native scalar types are string, integer, number and boolean. native
preserves and validates the original scalar. number-text retains an original
JSON number token as text; it does not reinterpret arbitrary text as a
number. identity-text serializes the native record identity into a string.
nullable and empty preserve their original meanings; empty:null requires a
nullable column. Structured or linked values must satisfy the original
complete scalar contract rather than being guessed from a partial preview.

Call merchant_nocodb_preview with the saved draftRevision and a new requestId.
The original extractor checks all retained rows and each query, returning
the original preview ID, full row counts and at most 25 sample public rows
per query. It makes no provider request.

Then call merchant_nocodb_version_save:

~~~json
{
  "workspace": "catalog",
  "draftRevision": 1,
  "previewId": "ORIGINAL_PREVIEW_UUID",
  "reviewer": "Responsible operator",
  "note": "Reviewed exact source fields, types, complete rows and public projection.",
  "expectedSelectedVersion": null,
  "requestId": "A_FRESH_UUID"
}
~~~

Use the actual current draft and selected version. The original version
operation binds the preview, reviewer, note and expected selection, retains
the immutable version, and installs the original managed source declaration.
It does not publish a dataset.

merchant_nocodb_version reads a saved version. merchant_nocodb_compare
compares two retained versions and their original previews.
merchant_nocodb_select changes the current selection with its original CAS
and request UUID. Existing publisher plans, published dataset snapshots and
buyer configurations retain their original source.

## Publish through the same browser and agent owner

Open merchant_nocodb_publisher_open with expectedSelectedVersion and a fresh
requestId. Use currentPublisher.running/currentPublisher.url from its reply.
A recordedBrowserUrl in an older receipt is historical; replaying an old
successful open does not make its former URL live.

The browser and all merchant_nocodb_publisher_* tools now operate the same
original publisher and one scheduler. These MCP tool schemas and their
behavior are taken directly from publisherTools and MerchantPublisher.
The authoring model's host-only withOpenPublisher callback holds its existing
serialized lifetime while the dispatcher runs.

A complete publication sequence is:

1. Read merchant_nocodb_publisher_source and target. Retain the exact source
   hash, available named query, current dataset snapshot and revision.
2. Call merchant_nocodb_publisher_plan_save with a native plan: title, query,
   sourceHash, input, typed public dataset columns and original extraction
   order/limits. Save the returned plan ID and data.digest.
3. Call merchant_nocodb_publisher_extract with planId, planDigest and an
   explicit runId UUID retained before dispatch. Inspect that same run with
   merchant_nocodb_publisher_inspect until the original candidate is ready.
4. Review the exact candidateDigest, reviewer and note through
   merchant_nocodb_publisher_review. First publication may choose the original
   absent target with initialize:true. A refresh binds actual
   expectedSnapshot and expectedRevision.
5. Publish with merchant_nocodb_publisher_publish using the original runId
   and current reviewId. Inspect or recover that same run after an uncertain
   reply.
6. Read the actual target and published run. Retain its original snapshot,
   revision and complete public dataset identities for deployment/buyers.

The adapter returns workspace, authoringInstanceId and native for those
borrowed publisher operations. native contains the existing dispatcher
result; source/plan/run/review IDs are unchanged. Public row and column names
are preserved even when they happen to match a host metadata field name.

Plan save and review use the native semantics described by their tool
schemas. They are not made idempotent by inventing an adapter receipt.
After a lost plan/review response, inspect original plans/runs before another
deliberate save. Extraction with the same runId and plan digest reuses the
original run; a different plan under that UUID is a conflict.

The source versions produced by this authoring workspace are capture-backed.
A schedule using such a saved plan reads that same retained observation.
To publish new provider observations, explicitly capture/review a new source
version, save a new original plan and review the desired publication policy.

### Original schedules

The derived schedule, schedule_save, schedule_enable, schedule_pause,
schedule_run and schedule_continue tools retain the
merchant_nocodb_publisher_ prefix. They operate the same scheduler displayed
by the publisher browser, including its saved policy, control revision,
pending native occurrence, row limits, cadence and expected target.

Opening the publisher resumes a previously enabled original policy.
schedule_save retains a policy paused. A native occurrence uses its original
request UUID; continue recovers the existing pending occurrence against the
actual target. Closing the source-owned publisher drains its original
scheduler and active work.

### Original buyer handoff

buyer_offer, buyer_prepare and buyer_read also retain the
merchant_nocodb_publisher_ prefix. Inspect the offer for the exact candidate
snapshot and query, review offerSha256 and acceptIndex, then prepare the
original unique intentId. Reopen the resulting saved handoff by its native
runId/handoffId and original event-backed configuration hash.

The host's seller/resource pair must identify the original running seller.
Preparing or reading a buyer configuration does not sign or pay. Actual
Stellar transfer and delivered-data checks remain in the original buyer,
approval, governor and facilitator workflow described by the testnet guide.

### Transfer ownership when needed

merchant_nocodb_publisher_close accepts the original request UUID and closes
only the publisher owned by this source model. The source editor can stay
open. General merchant_publisher_* tools may take the same retained
publisher directory later through a separately declared kind:nocodb
connection after the source-owned publisher closes. Close that owner's exact
instance before reopening from the authoring model.

For simultaneous browser/agent authoring, use the derived
merchant_nocodb_publisher_* family; it requires no ownership transfer.

## Deploy the originally published dataset

The deployment tool family uses the original NocoDB model and SF82 release
store inside this source workspace:

| Tool suffix after merchant_nocodb_deployment_ | Native operation |
|---|---|
| status | Original published runs, matching saved source versions, request history, selected release and live console |
| review | Exact source version/run and explicit merchant terms |
| prepare | Original five-file package bound to the retained review hash |
| package | Complete original package/source/merchant identities |
| stage | Immutable SF82 release ID and normalized runtime |
| compare | Original release diff and current selection generation |
| console_open, console_close | The same loopback console and its owned merchant |
| command | Explicit activate, rollback, run, stop or restart |
| file_read, file_release | Original package file through the shared verified reader |

Start with status. review requires versionId, runId, terms and requestId.
terms contains origin, path and the original payment scheme/network/asset,
payTo, integer-string amount and maxTimeoutSeconds. It must refer to the
exact originally PUBLISHED run for that saved source.

prepare requires reviewRequestId, expectedReviewSha256 and a new requestId.
package reads the resulting packageRequestId. stage requires that package ID,
its expectedSourceSha256, an immutable release id and a requestId; optional
label and runtime retain the original compiler's validation.

Open the original deployment console, then compare/select/run through that
same console. command requires consoleInstanceId and expectedGeneration.
Use the inspected target expectedDigest for every command except stop;
stop/restart additionally require the exact current merchant instanceId.
Activation uses id, rollback uses to or the original previous selection.
The browser and MCP share that console's actual ownership.

An uncertain deployment command is reconciled through operation/resume.
Recovery observes the current original native state and records
commandReplayed:false. It does not infer an old success or automatically
repeat the command. Choose a new explicit command only after inspecting the
current release, generation and owned instance.

NocoDB deployment tools use the original deployments/releases directory in
the authoring workspace. General merchant release tools use the release
store selected in the top-level merchant configuration. Use the NocoDB
deployment family for this source's saved releases and lifecycle.

The five original package files are dataset.csv, dataset.json, seller.json,
source.json and binding.json. file_read binds packageRequestId, exact file
name, expected SHA256 and byte offset. A package retains the existing dataset
version store; it does not roll dataset history backward when an older
merchant release is selected. Explicit binding.json delivery contains its
original host-local dataset binding and belongs in private receiving.

## Receive complete private source packets

merchant_nocodb_packet_read selects an immutable versionId.
merchant_nocodb_capture_read selects an original captureId before a reviewed
version exists. Both call the original packet exporter and the same shared
RetainedFileReads implementation.

A returned chunk contains:

~~~json
{
  "workspace": "catalog",
  "versionId": 2,
  "readId": "CURRENT_PROCESS_READ_UUID",
  "file": {
    "name": "nocodb-source-v2.json",
    "contentType": "application/json",
    "bytes": 123456,
    "sha256": "ORIGINAL_COMPLETE_PACKET_SHA256"
  },
  "offset": 0,
  "bytesRead": 65536,
  "nextOffset": 65536,
  "encoding": "base64",
  "data": "EXACT_BASE64_CHUNK"
}
~~~

The numbers are illustrative. Retain the actual version/capture ID, whole
file hash/size and completed offset before continuing.

Decode each chunk, verify its length and write it at the returned offset
into the same private receiving file. Request the next chunk with the same
selection, readId, expectedSha256 and offset. Maximum chunk size is 196608
bytes; default is 65536. nextOffset:null is the final chunk and releases the
read snapshot. Verify the complete file size and SHA256 before import.

A lost chunk response can repeat the same read ID/hash/offset. If the read
expired, finished, or the MCP restarted, omit readId and reopen the same
version/capture with its original expectedSha256 and completed offset.
The reader verifies the complete original file before serving that
continuation. A changed hash is a conflict; preserve the prior partial file
and do not append another source packet.

merchant_nocodb_packet_release releases an early read. Source packets and
deployment files share this alias's reader budget. The original reader
allows four active reads, expires idle snapshots after 120 seconds, and
uses private descriptor-backed snapshots beyond 32 KiB. Its copied-snapshot
limit is 256,000,000 bytes. Larger valid original packets use the original
browser/CLI file download; no packet is silently truncated to the MCP limit.

The original packet includes complete retained metadata/count/page bytes and
its source/version bindings. It may contain provider fields that a later
published plan omits. Preserve it in private custody. Its receiving
declaration is capture-backed and has no live connection credential.

For native standalone receiving, initialize a new original workspace once
and use the completed private packet:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/workspace/cli.mjs init \
  --directory /private/nocodb/received-catalog

node stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/workspace/cli.mjs import \
  --directory /private/nocodb/received-catalog \
  --packet /private/nocodb/received/catalog-packet.json \
  --title "Received original catalog" \
  --expected-revision 0 --request ORIGINAL_IMPORT_UUID
~~~

Use the actual saved revision on an existing receiver. The MCP receiving
path declares that same file as kind:packet, inspects its hash and calls
merchant_nocodb_import_packet. Both paths use the original packet validation,
capture retention and draft adoption. Preview and review the imported draft
before publishing from the receiving workspace.

## Recovery, close and reopening

Source mutation UUIDs belong to the original source operation table. The
adapter does not replace them with a separate request journal.

| Actual observation | Original continuation |
|---|---|
| A response is lost | Read merchant_nocodb_operation for that request UUID and inspect current state. |
| The original request is complete | Use its retained result; current service state remains a separate live observation. |
| The request is pending in the owning process | Follow that same request. A concurrent resume reports native busy. |
| The request is interrupted | Use merchant_nocodb_resume with the same UUID and retained input. |
| Metadata/page response was not retained | Preserve the original attempt; explicitly request the needed new observation after inspecting it. Resume does not repeat that read. |
| Import input moved or changed | Recover the original saved request; a new file import uses a newly inspected hash. |
| Another browser changed the draft | Read the new draft/revision and resolve the intended edit before a new save. |
| Selection changed during review | Inspect the saved version and current selection, then use their actual CAS values. |
| Publisher extraction response was lost | Inspect the original runId. The same UUID and plan digest reopen that run. |
| Publication response was lost | Inspect/recover the original run and actual target before another explicit publication. |
| An old open receipt contains a URL | Use currentPublisher/currentDeployment to establish live ownership. |
| A deployment response was lost | Resume observes original state; it does not repeat the uncertain command. |
| A packet read ended or expired | Omit readId and resume the same selection/hash/offset. |

NOCODB_DISCOVERY_NOT_RETAINED and NOCODB_CAPTURE_NOT_COMPLETE are specific
original source outcomes. Retained complete observations can be adopted by
native recovery; incomplete attempts remain available for inspection.
Original terminal errors, busy states, stale revisions/selections, changed
hashes and wrong request reuse remain distinguishable.

merchant_nocodb_close requires this MCP process's current instanceId. It
stops admitting new operations, drains accepted calls and verified reads, and
closes the original browser/model. That model drains its original publisher,
scheduler, deployment console and owned merchant before releasing its native
workspace lease. It does not close a successor instance.

Closing the whole merchant operator also drains borrowed publisher dispatches.
The generic publisher adapter never closes an authoring-owned borrowed
publisher itself. Its original source model remains the lifetime owner.

Restart the original MCP using the same configuration, list aliases and
explicitly reopen the source. Read its current draft, selection and prior
request receipts before continuing. Browser URLs and process instance IDs
change; source version, capture, publication and request IDs remain.

## Tool map and integration seams

| Tool family | Original implementation |
|---|---|
| merchant_nocodb_workspaces, open, close, status | Native source identity, model/browser ownership and paginated state |
| inputs, import, import_packet | Host-selected exact file identity and original packet importer |
| discover, discovery, capture, capture_attempt, columns | Original v3 metadata/page reader and saved observation inspection |
| draft_save, preview, version_save | Native CAS, complete typed preview and responsible source review |
| version, compare, select | Original saved versions and source selection |
| operation, resume | Original operation UUID and retained recovery |
| publisher_open, publisher_close | Source-owned original publisher/browser/scheduler |
| publisher_* | Existing MerchantPublisher schemas/dispatcher over those borrowed native handles |
| deployment_* | Original NocoDB package compiler and SF82 lifecycle |
| packet_read, capture_read, packet_release | Original private packets and verified resumable chunks |

Shortened names retain merchant_nocodb_. tools/list supplies each exact
schema and required fields. The implementation is nocodb-workspace.mjs with
metadata in catalog/nocodb-workspace.mjs and additive host-config/CLI/catalog,
provider-registry and scoped-instruction registration. The original lazy
registry loads this provider only for the configured NocoDB family, with the
same publishers provider as its declared dependency. Other provider families
keep their current source and loading behavior. The native model exposes one
host-only withOpenPublisher callback under its existing serialization.
MerchantPublisher.callBorrowed reuses the existing dispatcher and tracks
accepted calls until its own shutdown, without taking ownership of those
native handles.

The complete earlier provider-to-customer/testnet/Applications operation keeps
its original selected source and saved output. Adoption of this later MCP
source occurs only after its existing owners have drained; it reopens the
same received source/publisher/release state. Report actual receiving and
payment outcomes separately from source publication.
