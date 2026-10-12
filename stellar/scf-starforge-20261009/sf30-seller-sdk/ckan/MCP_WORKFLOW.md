# CKAN workbench through merchant MCP

The CKAN tools expose the existing catalogue, retained editions, reviewed field
mapping, original dataset publisher, merchant package and buyer handoff through
the maintained merchant operator. A declared workspace alias opens the same
`openCkanWorkbench` model and local browser used by the CKAN command.

This guide covers the host connection, agent workflow, original operation
recovery, complete file receiving and one native source-to-publication exercise.
The [workbench guide](README.md) explains the operator interface and source
semantics. The [publisher guide](publisher/README.md) describes the portable
merchant and original SF82/SF88 interfaces.

## Host setup

Use the existing Linux runtime with Node 24 or newer, util-linux `flock`, and
`tar` for archive downloads. Run repository commands from its root. Create a
new original CKAN project only when a saved project is not already available:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/cli.mjs init \
  --project /srv/starforge/ckan-library \
  --origin https://ckan0.cf.opendata.inter.prod-toronto.ca
```

The host connection uses
`stellar-forge.ckan-workbench-connection.v1`. It declares existing project
directories and named retained-capture inputs:

```json
{
  "schema": "stellar-forge.ckan-workbench-connection.v1",
  "workspaces": {
    "library": {
      "label": "Toronto library data",
      "directory": "/srv/starforge/ckan-library",
      "inputs": {
        "toronto_reference": {
          "file": "/srv/starforge/toronto-capture/capture.json",
          "label": "Original 2026-10-11 Toronto capture"
        }
      },
      "merchant": {
        "origin": "https://ckan-library.example.org",
        "path": "/data",
        "payment": {
          "scheme": "exact",
          "network": "stellar:testnet",
          "amount": "20000",
          "asset": "DEMO_NONPAYABLE_ASSET",
          "payTo": "DEMO_NONPAYABLE_RECIPIENT",
          "maxTimeoutSeconds": 60
        },
        "runtime": {
          "port": 8423
        }
      },
      "seller": "http://127.0.0.1:8423"
    }
  }
}
```

The example's public payment terms are copied unchanged from the original
[SF61 onboarding selection](../../sf61-openapi-seller-import/service-selections.example.json).
They exercise the original challenge and buyer-preparation workflow. Set the
merchant's published payment terms and intended HTTPS resource when preparing
a customer deployment. The fixed seller address must match the actual original
SF82 listener selected by `merchant.runtime.port`.

The project's original catalogue and token-environment reference remain its
source connection. The host owns storage paths, retained input files, payment
terms, resource address, release runtime and seller address. Agent calls select
those declared aliases and saved item identities.

Initialize the maintained MCP host from the connection:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-ckan-workspaces \
  --dir /srv/starforge/ckan-agent \
  --connection /srv/starforge/ckan-connection.json \
  --workspace library

node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /srv/starforge/ckan-agent/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
```

The installed distribution exposes the same commands through
`starforge merchant-mcp`. The initializer selects the only workspace automatically, or uses `--workspace`
when the connection contains several aliases. It binds the merchant operator to
that project's original `seller-releases` store. An existing merchant configuration
can add the `ckanWorkspaceConnection` path; normal merchant initialization accepts
`--ckan-workspaces` together with the matching `--release-store` path.

Keep the connection JSON private to its operator, for example with mode `0600`.
The `inputs` file selects the original manifest together with its retained sibling
metadata and page files; it does not select the transport ZIP.

Set the existing operator access token in `MCP_ACCESS_TOKEN` before starting
the host. The original HTTP transport requires at least 24 characters. Any
catalogue API token stays in the environment variable recorded by the original
project. Use the named connection file for storage paths and fixed merchant
settings.

## Connect an agent

The maintained HTTP listener uses JSON-RPC and protocol version
`2025-11-25`. Send `initialize`, then `tools/list` and `tools/call` to the
returned listener URL, for example `http://127.0.0.1:3211`. Requests carry:

| Header | Value |
| --- | --- |
| Authorization | `Bearer <operator token>` |
| Content-Type | `application/json` |
| Accept | `application/json, text/event-stream` |
| MCP-Protocol-Version | `2025-11-25` after initialization |

The original listener returns a JSON response. It requires both advertised
Accept types. A successful HTTP response can still contain a JSON-RPC error or
`result.isError: true`; read that result before consuming
`result.structuredContent`.

A tool request has the ordinary form:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "merchant_ckan_open",
    "arguments": { "workspace": "library" }
  }
}
```

List `merchant_ckan_workspaces`, then open the selected alias explicitly.
Retain its returned `instanceId` and private browser URL inside the operator
session. The browser fragment is an access token. Browser and agent
operations use the same original project and operation state. Close a separately
running CKAN CLI/server before opening that directory through MCP.

## Tool map

| Job | Original tools |
| --- | --- |
| Declare and own a project | `merchant_ckan_workspaces`, `merchant_ckan_open`, `merchant_ckan_status`, `merchant_ckan_close` |
| Find a source | `merchant_ckan_search`, `merchant_ckan_package` |
| Receive or capture an edition | `merchant_ckan_inputs`, `merchant_ckan_import`, `merchant_ckan_capture`, `merchant_ckan_capture_resume` |
| Inspect and compare source | `merchant_ckan_edition`, `merchant_ckan_compare` |
| Save the explicit projection | `merchant_ckan_source_save` |
| Prepare and query the original candidate | `merchant_ckan_publication_create`, `merchant_ckan_publication` |
| Review, publish and recover | `merchant_ckan_publication_review`, `merchant_ckan_publish`, `merchant_ckan_publication_recover` |
| Package and stage the merchant | `merchant_ckan_merchant_export`, `merchant_ckan_merchant_stage` |
| Operate the shared original release | `merchant_inspect`, `merchant_compare`, `merchant_activate`, `merchant_start`, `merchant_catalog`, `merchant_stop` |
| Prepare the buyer | `merchant_ckan_buyer_offer`, `merchant_ckan_buyer_prepare` |
| Receive saved source, merchant and buyer files | `merchant_ckan_files`, `merchant_ckan_file_read`, `merchant_ckan_file_release` |
| Cancel the current original operation | `merchant_ckan_cancel` |

The `tools/list` input schemas are the current contract. CKAN action arguments
are flat: source and publication IDs, reviewed digests and policy fields sit next
to `workspace` and `expectedOperationId`.

## Use the original operation identity

Each CKAN authoring mutation binds the operation visible immediately before it
runs. Import, capture, source selection, candidate preparation, review, publication,
export, staging and buyer preparation use this guard. Read `merchant_ckan_status` and supply
`expectedOperationId = status.native.operation?.id ?? null`. The null value
selects a project with no previous operation.

The bridge checks this identity immediately before native dispatch. The native
model then records its own operation UUID, state, progress, result and error.
Use that returned identity while following the action. Completion is one of
`COMPLETE`, `FAILED`, `CANCELLED` or an interrupted retained state; resolving
an asynchronous completion is not itself the success condition.

After an uncertain reply, read status and the relevant retained edition, source,
publication, export or buyer item. A stale operation baseline fails with
`CKAN_OPERATION_CHANGED`; call `merchant_ckan_status` to recover the current
original operation and saved item. Preserve the completed item's identity before
starting another action. Match a later observed operation to the intended action
and its saved item before continuing. Do not resubmit the action merely because
its first reply was lost.

Open and close use workspace ownership; close requires the current `instanceId`.
Cancel requires the current active `operationId`. These lifecycle tools do not
accept `expectedOperationId`.

The workbench serializes changes under its original project lease. The
`expectedOperationId` check also catches a change made through the borrowed
browser. Review guards separately bind the exact capture SHA-256, candidate
digest and original review ID. The original publication recovery reads the
retained run and target outcome.

## Review the useful source

The retained Toronto reference is a real CKAN DataStore edition:

| Source field | Reference value |
| --- | --- |
| Catalogue | `https://ckan0.cf.opendata.inter.prod-toronto.ca` |
| Package | `f5aa9b07-da35-45e6-b31f-d6790eb9bd9b` |
| Resource | `7420a950-e62b-41da-826c-32d31c46e8f8` |
| Capture manifest SHA-256 | `cd035b97e42e71a41f2499298a528bcdbfb7288676b5a5511d8983336a84e3ca` |
| Captured rows | 112 |
| Provider pages | 50, 50 and 12 rows |
| Physical branch query | `where_physical_branch=1` returns 100 matches |

Those counts describe the retained 2026-10-11 edition. A fresh capture keeps its
own returned totals and source metadata. The [Toronto Public Library source and
licence references](publisher/README.md#source-identity-and-projection) travel
with the original publisher metadata.

Inspect a declared input with `merchant_ckan_inputs`, then import its exact
reviewed manifest through `merchant_ckan_import`. For a new live edition, use
`merchant_ckan_search` and `merchant_ckan_package` to select an advertised
DataStore resource, then `merchant_ckan_capture`. Follow the returned edition
and operation. `merchant_ckan_capture_resume` continues its retained original
pages; a completed edition is the input to a new refresh.

Read `merchant_ckan_edition` before choosing public fields. It returns source
types, actual samples, null/empty counts and suggested aliases. The model renders
exact numeric tokens as text for transport and retains structured source cells as
their original JSON representation. Use the projection encoding appropriate to
the intended customer value.

The reference uses this explicit projection:

```json
{
  "record_id": { "field": "_id", "type": "integer", "nullable": false, "encoding": "native" },
  "branch": { "field": "BranchName", "type": "string", "nullable": false, "encoding": "native" },
  "branch_code": { "field": "BranchCode", "type": "string", "nullable": false, "encoding": "native" },
  "physical_branch": { "field": "PhysicalBranch", "type": "integer", "nullable": false, "encoding": "native" },
  "service_tier": { "field": "Service Tier", "type": "string", "nullable": false, "encoding": "native" },
  "address": { "field": "Address", "type": "string", "nullable": true, "encoding": "native" },
  "ward": { "field": "WardName", "type": "string", "nullable": true, "encoding": "native" }
}
```

Save this selection with the inspected capture digest and an explicit title and
query name. The source retains the original field name behind each customer
alias. For example, `Service Tier` becomes `service_tier` through that saved
mapping. Nullable Address and WardName values remain null. Use `json` encoding
where a selected source column must distinguish an empty string from null.

Prepare a publication with equality filters `physical_branch, service_tier`,
sort fields `branch, record_id`, extraction order `record_id asc`, default
page size 20, maximum 50, maxRows 5000 and maxBytes 16777216. Read the publication
with `where_physical_branch=1` and inspect the original candidate and query
result. Record its exact candidate digest, reviewer and review note before
publishing with the returned original review ID.

Each refresh is a separately retained source edition. Compare editions from the
same resource through `merchant_ckan_compare` and the real unique source key,
such as `_id`. A missing or duplicate comparison key must be resolved from the
actual data. The original source and dataset publisher continue to own extraction,
reviewed publication and recovery.


### Flat authoring calls

The following JavaScript objects show tool arguments. Substitute IDs and
digests returned by the preceding original operation. Use the seven-field
`projection` object above and refresh `expectedOperationId` immediately
before each changing call:

```js
await call('merchant_ckan_inputs', {
  workspace: 'library', input: 'toronto_reference'
});
await call('merchant_ckan_import', {
  workspace: 'library', input: 'toronto_reference',
  expectedSha256: input.file.sha256,
  expectedOperationId: status.native.operation?.id ?? null
});

await call('merchant_ckan_source_save', {
  workspace: 'library', editionId: edition.id,
  expectedCaptureSha256: edition.manifestSha256,
  title: 'Toronto library branch data', query: 'branches', projection,
  expectedOperationId: status.native.operation?.id ?? null
});

await call('merchant_ckan_publication_create', {
  workspace: 'library', sourceId: source.id,
  filters: ['physical_branch', 'service_tier'], ranges: [],
  sorts: ['branch', 'record_id'],
  defaultLimit: 20, maxLimit: 50,
  order: [{ column: 'record_id', direction: 'asc' }],
  maxRows: 5000, maxBytes: 16777216,
  expectedOperationId: status.native.operation?.id ?? null
});
```

Import and authoring replies acknowledge the original launch. Follow their
`operationId` through status until the same operation reaches `COMPLETE`.
Its `result` contains the saved edition, source or publication entry. Read
`merchant_ckan_publication({workspace, publicationId, query})` to inspect
the original run and query result; the wrapper's `native` member contains
`run` and `detail`.

For the reference, query `where_physical_branch=1` yields
`native.detail.preview.page.total === 100` and 20 displayed rows. The
unfiltered candidate keeps all 112 rows. Review the exact
`native.run.data.candidate.candidateDigest` with
`merchant_ckan_publication_review`, supplying `reviewer`, `note`,
`publicationId` and the fresh original operation baseline. Then publish
through `merchant_ckan_publish` with the saved
`native.run.data.review.id`. Read the run again and require
`PUBLISHED`.

### Page saved project history

Status places original arrays inside `native` and continuation information
inside the top-level `paging` member. Each collection has
`{offset, limit, total, nextOffset}`. Continue a collection with its own
argument: `editionsOffset`, `sourcesOffset`, `publicationsOffset`,
`exportsOffset` or `buyerRequestsOffset`. The shared `limit` accepts
1–100 and defaults to 25. An array's current page length is not the collection
total.

The catalogue search has its own provider continuation. Follow its returned
`native.page.next` when selecting source packages, then inspect the selected
package's actual resources before capture.

## Join the original merchant and buyer workflow

A published candidate becomes a complete merchant package through
`merchant_ckan_merchant_export`:

```js
await call('merchant_ckan_merchant_export', {
  workspace: 'library', publicationId: publication.id,
  expectedCandidateDigest: candidate.candidateDigest,
  expectedOperationId: status.native.operation?.id ?? null
});
await call('merchant_ckan_merchant_stage', {
  workspace: 'library', exportId: exported.id,
  expectedManifestSha256: exported.manifestSha256,
  releaseId: 'ckan-library-mcp-c271-20261011',
  label: 'Toronto library data',
  expectedOperationId: status.native.operation?.id ?? null
});
```

Both calls start original workbench operations. Follow completion before taking
the returned package or release identity to the next step. The host supplies
the merchant origin, resource path and payment terms when exporting, and the
fixed original runtime options when staging.

The selected workspace and maintained merchant operator share the exact same
`PROJECT/seller-releases` directory. Check `releaseStoreMatches` when
opening or reading status. The original CKAN stage therefore appears immediately
to the maintained release controls:

| Step | Original tool and arguments | Use the returned value |
| --- | --- | --- |
| Inspect the staged package | `merchant_inspect({id})` | Exact release `id` and `digest` |
| Review selection change | `merchant_compare({to: id})` | Current `generation`, before/after release |
| Select the reviewed release | `merchant_activate({id, expectedDigest, expectedGeneration, reason})` | Current original release state |
| Start the selected seller | `merchant_start({expectedGeneration, expectedDigest})` | Owned `operator.instanceId` |
| Read the live service | `merchant_catalog({instanceId})` | Original health, offers and OpenAPI |
| Stop this owned seller | `merchant_stop({instanceId})` | Original stop outcome and current status |

Read `merchant_status` to recover current selection and ownership. A running
seller is owned by its original MCP process and instance ID. Select/start only
after the CKAN stage has completed. The release ID and digest returned by
`merchant_inspect` bind the retained package; the original release generation
guards the selection against concurrent changes.

The fixed seller in the connection must be the actual running
`http://127.0.0.1:PORT` listener. Read
`merchant_ckan_buyer_offer({workspace, exportId, query})`. Its `native`
member carries the selected snapshot, actual resource URL, original accepts and
`offerSha256`. For the reference, retain the same
`where_physical_branch=1` query.

Prepare the original buyer request with:

```js
await call('merchant_ckan_buyer_prepare', {
  workspace: 'library', exportId: exported.id,
  query: 'where_physical_branch=1',
  offerSha256: offer.offerSha256, acceptIndex: 0,
  intentId: 'ckan-library-mcp-c271-20261011-buyer',
  expectedOperationId: status.native.operation?.id ?? null
});
```

The stable SF88 intent accepts 1–128 letters, digits, dots, underscores, colons
or hyphens. Dataset, publication, review, export and native operation identities
use their original UUIDs. Buyer preparation returns a retained entry with the
original configuration and its SHA-256. Receive `buyer.json` through the
same file interface and compare the full file against that original digest.

The included reference runs the original onboarding challenge flow and prepares
its SF88 customer configuration. Actual settlement uses the original buyer and
the merchant's published payment terms.

## Receive complete saved files

The CKAN file tools use the existing `RetainedFileReads` implementation. List
the available saved files, select the original file identity and retain the
returned metadata: file name, byte count and SHA-256.


List with the exact saved item selector:

```js
await call('merchant_ckan_files', {
  workspace: 'library', kind: 'merchant', itemId: exported.id
});
```

The list returns
`files: [{file: 'package-relative-name', bytes, sha256}, ...]`.
The descriptor property is `file`. A source item lists `source.json`;
a buyer item lists `buyer.json`. The merchant list includes the original
manifest, handlers and every declared payload file. Preserve the package-relative
paths when writing the received files.

For the first chunk select one listed member:

```js
await call('merchant_ckan_file_read', {
  workspace: 'library', kind: 'merchant', itemId: exported.id,
  file: selected.file, expectedSha256: selected.sha256,
  offset: 0, limit: 65536
});
```

A read returns `readId`, `file`, `offset`, `bytesRead`, `nextOffset`,
`encoding: "base64"` and `data`. Decode the base64 bytes and write them at
the stated offset. Continue with the same file selection, `readId`,
`expectedSha256` and the returned `nextOffset`. The final chunk has
`nextOffset: null`. The default chunk is 65,536 bytes; the original maximum is
196,608 bytes.

If the read session expires, start a new read for the same file and expected
SHA-256 at the last confirmed byte offset. The retained snapshot releases at
completion or through `merchant_ckan_file_release`. Once the full file arrives,
check its total bytes and SHA-256 against the original metadata. Keep the
manifest and the complete payload together when handing a merchant package to
its receiving operator.

## Close and reopen

Close the exact MCP-owned `instanceId` after its active operation completes, or
explicitly cancel the current native operation first. The bridge closes the
borrowed HTTP server, the original workbench model and its native lease, then
releases owned file reads. Reopen the same alias to continue the saved project.
Read current operation and publication state before resuming work; historical
browser URLs refer to their original process lifetime.


## Run the complete native receiver

The accompanying
[merchant-mcp-receiver.mjs](examples/merchant-mcp-receiver.mjs)
is an executable client of the maintained authenticated MCP HTTP listener.
It uses Node built-ins and the registered tools. Run it against one dedicated
new CKAN project initialized by the host setup above, with the exact retained
Toronto manifest and its original sibling files declared as
`toronto_reference`.

This case has its own project and output directory. A separately retained
browser continuation keeps its original project and operation. Use the same
source checkout as the running MCP host, containing this guide, executable,
`ckan-workspace.mjs` and the matching merchant registry/configuration changes.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/examples/merchant-mcp-receiver.mjs \
  --url http://127.0.0.1:3211 \
  --workspace library \
  --input toronto_reference \
  --out /srv/starforge/ckan-mcp-received \
  --release-id ckan-library-mcp-c271-20261011 \
  --intent-id ckan-library-mcp-c271-20261011-buyer
```

The client reads the operator token from `MCP_ACCESS_TOKEN`; use
`--token-env NAME` for a different existing variable. The token stays out
of the receiving record. A private browser fragment is consumed only for the
same-model status read.

The program performs this connected product workflow:

1. Initialize the actual MCP HTTP protocol, inspect its registered tools and
   open the host-declared workspace. Verify the shared original release store
   and the borrowed UI's matching project identity.
2. Import the exact retained manifest, inspect all 112 source rows across the
   three original pages, and save the explicit seven-field source selection.
3. Reuse the previous operation baseline after the source is saved. Require
   `CKAN_OPERATION_CHANGED`, then read current status and verify that one
   original source and its operation remain. This exercises a client's old
   baseline without creating a second publication.
4. Prepare the original dataset candidate with the saved query policy, inspect
   100 physical branches with a 20-row first page, review the exact candidate,
   and publish its original version.
5. Receive the saved source and every original merchant package member through
   the retained chunk interface. Check complete byte counts and SHA-256 values.
6. Stage that package into the same original release store, inspect/activate it,
   start the owned seller and read its actual service catalogue.
7. Request the selected dataset from the actual seller and retain its HTTP 402
   response. Read the original buyer offer, prepare the SF88 request and receive
   the exact buyer configuration.
8. Stop the owned seller, close and reopen the same workbench, and confirm the
   original edition, source, publication, export, buyer identity and 100-match
   query survive. Close the reopened workbench.

The exact retained data, policy, original source engines, merchant handlers and
customer handoff all participate in this execution. The reference counts apply
to this retained capture; a different live edition has its own source identity
and expected query results.

### Receiving output and continuation

The output directory contains:

| File or directory | Contents |
| --- | --- |
| `receiver-operation.json` | Client selection, original operation/item identities, completed steps, file identities and terminal state |
| `received/source/<sourceId>/source.json` | Complete original saved source declaration |
| `received/merchant/<exportId>/` | Complete original merchant manifest, handlers and payload tree |
| `received/buyer/<buyerId>/buyer.json` | Complete original SF88 configuration |
| `seller-challenge.json` | Actual response bytes from the running original seller |
| `seller-offer.json` | Original offered resource, accepts, query and snapshot |

A completed run writes `state: "COMPLETE"`. The record must include the
same original identities after reopen, the query's 100 matches, the received
file digests and the actual seller challenge. Share the complete receiving
directory with the exact source revision and capture packet used by the host.

If execution is interrupted, retain the host configuration, original project
and receiving directory. Invoke the same command to reconcile saved IDs and
continue the same case. Completed local files are checked against their original
digests before reuse. A known active original operation is followed by its
retained ID. If the current operation or seller belongs to a different action,
inspect that original state before continuing. The client records cleanup
outcomes and closes only its owned instances.

The receiving record is a client progress artifact. The workbench operation,
publisher run, release store and original buyer configuration remain the product
state used for recovery. The program does not substitute its record for those
native objects.

## Maintained source interfaces

The integration calls the existing [workbench model](model.mjs) and
[borrowed browser server](server.mjs). CKAN extraction, original dataset
publication, complete merchant staging and buyer preparation live under
[publisher/](publisher/README.md). The maintained merchant host and HTTP transport
are documented in
[merchant operator](../../../../stellar-forge/mcp-merchant-operator/README.md).

Review `tools/list` for the deployed argument schemas and use the current
native result at each step. The connection fixes host resources; the client
selects aliases, original identities, public field mappings and reviewed
publication policy.
