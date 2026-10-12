# Operate a saved GraphQL merchant through the original MCP provider

This connection exposes the complete SF105 GraphQL workspace in the existing
merchant MCP operator. A person can use the original browser while an agent uses
the tools: both work with the same saved project, immutable revisions, preview
UUIDs, merchant exports, deployment records and SF82 release console.

The GraphQL compiler, schema validation, variable admission, seller, buyer client,
deployment compiler and kernel writer lease remain their original implementations.
The adapter makes those operations accessible from the merchant provider and
delivers their original files through its shared resumable transport.

## Connect a host workspace

Use the same installed merchant source tree and its declared GraphQL dependency.
From a source checkout the entry point is:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-graphql-workspaces \
  --dir /srv/starforge/graphql-operator \
  --connection /srv/starforge/graphql-connections.json
~~~

Both the connection file and workspace directories are private host inputs:
connection JSON mode 0600, data directories mode 0700. Create an empty private
directory for a new workspace, or select an existing SF105 workspace. Resolve a
previous standalone writer normally before opening the same directory here.
Initializing the merchant provider validates configuration; explicit
`merchant_graphql_open` opens the native GraphQL writer and browser.

Example connection, with documentation-only endpoint names:

~~~json
{
  "schema": "stellar-forge.graphql-workspace-connection.v1",
  "workspaces": {
    "indexer": {
      "label": "Stellar indexer merchant",
      "directory": "./graphql-workspace",
      "sources": {
        "primary": {
          "label": "Approved indexer",
          "endpoint": {
            "schema": "stellar-forge.subquery-schema-endpoint.v1",
            "origin": "https://indexer.example",
            "path": "/graphql",
            "authorizationEnv": "SUBQUERY_GRAPHQL_AUTH",
            "timeoutMs": 8000,
            "maxResponseBytes": 262144
          }
        }
      },
      "runtime": {
        "port": 0
      },
      "hosts": {}
    }
  }
}
~~~

There are 1–16 workspace aliases, each with 1–32 fixed source aliases. Directory
paths resolve relative to the connection file. Each canonical workspace directory
has one alias. The original source compiler enforces its endpoint and transport
limits at capture, compilation and execution.

The host declares the source origin, path and optional environment reference.
Preview, merchant preparation and deployment staging compare saved query
connection fields against that exact alias. A tool caller cannot substitute
another endpoint or environment-variable name for a preview. Optional
`allowLoopback:true` belongs to the source definition for an explicitly selected
local development backend; it is false by default.

Optional `runtime.facilitator` and `runtime.allowLocalFacilitator` configure the
original release launcher. `hosts` maps host aliases to complete original SF105
host-plan JSON. These are the original deployment compiler's fields, not a second
host format; see [the native deployment guide](../../stellar/scf-starforge-20261009/sf105-subquery-graphql-merchant/deployment/README.md).
The selected merchant supplies runtime kind, configuration, handlers and upstream
files, so these fields cannot be injected through a host alias.

An existing merchant configuration can add
`graphqlWorkspaceConnection:"/srv/starforge/graphql-connections.json"` beside
its other connections. Ordinary `init` accepts
`--graphql-workspaces CONNECTION_JSON`. The same provider retains its accounting,
pricing, source, receiving, Woo and other configured tools.

Run the original authenticated MCP transport:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /srv/starforge/graphql-operator/merchant-mcp.json \
  --port 3211
~~~

Supply a bearer token of at least 24 printable characters through
`MCP_ACCESS_TOKEN` or the selected `--token-env`. Source credential values stay
in the original server environment. The original HTTP listener is loopback-only.
The existing [stdio host](STDIO.md) uses the same operator and tools.

## Open the same project and browser

1. Call `merchant_graphql_status` to inspect configured aliases. It does not open
   a workspace.
2. Call `merchant_graphql_open` with `{"workspace":"indexer"}`. Retain the returned
   `instanceId`. The returned `browserUrl` opens the original SF105 browser.
3. Use `merchant_graphql_projects` and then `merchant_graphql_project`. Supply
   `revision` for an immutable historical draft, or omit it for the current head.
   Set `includeInput:true` when the full raw draft is needed.
4. After every change consume the returned project revision before another
   mutation. A concurrent browser edit produces the original revision conflict.
   Reopen the current head and reconcile the actual change.

The browser URL contains the native session capability. Share it only with an
operator who should control this local workspace. It is returned explicitly to
the authenticated MCP client and is not included in exported customer files.

Project history uses the original most-recent 100-revision window. The tool
returns `moreBeforeNativeWindow` and `oldestRevisionInWindow` so that a long
history is not presented as complete. Any older retained revision remains
accessible through `merchant_graphql_project` with that revision number.

Lists expose `offset`, `limit`, `nextOffset` and `snapshotSha256`. Pass
`expectedSnapshotSha256` on subsequent pages. If the list changes, reopen its
first page. This applies to project lists, schema inventories and retained
collections.

## Save source and author a bounded operation

A native draft has four strings: `title`, `schemaText`, `queriesText` and
`planText`. For a new project use `merchant_graphql_save` with
`expectedRevision:0` and those four fields. Use the original schema/query/plan
formats from the [SF105 onboarding guide](../../stellar/scf-starforge-20261009/sf105-subquery-graphql-merchant/onboarding/README.md).
For an existing project, `input` may contain only the fields being changed;
the original store keeps the others in the same atomic revision.

Unfinished raw JSON is saved as a draft. Saving does not assert that the query
or payment plan compiles. `merchant_graphql_review` validates the selected
saved input through the original compiler and returns its actual operations,
routes and terms.

For a real source refresh, call:

~~~json
{
  "workspace": "indexer",
  "source": "primary",
  "project": "stellar-payments",
  "expectedRevision": 4,
  "includeSchema": false
}
~~~

These are the arguments to `merchant_graphql_capture`. It makes one native
introspection request, then saves the exact returned schema into the selected
project using its original revision guard. It keeps the title, queries and
merchant plan. The reply contains the new project revision, source identity and
schema hashes; a large schema need not pass through the agent's context.
If the browser changes the draft during capture, the save conflicts instead of
overwriting that newer draft.

Omit both `project` and `expectedRevision` for an unsaved capture. That returns
`schemaText` by default for an explicit later save. `includeSchema` controls
full text independently. A lost response to a saved capture is resolved by
opening the current project and inspecting its source; repeating with the old
revision cannot silently overwrite it.

`merchant_graphql_schema` pages the actual captured schema. Select
`collection:"roots"`, `collection:"types"` or a concrete `type` for fields and
enum values. Root rows identify which object-valued queries are supported by
the original merchant adapter. Fields include actual GraphQL types, arguments,
descriptions, required flags and defaults.

`merchant_graphql_operation` opens an existing operation as the original
authoring model. With `model` supplied it compiles without saving.
`merchant_graphql_apply_operation` compiles and saves in one original
revision-guarded action.

A field model has the following original shape:

~~~json
{
  "name": "payments",
  "handler": "getPayments",
  "admission": "admitPayments",
  "maxNodes": 100,
  "root": {
    "field": "payments",
    "arguments": {"first": "$first"},
    "selections": [
      {"field": "totalCount"},
      {
        "field": "nodes",
        "selections": [
          {"field": "id"},
          {"field": "txHash"},
          {"field": "amount"}
        ]
      }
    ]
  },
  "variables": {
    "first": {
      "graphqlType": "Int!",
      "native": {"type": "integer", "required": true, "min": 1, "max": 100},
      "sample": 10
    }
  }
}
~~~

This example is valid only for a schema with those actual fields. Read the
source inventory and open the operation before editing it. Arguments are
GraphQL literal strings or declared `$variables`. Buyer variables use the
original bounded Int/String/ID/Boolean forms; other input structure remains
fixed GraphQL literals. The original compiler enforces 128 fields, 16 selection
levels and 16 variables.

If a field edit renames an operation, the adapter updates the matching plan
route's operation reference and variables sample in the same saved draft.
It preserves public path, price/payment declarations, service name and other
route fields. Invalid raw plan JSON remains intact and the result explains
that the plan still needs repair. Preparation always runs the original full
validation; a successful field edit alone does not approve an incomplete plan.

## Preview once, inspect returned bytes, and recover

`merchant_graphql_preview_start` takes:

- the workspace and project;
- `expectedRevision` of the exact saved input;
- the host `source` alias;
- an approved `operation` and bounded `variables`;
- a caller-retained version-4 `previewId`.

The operation returns promptly while the original native preview runs.
Keep the same UUID throughout status, result, cancellation and recovery.
The original authoring layer saves the pending request before contacting its
source and preserves its actual returned bytes and status.

Use `merchant_graphql_preview_status` with the project and UUID. Completed
native previews remain inspectable after the MCP process reopens. A pending
native request without a known returned result is reported as started; the
adapter does not replay that request automatically. The source request is a
read-only GraphQL query, but it may still consume the provider's normal quota.

`merchant_graphql_preview_cancel` aborts an in-flight request owned by this
operator. It then reports the native recorded state. Cancellation does not
invent a successful response, erase a completed response or cancel a different
process's request. Use the actual status to decide whether a later explicit
new preview is useful.

`merchant_graphql_preview_result` reads the retained response view. Supply its
original `previewId`, use `pointer` for a JSON Pointer into the returned JSON,
and use `offset`/`limit` for a page. Repeat `expectedSnapshotSha256` for subsequent
pages; the reply also preserves the original response SHA-256 for byte delivery. The original
response is preserved byte-for-byte; table/object projections are a view over
those bytes. Large exact responses are also downloadable as the `preview`
file kind described below.

If the source response completed but its reference was not added to the current
project because a browser edit won the revision race, call
`merchant_graphql_preview_recover` with that same preview UUID and the current
`expectedRevision`. This uses the original recovery method: it links the actual
completed historical response into the current project without replacing the
current input. The result keeps its original draft revision and input digest.

When closing the merchant process, admission closes first, owned source requests
are aborted, and the same native workspace and release sessions drain before
the process exits. Use `merchant_graphql_close` with its current `instanceId`
for an explicit workspace handover. Saved files and native IDs survive the close.

## Prepare the merchant and review schema evolution

`merchant_graphql_prepare` uses the current saved revision and a matching source
alias, then invokes the original merchant exporter. Its returned `project` is
the new revision and `exported.id` is the native merchant UUID. The original
packet contains approved queries, schema source, seller configuration, public
API/developer material and the generated buyer files. It makes no paid purchase.

Payment values are explicit original plan fields: scheme, network, amount,
asset, destination and timeout. Use the merchant's actual selected terms.
The adapter does not choose a recipient, alter amounts or substitute a network.

For a source or query change:

1. Retain the original merchant export UUID as the baseline.
2. Capture or save the changed source/query/plan into a new draft.
3. Call `merchant_graphql_evolution` with current `expectedRevision` and
   `baselineExportId`.
4. Review the original comparison and retain `comparisonDigest`.
5. Call `merchant_graphql_prepare_revision` with that exact baseline/digest,
   current revision and source alias.

The original schema-evolution compiler classifies the selected contract,
including nested input fields, defaults and enum contracts. It writes its
original revision wrapper and joins the original merchant packet. Both remain
available as separate transfer kinds. A changed input, baseline or comparison
must be reviewed again; merely reopening an old report is not preparation
authority.

Supply `reportExportId` to `merchant_graphql_evolution` to reopen an already
retained report. That reads the saved report rather than authorizing a new
revision. Historical export references remain tied to the revision containing
them.

## Prepare deployment, stage, activate, run and hand over

`merchant_graphql_deployment` calls the original deployment workspace actions:

| Action | Additional selection | Result |
| --- | --- | --- |
| `prepare` | `source`, native `exportId` | Original deployment UUID and new saved project revision |
| `stage` | `source`, `deploymentId`, caller-selected `releaseId`, optional `label` | Original SF82 staged release and native deployment generation |
| `host` | `deploymentId`, configured `host` alias | Original host packet bound to the selected merchant |
| `recover` | `deploymentId` | Original saved-action recovery into the current project revision |

Every action also uses the workspace, project and `expectedRevision`.
Inspect `merchant_graphql_deployment_status` with the native deployment ID for
its current generation, retained release/host records and pending recovery.

`merchant_graphql_release_status` opens the original SF82 console belonging to
that project's deployment store and returns its `browserUrl`. Tools and this
console operate the same release selection and owned process. With `to` and
optional `from` it returns the original release diff.

`merchant_graphql_release_change` accepts `activate`, `rollback`, `start`,
`stop` and `restart`. Use the workspace, project and deployment ID throughout:

- For activate/rollback, select `releaseId` and supply the reviewed
  `expectedDigest`, current `expectedGeneration` and an operator `reason`.
- For start, use the selected release's exact digest and selection generation.
- For stop, use the current native console `instanceId`.
- For restart, use that instance ID plus the selected release's digest and
  generation.

The native SF82 console owns actual process identity, selection and shutdown.
Its original start checks verify merchant files and any schema-evolution
wrapper before starting the original seller. After a lost response, inspect
release status and its actual instance before a further lifecycle change.

Host packets remain the original deployment compiler's install/run material.
Downloading one does not install services, edit another host or contact a
remote machine. Follow its native README with the host's selected environment
when carrying out a real installation.

## Deliver exact retained files

Create a durable transfer selection with `merchant_graphql_export_prepare`.
`exportId` here is a caller-selected transfer alias, separate from the original
merchant/export UUID. Example:

~~~json
{
  "workspace": "indexer",
  "project": "stellar-payments",
  "revision": 12,
  "kind": "merchant",
  "merchantExportId": "11111111-1111-4111-8111-111111111111",
  "exportId": "stellar-payments-merchant-r12"
}
~~~

Replace the illustrative UUID/revision with the actual returned native identity.
Repeating an identical transfer alias/selection reuses its original descriptor.
A different selection using that alias conflicts.

| Kind | Native IDs | Exact retained files |
| --- | --- | --- |
| `draft` | project + revision | Raw schema, query and plan text plus original saved project JSON |
| `preview` | `previewId` | Original request, response and completed preview record |
| `merchant` | `merchantExportId` | Original merchant packet, including nested buyer files |
| `evolution` | `merchantExportId` | Original schema-evolution wrapper and report |
| `deployment` | `deploymentId` | Exact selected native deployment generation |
| `host` | `deploymentId` + `hostId` | Original selected host packet |

All kinds include the original `workspace-files.json` manifest. Transfer
metadata adds `graphql-export.json` with workspace alias, original selection,
source identity, file sizes and SHA-256s. It does not duplicate the payloads
on the server or create another compiler/export engine. Files are verified by
the original readers and immutable record references before their bytes enter
the shared read-snapshot service.

Inspect and receive through the native merchant CLI:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs inspect-graphql \
  --url http://127.0.0.1:3211/mcp \
  --export-id stellar-payments-merchant-r12

node stellar-forge/mcp-merchant-operator/serve.mjs download-graphql \
  --url http://127.0.0.1:3211/mcp \
  --export-id stellar-payments-merchant-r12 \
  --manifest-sha256 REVIEWED_MANIFEST_SHA256 \
  --out /srv/deliveries/stellar-payments-r12
~~~

Use the actual MCP URL returned by the listener; the illustrative path above
must match it. The token comes from the same client environment reference.

The shared downloader preserves nested original paths, creates private parent
directories, stores its original checkpoint and resumes verified byte prefixes.
It uses the original read IDs; if a read expires or the MCP process reopens,
it opens a new snapshot for the same expected file SHA and resumes the saved
offset. Existing completed files are rehashed and retained. Unexpected files,
symlinks, a different export/manifest, or changed partial bytes cause a conflict
rather than an overwrite.

Interrupt the command normally and repeat the exact same command/output directory
to continue. Partial names are private hash-derived files in `download-state`;
the original relative names remain in the checkpoint and completion manifest.
Only the opted-in GraphQL downloader uses nested mode; existing flat transport
callers keep their original partial-file format.

Installed applications can use the same maintained module exports:
`@tokenjunkielabs/starforge-merchant/merchant/mcp/graphql-workspaces`,
`@tokenjunkielabs/starforge-merchant/merchant/mcp/graphql-download`, and
`@tokenjunkielabs/starforge-merchant/seller/graphql/workspace-files`.
The ordinary distribution includes these original modules and the same CLI;
receiving applications do not need a separate GraphQL wrapper package.

For direct clients, the native tools are
`merchant_graphql_export_manifest`, `merchant_graphql_export_file` and
`merchant_graphql_export_file_release`. A chunk includes the full original
file identity, byte offset, base64 bytes, next offset and read UUID. Limits are
1–196608 bytes per chunk, four active snapshots and 256 MB of snapshot bytes.
Complete or released reads free their original temporary snapshot.

After download, use the original packet's README and generated buyer material.
Draft exports preserve source for review; reopening a complete existing workspace
continues through its host alias. This file transfer does not reconstruct a
second database or imply that a draft-only transfer contains a complete runtime.

Configured GraphQL hosts accept up to 8 MiB in an HTTP request or stdio frame,
so a complete native draft fits with the MCP envelope and JSON escaping. The
original SF105 request limit remains 7 MiB and its individual draft limits still
apply. Other hosts retain their existing request limits.

## Reopen and operator recovery

Keep the original private workspace directory and merchant configuration.
Restart the merchant host, inspect configured workspaces, and explicitly open
the same alias. The original saved project/revision/export/preview IDs reappear.
Browser capabilities and running process instances are new session identities;
never reuse a stale instance for a stop or release change.

Retained transfer descriptors are independent of an open browser writer. They
remain readable after the workspace closes and after the MCP host reopens, as
long as the same configured alias still resolves to its original retained
files. The reader verifies the selected original records rather than trusting
only a client-supplied name or hash.

A usable recovery sequence is:

1. Inspect current project and exact saved revision.
2. Inspect the original preview/deployment record when a response was lost.
3. Recover that original record through its native method when needed.
4. Inspect native release selection and actual owned process.
5. Continue the existing transfer alias/output directory for interrupted files.

Raw source, generated customer material and retained responses are private
operator data. Select the intended packet before sharing it with a customer;
the transfer does not decide which private source or response records a buyer
should receive.
