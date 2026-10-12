# StellarExpert merchant MCP and original-file receiving

This connection gives an agent the same asset-investigation workspace used by the operator in the browser. It covers source acquisition, asset watches, review notes, edition comparisons, native datasets, merchant publication and customer receiving. The existing workspace remains the owner of its source, action journal and merchant runtime.

The adapter adds 27 tools: nine read/file tools and all 18 original action tools. Each original action carries a stable operation ID and the workspace revision. The file client downloads complete original files, keeps verified partial progress and reopens the finished delivery offline.

## Connect the selected workspace

Use the original installed READY runtime and start its **Stellar asset investigation** Application. Select its existing private workspace, optional original SF88 inbox and the original payment-runtime JSON. Review, Save, Start and Open through Applications. Its private \`application-url.json\` binds the selected source and original workspace UUID to the live session.

Create a private connection file, owned by the same Linux user that runs merchant MCP:

\`\`\`json
{
  "schema": "stellar-forge.stellar-expert-workspace-connection.v1",
  "workspaces": {
    "assets": {
      "label": "Stellar asset investigation",
      "workspaceId": "00000000-0000-4000-8000-000000000001",
      "applicationUrlFile": "/absolute/original/application-operation/application-url.json"
    }
  }
}
\`\`\`

Replace the example UUID with the original startup or workspace UUID and select the actual Applications record. Keep the connection and session files mode 0600 and their private directories mode 0700. Relative paths in the connection file resolve against that file's directory.

A direct workspace can instead declare exactly one \`consoleUrlFile\` or \`consoleUrlEnv\`. The file contains only the original printed \`http://127.0.0.1:PORT/#CAPABILITY\` URL. An environment reference names the variable holding that complete URL. The adapter accepts the canonical HTTP port 80 form as well. It reads the session reference when a new request starts, so a normal Applications restart can refresh the session while retaining the same workspace UUID.

The running schema must identify the configured UUID. A different source workspace is rejected before an action is sent. Tokens remain in the host's private session reference; tools accept configured aliases.

Initialize the ordinary merchant MCP host:

\`\`\`bash
starforge merchant-mcp init-stellar-expert-workspaces \
  --dir /absolute/private/stellar-mcp \
  --connection /absolute/private/stellar-connection.json
\`\`\`

For an existing merchant configuration, attach its original \`stellarExpertWorkspaceConnection\` field to this private connection file. The ordinary initializer also accepts \`--stellar-expert-workspaces CONNECTION_JSON\`. Existing sources, publishers and other providers remain in that merchant host.

Use its normal authenticated HTTP or subprocess transport. For HTTP, the MCP host reads \`MCP_ACCESS_TOKEN\` from the host environment:

\`\`\`bash
starforge merchant-mcp serve \
  --config /absolute/private/stellar-mcp/merchant-mcp.json \
  --port 3211
\`\`\`

The existing \`client-config.mjs\` creates the selected subprocess registration for MCP hosts. Incoming MCP authentication and the private browser capability serve their existing separate connections.

## Complete operator workflow

Start with \`merchant_stellar_expert_workspaces\`, then \`merchant_stellar_expert_schema\` and \`merchant_stellar_expert_view\` for the selected alias. Read \`ok\` before using a result. The original result is returned in \`native\`; the wrapper identifies \`workspace\` and \`workspaceId\`.

The live schema supplies the provider source contract, permitted capture kinds, typed query fields, original payment choices and runtime capability. Source amounts and large numeric tokens remain exact strings. The provider's rating describes ledger activity popularity. A capture records the actual observation interval and original response sequence.

| Work | Original tool family |
| --- | --- |
| Asset watch and review | \`watch_add\`, \`watch_remove\`, \`annotation_save\` |
| Original source acquisition | \`capture_start\`, \`capture_resume\` |
| Edition selection and comparison | \`edition_select\`, \`edition_compare\` |
| Native dataset preparation and queries | \`dataset_prepare\`, \`dataset_query\` |
| Original merchant lifecycle | \`release_prepare\`, \`release_inspect\`, \`release_activate\`, \`release_start\`, \`release_stop\`, \`release_rollback\` |
| Original customer receiving | \`buyer_inspect\`, \`buyer_receive\` |
| Complete edition exports | \`export_create\` |

Each family name has the prefix \`merchant_stellar_expert_\`. The tools expose typed fields matching the original workspace. They pass these fields to the existing action API.

For example, after reading the current revision, retain this request before sending it:

\`\`\`json
{
  "workspace": "assets",
  "operationId": "asset-review-20261012-001",
  "expectedRevision": 17,
  "query": {
    "kind": "assets",
    "network": "public",
    "search": "USDC",
    "sort": "rating",
    "order": "desc",
    "limit": 50
  },
  "label": "USDC asset investigation",
  "pageBudget": 20
}
\`\`\`

Send it to \`merchant_stellar_expert_capture_start\`. Use the returned original \`captureId\` for later passes. Inspect the capture state, next continuation and retry time in the workspace view. Completed source pages are retained before a following request. The original provider's retry interval controls a rate-limited continuation.

Use \`merchant_stellar_expert_editions\` to reach the full archive. The first page returns \`revision\` and \`nextOffset\`; repeat the revision as \`expectedRevision\` for each following page. A concurrent workspace change returns HTTP 409 with \`STELLAR_REVISION_CHANGED\` and its current view. Restart archive pagination at offset zero after that change.

Use \`merchant_stellar_expert_edition\` to inspect any immutable edition and every original response receipt. This read preserves the browser's current selection. \`merchant_stellar_expert_rows\` pages the same edition's normalized records using \`nextOffset\`; each row carries its original page hash, record position, observation time and URL.

Dataset preparation returns the original \`datasetId\`, snapshot and column descriptors. Pass query parameter values as strings to \`dataset_query\`, including original field selection, filters, sorting, page limits and cursor. Exact native query responses and query outcomes remain in the same journal.

Merchant preparation requires explicitly reviewed origin, resource path and payment terms. Inspect the original publisher's active/previous selection and generation before activation, startup or rollback. Merchant startup uses the workspace's selected native payment runtime. Customer receiving selects the original ordered SF88 intent IDs from the host's inbox and passes them through the existing SF100 receiver. It returns the original dataset identity, page/row counts and five-file manifest.

## Recover a changed or interrupted action

Every action requires \`operationId\` and \`expectedRevision\`, including inspections and dataset queries that the original workspace records in its journal.

For a successful action, inspect \`native.result\` and \`native.view\`. A response with \`state: RUNNING\` means that the original operation is still active. Retain that request.

For a connection loss after dispatch, the adapter returns \`ok: false\`, \`state: OUTCOME_UNCERTAIN\`, and the complete pending \`request\`. Read the current view, then repeat the same tool request, operation ID and payload. The original journal checks an existing operation identity before checking the revision and returns its retained completion. Changing a payload while keeping its operation ID produces an identity conflict.

A new action with an old revision returns the native conflict, current revision and view. Review the refreshed state and resubmit the intended new action with the current revision. For a provider rate limit, retain its original retry time and capture ID. The adapter performs one request per explicit action and lets the original workspace own completion.

Closing MCP drains its own pending calls and temporary file reads. Applications controls the existing browser and merchant lifetime. Stop and Reopen use the same saved workspace.

## Original source and customer files

\`merchant_stellar_expert_files\` returns the exact original metadata and a file selector:

- \`kind: source\`, \`id: EDITION_SHA256\` lists every original response page.
- \`kind: export\`, \`id: export-…\` or \`comparison-…\` selects a complete saved JSON, CSV, report or comparison.
- \`kind: receipt\`, \`id: buyer-…\` selects the original \`dataset.csv\`, \`dataset.jsonl\`, \`review.html\`, \`delivery.json\` and \`manifest.json\`.

Use \`merchant_stellar_expert_file_read\` with that selector. The first response returns original file size/hash, a \`readId\`, base64 bytes and \`nextOffset\`. Continue with the same selector, \`readId\`, \`expectedSha256\` and offset. The server verifies original bytes against their source receipt or customer manifest before retaining a read snapshot. Chunks are at most 196,608 bytes.

A retained read can finish after the original console closes. If it expires or MCP restarts, reopen the same immutable file selection with its expected SHA256 and saved byte offset after the workspace session is available. \`file_release\` releases a temporary read immediately; original source and customer files remain in the workspace.

The maintained reader permits four simultaneous snapshots and a combined 256 MB snapshot budget, with a two-minute idle lifetime. Large snapshots use private unlinked files in the existing merchant export directory. Original provider pages retain their eight-MiB source limit.

## Download and reopen the complete handover

The installed \`stellar-expert-mcp\` command uses the original merchant MCP transport and retained-download engine. Its authentication token comes from the chosen environment variable. Inspect first:

\`\`\`bash
starforge stellar-expert-mcp inspect \
  --url http://127.0.0.1:3211/mcp \
  --workspace assets --kind receipt --id buyer-RECEIPT_ID
\`\`\`

Select the returned actual ID and reviewed \`manifestSha256\`, then receive all original files:

\`\`\`bash
starforge stellar-expert-mcp download \
  --url http://127.0.0.1:3211/mcp \
  --workspace assets --kind receipt --id buyer-RECEIPT_ID \
  --out /absolute/private/customer-delivery \
  --manifest-sha256 REVIEWED_TRANSFER_SHA256
\`\`\`

The receiver creates \`stellar-transfer.json\` as a local transfer index alongside the unchanged original payloads. The original customer \`manifest.json\` remains one of those payloads. The transfer index binds workspace UUID, original receipt or edition, original file hashes and local receiving names. Source responses receive a page-number prefix so identical response bodies at different positions retain distinct page selections.

Repeat the exact download command and directory after interruption. The maintained receiver verifies each saved prefix, resumes at its saved offset, reacquires an expired original read when needed, and verifies every complete file before final publication. It serializes receiving with the existing Linux flock lease.

Source and export downloads use the same command with their selected kind and ID. A source selection receives all source pages that fit the maintained 65 KB transfer index; \`--page N\` selects an individual original response for larger captures. Complete edition JSON/CSV/report exports remain available through the original export action.

Reopen the saved delivery with its reviewed transfer hash:

\`\`\`bash
starforge stellar-expert-mcp reopen \
  --out /absolute/private/customer-delivery \
  --manifest-sha256 REVIEWED_TRANSFER_SHA256
\`\`\`

Reopen reads local bytes and verifies every original file. The JavaScript module exports \`openStellarExpertClient\`, \`inspectStellarExpertFiles\`, \`downloadStellarExpertFiles\` and \`reopenStellarExpertFiles\` for an existing application. \`client.action(action, payload, {operationId, expectedRevision})\` preserves the caller's explicit request identity.

The original [operator guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-expert/OPERATOR_GUIDE.md) covers the full source, merchant, browser and customer workflow.
