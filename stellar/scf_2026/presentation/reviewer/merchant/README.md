# Original purchase reviewer through merchant MCP

This provider connects the original grant purchase reviewer to the maintained merchant MCP host and complete-file client. It uses the same workbench, original Buyer stores, source packet, quote IDs and results that the browser displays. An operator can review and receive a packet, inspect both original outcomes, download every result byte, export the closed native state and hand the exact packet to another declared workbench.

The provider is `grant-reviewer-workbenches`; the command is `starforge merchant-grant-reviewer`; the typed package export is `@tokenjunkielabs/starforge-merchant/grant/reviewer-merchant`. This is the purchase reviewer. The existing `grant-workspaces` provider continues to own grant planning, cash requirements and portfolio records.

## Connect an existing workbench

Save a private connection JSON on the merchant host:

```json
{
  "schema": "stellar-forge.grant-reviewer-merchant-connection.v1",
  "workspaces": {
    "original": {
      "directory": "/absolute/original/reviewer-workbench",
      "label": "Original purchase",
      "allowStart": false,
      "inputs": {
        "handover": {
          "file": "/absolute/original/grant-reviewer-packet.json",
          "sha256": "REPLACE_WITH_THE_REVIEWED_ORIGINAL_SHA256",
          "label": "Original receiving packet"
        }
      }
    },
    "receiver": {
      "directory": "/absolute/receiving/reviewer-workbench",
      "label": "Receiving operator",
      "allowStart": true
    }
  }
}
```

Each alias selects one canonical private directory. Relative paths resolve against the connection file. Optional `workbenchId` pins an already-created workbench UUID. Declared input files are read and hashed when the normal merchant configuration loads; a changed input is rejected until the operator reviews and reloads that configuration. Inputs are complete original reviewer packets, up to 8 MiB.

`allowStart: false` connects to the original running workbench. Open that workspace through the existing Applications product or reviewer CLI. Its private connection file stays on the host. `allowStart: true` additionally allows the explicit `workbench_open` tool to start that same native workbench from this installed source. Reads and ordinary actions never implicitly start a controller.

Initialize the normal merchant configuration:

```sh
starforge merchant-grant-reviewer init --directory /absolute/merchant --connection /absolute/reviewer-connections.json
starforge merchant-mcp serve --config /absolute/merchant/merchant-mcp.json --port 3211 --token-env MCP_ACCESS_TOKEN
```

The existing merchant host reads its credential from the selected environment variable. The setup command creates its original release store, export directory and configuration, with a durable input identity. Repeating the same setup resumes it; another connection or selected file body does not overwrite that setup. An existing merchant may instead add `grantReviewerConnection` to its original configuration.

Confirm the exact installed host command syntax with `starforge merchant-mcp --help` if the selected product has a narrower command map. A source checkout runs the same merchant host at `stellar-forge/mcp-merchant-operator/serve.mjs`; this provider does not introduce a second MCP server.

## Complete native workflow

All tools use the `merchant_grant_reviewer_` prefix. `tools` prints their exact JSON schemas. The typed client exposes the same actions as camel-case methods.

| Step | Operation | Retained identity |
|---|---|---|
| Connect | `workbench_open` | Workspace alias, native workbench and current instance UUID; owned or borrowed state |
| Review | `review` or `reviewFile` | Complete packet SHA, original request UUID and returned selection UUID |
| Receive | `receive` | Selection revision and original receive UUID |
| Open | `buyer_open` | Original received stores and a current Buyer instance |
| Inspect | `selection`, `buyer_read`, `buyer_result`, `document` | Original quote/result/source identity and complete retained files |
| Export | `export` | Original action UUID, exact closed native packet and quote history |
| Transfer | `downloadReviewerExport` | Export ID, manifest SHA, complete files and durable byte offsets |
| Receive again | `review_export` or `reviewFile`, then `receive` | Source packet identity plus the receiving workbench's original actions |
| Reopen | `workbench_open`, `selection`, explicit new `buyer_open` when closed | Same workbench, received stores and quotes |
| Close | `buyer_close`, then `workbench_release` if this merchant owns the controller | Original Buyer drained; borrowed workbench remains with its owner |

Every mutation carries a caller-retained UUID. Keep the exact original input and revision with that UUID. After a transport failure, call `action` or repeat that exact action; a changed input cannot reuse its identity. A completed `buyer_open` receipt is historical. Its replay includes the current `buyer` state separately, so reopening a closed Buyer is an explicit new lifecycle action, with a new saved UUID.

`export` calls the original workbench's serialized close/export operation. It drains the original Buyer and releases the native writer before reading the complete quote history. If an export was already published, its original request, source packet and exact output bytes are recovered before any current mutable history is read. The result contains both `operation.json` and the complete `grant-reviewer-packet.json`.

A borrowed controller remains owned by Applications. Merchant shutdown and `workbench_release` do not close it. Explicit `buyer_close` and `export` operate through that original controller and drain its Buyer. The merchant closes only controllers that it started; current workbench/instance identity is rechecked against the private file and actual HTTP health response.

## Typed client and complete files

```ts
import {openReviewerMerchantClient, downloadReviewerExport, reopenReviewerExport}
  from '@tokenjunkielabs/starforge-merchant/grant/reviewer-merchant';

const client = await openReviewerMerchantClient({
  url: 'http://127.0.0.1:3211/mcp', tokenEnv: 'MCP_ACCESS_TOKEN'
});
await client.workbenchOpen({workspace: 'original'});
const snapshot = await client.state({workspace: 'original'});
const fullState = await client.readValue({result: snapshot});
// Save the selected IDs and exact reviewed revision in your own operation before a mutation.
const result = await client.buyerResult({workspace: 'original', quoteId: originalQuoteId});
const receipt = await downloadReviewerExport({
  client, workspace: 'original', exportId: result.exportId!,
  expectedManifestSha256: result.manifestSha256, directory: '/absolute/download'
});
await reopenReviewerExport({
  workspace: 'original', exportId: receipt.exportId,
  expectedManifestSha256: receipt.manifestSha256, directory: receipt.directory
});
```

Check `result.retention.state === 'COMPLETE'` before consuming an export ID. If storage fails after an accepted native action, the response reports that original outcome plus a failed retention step and recovery guidance. Recover the same action after restoring storage; another UUID would represent another operation.

Small native responses appear inline and are also retained as complete files. Larger responses expose an explicit preview and file descriptor. `readValue` fetches the entire immutable original JSON, verifies its byte count and SHA, and parses it. `json` supports bounded pointer/array/object/string inspection without replacing the original file. `buyer_result` reads the complete native result representation from its maintained range API and retains it unchanged; it does not assemble a substitute result from a page or preview.

The file receiver uses the existing `RetainedFileReads` and `createRetainedDownload` implementations. Interrupted downloads retain the original byte prefix, manifest and export identity. Resume into the same directory after the merchant restarts. The endpoint binding is the immutable workbench UUID and workspace alias, so a new authenticated loopback port does not invent another export. Every resumed manifest, source file and prefix is still verified. `reopen` checks the complete local files without contacting the host.

```sh
starforge merchant-grant-reviewer review-file --url http://127.0.0.1:3211/mcp --workspace receiver --file /absolute/grant-reviewer-packet.json --title 'Received original purchase' --request-id ORIGINAL_UUID
starforge merchant-grant-reviewer call --url http://127.0.0.1:3211/mcp --action action --args /absolute/saved-action.json
starforge merchant-grant-reviewer download --url http://127.0.0.1:3211/mcp --workspace original --export-id ORIGINAL_EXPORT_SHA --manifest-sha256 ORIGINAL_MANIFEST_SHA --directory /absolute/complete-download
starforge merchant-grant-reviewer reopen --workspace original --export-id ORIGINAL_EXPORT_SHA --manifest-sha256 ORIGINAL_MANIFEST_SHA --directory /absolute/complete-download
```

The private workbench and Buyer access codes are never tool results, download manifests, URLs, command arguments or public discovery examples. The provider uses the original saved-history tools only: `bazaar_history`, `bazaar_results`, `bazaar_status`, `bazaar_read_result`. No signer, new purchase, remote discovery or payment replay is connected.

## Continue the original receiving operation

`RECEIVING.mjs` extends the existing completed reviewer operation. It requires that operation's exact `WORKBENCH-RESULT.json` and already-received sender/receiver workbenches. It uses the normal maintained merchant host and registry with this contribution selected; there is no replacement server or registry fixture.

The extension replays the original packet review and receive actions, reads both original complete results, retains/downloads the original accepted export, interrupts a real file transfer after a durable byte checkpoint, restarts the merchant and resumes that same file, then receives the exact file through the original second operator's saved review/receive actions. It also exercises a merchant-owned and a borrowed workbench, current lifecycle recovery and local complete-file reopen. The original 14-phase browser result is left unchanged. The extension uses its own journal beneath that same operation and retains zero new payment transactions.

```sh
node stellar/scf_2026/presentation/reviewer/merchant/RECEIVING.mjs --operation /absolute/original-reviewer-operation
```

Run it from the current selected source/installed closure, with its normal Node and original Buyer dependencies. It takes the same operation controller lease, so it cannot race the original managed Applications continuation. The final result records loaded source SHA values and closes all controllers/merchant hosts it owns; another application's borrowed controller remains under its original owner.
