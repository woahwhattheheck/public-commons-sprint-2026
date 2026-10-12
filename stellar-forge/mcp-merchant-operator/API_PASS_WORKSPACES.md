# API-pass customer workspaces through merchant MCP

This adapter operates the running API-pass customer workspace through its original authenticated HTTP interface. The browser, agent tools and reusable Node client see the same purchased passes, request identities, task queue, approval reviews and recovered results. The native customer model keeps its existing state lease. Merchant MCP owns only its connection, exact command journal and complete-file exports.

The installed package exports `./merchant/mcp/api-pass`, the typed client at `./merchant/mcp/api-pass/client`, retained command helpers at `./merchant/mcp/api-pass/operations`, and the resumable host initializer at `./merchant/mcp/api-pass/setup`. The API customer application can create the connection and local agent settings using its optional private agent directory; see the [customer workspace guide](../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-access/workspace/README.md).

The installed command is `merchant-api-pass`; its direct source entry is `stellar-forge/mcp-merchant-operator/api-pass-cli.mjs`. The reusable client and its adjacent TypeScript declarations are `api-pass-client.mjs` and `api-pass-client.d.mts`. Durable command helpers live in `api-pass-cli.mjs` with `api-pass-cli.d.mts`.

## Start with the existing customer workspace

Use the customer workspace's original configuration and its original host environment. The native command can create or reopen the complete private agent handover:

~~~sh
node stellar/scf-starforge-20261009/sf101-merchant-receiver/api-access/workspace/cli.mjs serve \
  --config /private/api-customer/workspace-config.json \
  --agent-directory /private/api-customer-agent
~~~

The original Applications page exposes the same **Private agent connection directory** field. The native launch stays `STARTING` until setup completes, then publishes its original `LISTENING` record. Its handover contains:

| Path below the agent directory | Purpose |
| --- | --- |
| `setup.json` | Original customer directory and immutable workspace identity. |
| `connection.json` | The host-declared `customer` alias and its existing launch file. |
| `merchant/merchant-mcp.json` | Original merchant host configuration. |
| `client-settings.json` | Original subprocess MCP client settings, server `starforge-api-customer`. |
| `operations/` | Exact resolved native commands and recovered HTTP receipts. |
| `exports/` | Immutable complete response, proof, review and history captures. |
| `reads/` | Original leased file-read snapshots. |

Load the generated `client-settings.json` into the local MCP application using its ordinary configuration workflow. The file selects the installed original `stdio.mjs` and passes only the merchant configuration path in `MCP_MERCHANT_CONFIG`. The customer launch capability remains in its private launch record.

For a remote reusable client or CLI, expose that same merchant configuration through the original authenticated HTTP host:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /private/api-customer-agent/merchant/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
~~~

Supply the existing merchant bearer secret through its named process environment. Use the actual endpoint printed by the host. This listener uses the original merchant transport and binds to loopback; an existing HTTPS deployment can expose the same authenticated endpoint.

Restart the customer with the same configuration and agent directory to reopen its original identities and journals. Setup resumes its own interrupted initialization under the original merchant lease. It preserves the original connection handles and completes its original release-store/configuration setup. If a reviewed setup or workspace preimage changed, Applications requests a current review; the command accepts explicit `--expected-agent-setup-sha256` and `--expected-workspace-sha256` for that reviewed start.

## Declare original inputs and purchases on the host

An existing merchant configuration attaches this adapter with:

~~~json
{
  "apiPassWorkspaceConnection": "/private/api-customer-agent/connection.json"
}
~~~

The complete private connection uses this schema:

~~~json
{
  "schema": "stellar-forge.sf101.api-pass-mcp-connection.v1",
  "workspaces": {
    "customer": {
      "label": "API customer",
      "workspaceId": "83e67129-fdbe-4693-8952-2830aef3b026",
      "launchFile": "/private/api-customer/workspace/api-pass-workspace-launch.json",
      "operationDirectory": "/private/api-customer-agent/operations",
      "exportDirectory": "/private/api-customer-agent/exports",
      "snapshotDirectory": "/private/api-customer-agent/reads",
      "files": {},
      "purchases": {}
    }
  }
}
~~~

Replace the illustrative workspace ID and paths with the original launch values. Declare 1–32 aliases. Each alias uses its own canonical, owner-controlled directories with mode `0700`; export, snapshot and operation roots must not overlap, including across aliases. The connection, launch and declared input files are regular owner-controlled files with mode `0600` and one hard link.

Optional `expectedEntrySha256` pins the original customer launch source. The current launch must be `LISTENING`, identify the declared workspace UUID, and expose its original `http://127.0.0.1:port/#capability` startup URL. Every native request authenticates `/api/session` and rereads that launch identity before and after dispatch. A restarted customer can be reopened through its current record using the same workspace ID.

Add hash-pinned file handles for work that needs an original handoff, body or approved request:

~~~json
{
  "files": {
    "plan-handoff": {
      "path": "/private/inputs/api-plan-handoff.json",
      "kind": "handoff",
      "sha256": "EXACT_64_HEX_SHA256",
      "label": "Original API plan handoff"
    },
    "request-body": {
      "path": "/private/inputs/request.json",
      "kind": "body",
      "sha256": "EXACT_64_HEX_SHA256",
      "label": "Selected request body"
    },
    "approved-request": {
      "path": "/private/inputs/original-approved-request.json",
      "kind": "approved-request",
      "sha256": "EXACT_64_HEX_SHA256",
      "label": "Original lost-output request preimage"
    }
  }
}
~~~

The limits are 64 KiB for a handoff, 1 MiB for a body and 32 KiB for an approved-request preimage. The `input` tool reports the complete original byte count and SHA. Wire operations select the handle and its expected SHA. The exact original bytes are verified and retained in the host command journal before dispatch, so an uncertain command can continue even after the external input path has gone away.

Add existing purchases by original customer metadata:

~~~json
{
  "purchases": {
    "existing-pass": {
      "directory": "/private/original-purchase",
      "customerSha256": "EXACT_CUSTOMER_JSON_SHA256",
      "intentId": "original-intent",
      "orderReference": "original-order",
      "label": "Existing purchased API access"
    }
  }
}
~~~

The host reads `customer.json`, verifies its complete hash, then checks its original `stellar-forge.sf101.api-purchase-customer.v1` schema, `intentId` and `orderReference` before calling the customer attach route. The returned native profile is checked against that same purchase. Agent tool arguments contain declared aliases and selected identities; filesystem selection stays in the private host configuration.

For a manually prepared connection, create or reopen its original merchant configuration with:

~~~sh
node stellar-forge/mcp-merchant-operator/api-pass-cli.mjs init-host \
  --directory /private/api-customer-agent/merchant \
  --connection /private/api-customer-agent/connection.json \
  --name "API customer"
~~~

`initializeApiPassWorkspaceMerchant({directory, connection, name, releaseStore})` is the corresponding reusable initializer. Omitting `releaseStore` creates the original empty SF82 store owned by this setup; an explicit existing original store is reopened. It never opens another customer model.

## Tool catalogue and original identities

All tool names begin `merchant_api_pass_`. Every scoped reply contains `workspace`, the actual `workspaceId`, and `native`. The typed client validates the envelope and returns `native`.

| Operations | Result and selection |
| --- | --- |
| `workspaces`, `open`, `status` | Configured aliases; original authenticated session; current revision and retained-work inventory. |
| `passes`, `pass` | Pass summaries or original pass detail, purchased routes, allowance and saved-call page. |
| `call`, `call_preview`, `body_preview` | Original request identity and explicit bounded text/binary previews. |
| `remote_calls` | Original merchant cursor page; pass the returned `nextAfter` as `after`. |
| `history`, `task` | Complete retained per-profile calls or tasks, and a selected original task. |
| `approval`, `input`, `operation` | Current original approval; declared input identity; exact host command receipt and attempts. |
| `connect`, `purchase_prepare`, `purchase_attach` | Original pass connection, new purchase preparation, or adoption of a declared existing purchase. |
| `update`, `prepare_request`, `adopt_request` | Native profile changes, frozen exact request preparation or same-request recovery attachment. |
| `enqueue`, `cancel`, `decide` | Original asynchronous task queue, selected task cancellation and exact original approval decision. |
| `capture`, `exports`, `manifest` | Complete native file capture, retained export inventory and immutable manifest. |
| `file`, `file_release` | Original manifest-pinned byte chunks and explicit read-snapshot release. |

Page operations accept `offset`, `limit` and, where specified, `expectedRevision`. A later page with a different original revision returns `API_PASS_OBSERVATION_CHANGED`; reopen that inventory from its first page. The Node client's `allPasses()` and `allHistory()` retain one revision across the complete traversal. Export inventory instead uses its `expectedInventorySha256`.

The native queue exposes these task kinds:

- Access: `refresh`, `call`, `recover`.
- Purchase lifecycle: `prepare-purchase`, `review-purchase`, `execute-purchase`, `recover-purchase`, `finalize-purchase`, `report-purchase`.
- Existing payment with lost original output: `inspect-lost-output`, `recover-lost-output`, `read-lost-output`, `export-lost-output`.

A call/recover task selects its original `callId`. Purchase execution selects the actual saved review UUID. Lost-output inspection selects the declared approved-request file and SHA; recovery selects that inspection's saved review UUID and the original transaction hash. Later read/export tasks reopen the same authenticated recovery. The original Buyer, Inbox, ledger and chain observer retain their native ownership and checks.

A native HTTP command receipt with phase `COMPLETE` means the selected command was accepted and its result was retained. Its asynchronous task may still be `QUEUED`, `RUNNING` or `CANCELLING`. Read the exact task or complete profile history for its actual `COMPLETED`, `ATTENTION`, `INTERRUPTED` or `CANCELLED` state.

## Retain an exact command before sending it

Use an original workspace revision and one operation ID for one intended mutation. After an interrupted reply, inspect the host journal or run the same retained client operation. The original HTTP request, selected file bytes and request fingerprint are retained before dispatch. If the original response survived a later journal-write interruption, it is recovered before any repeat send.

For example, put the selected existing purchase attachment in a private JSON file:

~~~json
{
  "expectedRevision": 12,
  "label": "Existing API access",
  "purchase": "existing-pass"
}
~~~

Then prepare it once:

~~~sh
node stellar-forge/mcp-merchant-operator/api-pass-cli.mjs prepare \
  --directory /private/operations/attach-original \
  --url http://127.0.0.1:3211/mcp \
  --workspace customer --workspace-id ORIGINAL_WORKSPACE_UUID \
  --kind purchase_attach --request /private/inputs/attach.json

node stellar-forge/mcp-merchant-operator/api-pass-cli.mjs run \
  --directory /private/operations/attach-original
~~~

Preparation saves the exact endpoint, workspace ID, token environment **name**, normalized arguments and generated operation ID in `request.json`. Repeating the same preparation without specifying another ID returns that original record. An explicit `--operation-id` can name an existing original operation.

Use these continuation commands against the same directory:

~~~sh
node stellar-forge/mcp-merchant-operator/api-pass-cli.mjs reconcile --directory /private/operations/attach-original
node stellar-forge/mcp-merchant-operator/api-pass-cli.mjs reopen --directory /private/operations/attach-original
~~~

`reconcile` reads the existing host receipt and retains it locally. `run` performs that same lookup first and, if needed, sends at most one exact selected action. `reopen` reads the saved local result offline. A lost transport response triggers one immediate read-only host lookup. A later continuation retains the same operation directory and request bytes.

Approval decisions use the exact original `intent`, `approvalId`, `requestSha256` and `decision`; their journal identity is derived from that frozen selection. Captures use their stable `exportId`. Neither accepts a separate operation ID.

A native stale-revision rejection leaves the original command retained. Inspect current state and deliberately prepare a newly reviewed command with a new identity for a changed action. Uncertain accepted work is first reconciled against its original identity.

CLI exit codes are 0 for a read, preparation or returned result; 3 for a command whose result is not yet observed; 2 for an error. A returned queue task's state is inspected separately.

## Reusable client and durable operation helpers

~~~js
import {connectApiPassWorkspaceClient} from './api-pass-client.mjs';
import {prepareApiPassOperation,runApiPassOperation} from './api-pass-cli.mjs';

const client = await connectApiPassWorkspaceClient({
  url: process.env.MERCHANT_MCP_URL,
  workspace: 'customer',
  workspaceId: process.env.ORIGINAL_WORKSPACE_ID,
  tokenEnv: 'MCP_ACCESS_TOKEN'
});
try {
  const passes = await client.allPasses();
  const selected = await client.pass({profileId: process.env.ORIGINAL_PROFILE_ID});
  const calls = await client.allHistory({profileId: selected.profile.id, view: 'calls'});

  await prepareApiPassOperation({
    directory: '/private/operations/retain-existing-response',
    url: client.endpoint,
    workspace: client.workspace,
    workspaceId: client.workspaceId,
    kind: 'capture',
    arguments: {
      exportId: 'original-response',
      selection: {kind: 'response', callId: process.env.ORIGINAL_CALL_ID}
    }
  });
  const result = await runApiPassOperation({
    directory: '/private/operations/retain-existing-response',
    client,
    execute: true
  });
  console.log({passes: passes.items.length, calls: calls.items.length, export: result});
} finally {
  await client.disconnect();
}
~~~

For a client library that already owns a structured MCP transport, use `createApiPassWorkspaceClient({workspace, workspaceId, endpoint, call})`. Its `call(name, arguments, options)` returns the tool's `structuredContent`. The client owns only its accepted requests; `disconnect()` drains them and leaves the original customer workspace running.

The TypeScript facade exposes the full pass, request, queue, approval, recovery, retained export and receiving methods. Low-level `invoke(kind, args)` validates the same declared wire contract. `enqueue` uses a discriminated union so each native task carries only the identities required by its original route.

## Capture and receive complete original files

Select one complete native file with a stable export ID:

| Capture kind | Required identities | Saved payload |
| --- | --- | --- |
| `response` | `callId` | `response.bin` |
| `review` | `profileId` | `purchase-review.json` |
| `proof` | `profileId`, `taskId` | `payment-proof.json` |
| `report` | `profileId`, `taskId` | `buyer-history.html` |
| `history` | `profileId` | `customer-history.json` |

For proof/report, the selected task is checked against the complete original profile history. Every native digest header and existing response identity is checked against the full bytes. Customer-history exports have a native export timestamp, so the adapter saves one whole original response and computes its hash over those exact bytes. It retains the source instance, launch/source hashes, original API path, observation time and available native revision.

Each completed export contains `api-pass-export.json`, schema `stellar-forge.sf101.api-pass-mcp-export.v1`, plus the one original payload. Its identity and bytes are immutable. Capture resumes from its saved payload and completion descriptor if publication was interrupted. A completed export is readable after the original customer closes.

~~~js
const captured = await client.capture({
  exportId: 'original-response',
  selection: {kind: 'response', callId: originalCallId},
  expectedSha256: reviewedResponseSha256
});
const downloaded = await client.downloadExport({
  exportId: captured.exportId,
  directory: '/private/receiving/original-response',
  expectedManifestSha256: captured.manifestFile.sha256
});
~~~

The equivalent complete receiving commands are:

~~~sh
node stellar-forge/mcp-merchant-operator/api-pass-cli.mjs inspect-export \
  --url http://127.0.0.1:3211/mcp --workspace customer \
  --workspace-id ORIGINAL_WORKSPACE_UUID --export-id original-response

node stellar-forge/mcp-merchant-operator/api-pass-cli.mjs download \
  --url http://127.0.0.1:3211/mcp --workspace customer \
  --workspace-id ORIGINAL_WORKSPACE_UUID --export-id original-response \
  --directory /private/receiving/original-response --manifest-sha256 REVIEWED_MANIFEST_SHA

node stellar-forge/mcp-merchant-operator/api-pass-cli.mjs reopen-download \
  --directory /private/receiving/original-response \
  --workspace customer --workspace-id ORIGINAL_WORKSPACE_UUID \
  --manifest-sha256 REVIEWED_MANIFEST_SHA
~~~

Receiving composes the original `RetainedFileReads` and `createRetainedDownload` engines. It verifies the complete manifest, each exact file hash, every chunk offset/length and final file bytes under the original receiving lease. The client and standalone receiving helpers retain the same endpoint, workspace alias and original workspace UUID, so a resumed download keeps its original identity.

A repeat download continues its saved verified prefix. A stopped or expired read snapshot is reopened against the same immutable export. Offline `reopen-download` rehashes the complete files and manifest. Previews remain explicitly bounded; these receiving commands deliver the complete selected file.

Default host retention is 256 completed or prepared exports and 256 MiB of completed payloads. Configure `maxExports` up to 10,000 and `maxExportBytes` up to 4 GiB for the declared storage. Native request bodies remain at their original 1 MiB limit, query input at 32 KiB, and file chunks at 196,608 bytes. Choose a fresh export ID for a later native history snapshot and retain earlier captures for their original observations.

## Continuation and ownership

The native workspace's original lease protects the customer model and queue. The adapter retains commands under its own operation lease and exports under its own export lease. File reads use the original leased snapshot engine. Multiple configured aliases have separate storage roots and remain bound to their declared workspace IDs.

After a native restart, reopen the original launch/session and continue the existing pass, request, task or command identity. After an MCP restart, inspect `operation`, `exports` or the complete retained manifest. After a client interruption, reopen or run its saved private operation directory. Disk or transport failures leave exact original requests available for continuation; complete native receipts and file descriptors are recovered before another dispatch.

The native customer remains the authority for purchase review and approval, Buyer/Inbox execution, paid allowance consumption, same-request replay, lost-output recovery and authenticated history. Merchant MCP makes those original capabilities available through the installed application, typed tools and complete-file receiving.
