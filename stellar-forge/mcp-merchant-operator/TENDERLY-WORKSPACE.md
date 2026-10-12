# Tenderly merchants in the merchant MCP

The merchant MCP opens the same Tenderly operator workspace as the browser.
Profiles, prepared products, original request tickets, merchant operations,
saved provider observations and recovered responses stay in that workspace.
The browser URL returned by an open call controls that same model.

Use Node 22.16 or later and the installed Starforge package. The source entrypoint
is `stellar-forge/mcp-merchant-operator/serve.mjs`.
The native merchant guide is
[WORKSPACE.md](../../stellar/scf-starforge-20261009/partners/tenderly-stellar-pilot/WORKSPACE.md).

## Host setup

Create a private workspace directory or choose the existing Tenderly workspace.
Each directory has one alias in the connection file. Paths are resolved against
the connection file; tool calls select aliases and original IDs.

```sh
mkdir -m 700 /private/tenderly-workspace
```

Save a private `tenderly-connection.json`:

```json
{
  "schema": "stellar-forge.tenderly-workspace-connection.v1",
  "workspaces": {
    "evm": {
      "label": "EVM simulation merchant",
      "directory": "./tenderly-workspace"
    }
  }
}
```

The optional `plan` field names an existing private merchant-plan JSON file.
The original workspace saves that plan as a content-addressed profile when
opened. The optional `facilitator` field selects the original HTTPS payment
facilitator for native merchant startup. Set it to the facilitator selected for
the saved Stellar payment terms. A merchant started without it retains the
original review mode returned in its status.

```sh
chmod 600 /private/tenderly-connection.json

starforge merchant-mcp init-tenderly-workspaces \
  --dir /private/tenderly-mcp \
  --connection /private/tenderly-connection.json \
  --name "EVM simulation merchant"

starforge merchant-mcp serve \
  --config /private/tenderly-mcp/merchant-mcp.json \
  --port 3211 \
  --token-env MCP_ACCESS_TOKEN
```

Keep the provider access key and stable operation signing key in the launch
environment under the exact names in the original merchant plan. The MCP
authentication token also comes from its named environment variable. The
connection file and tool arguments carry these references through the original
product; they do not carry credential values.

To add the workspace to an existing merchant MCP, set
`tenderlyWorkspaceConnection` in its original `merchant-mcp.json` to the
connection file. The existing source, fleet, pricing, accounting, publisher and
other workspace bindings remain usable.

## Reopen a saved workspace at another directory

Close the owned workspace before moving it, then copy its complete directory,
including profiles, prepared packages and their operation state. Point the
connection file at the received directory and open its existing alias. Reopening
verifies the prepared package's original file bindings and derives its current
package, operation, plan, service, upstream, OpenAPI and client locations there.

The workspace ID, profile ID, prepared creation time, request tickets, native
operation generations, provider observations and complete response hashes stay
with the saved workspace. Use the same environment references and stable
operation signing key. Inspect those original IDs after opening, then continue
saved file reads by their SHA256 and byte offset as described below.

## Prepare the merchant and customer request

1. Call `merchant_tenderly_workspaces` and choose an alias.
2. Call `merchant_tenderly_open` with `{"workspace":"evm"}`.
   Its response includes the original workspace ID, owned instance ID, current
   browser URL, saved profiles, original plan template and example request.
3. Use `merchant_tenderly_profile_preview` to validate a complete plan.
   Review the returned provider account/project, EVM network, public route,
   Stellar payment, limits, environment names and normalized plan hash.
4. Save that plan with `merchant_tenderly_profile_save`, then use the returned
   `p-…` ID with `merchant_tenderly_profile_open`.
   Opening prepares the original merchant and customer package when needed.
   `merchant_tenderly_prepare` can prepare it independently.
5. Issue the customer's exact historical request with
   `merchant_tenderly_issue`. Use the original stable operation ID and
   customer subject. **`expiresAt` is Unix milliseconds**: for example,
   calculate `Date.now() + 3600000` once and keep that same value on replay.
   The saved plan controls the maximum permitted lifetime.
6. Start the selected seller with `merchant_tenderly_start`. It allocates
   the seller and operations listeners on the original loopback transport.
   Inspect the returned merchant URL and mode.
7. Retrieve the complete saved request packet with
   `merchant_tenderly_request` or `merchant_tenderly_file_read` using
   `kind: "request"`. Give the same packet and original prepared
   Node/Python customer interface to the buyer workflow described in the native
   guide. The packet preserves the operation ticket, request hash, exact body,
   customer identity, public merchant route and payment terms.

The EVM body always includes `block_number`, `transaction_index`,
`from`, `to`, complete hex `input`, `gas` and exact decimal-string
`value`. The saved merchant plan supplies the provider account/project,
network, simulation type and fixed save policy. The original compiler checks
the complete body against that plan before issuing a ticket.

`merchant_tenderly_start` is an explicit action. If its reply is lost,
read `merchant_tenderly_status` and continue the current seller.
`merchant_tenderly_stop` drains that seller and reopens the same operation
controller for review. Stop a running seller before selecting another profile.

## Review and recover a saved provider result

Use the original merchant operation key, provider simulation ID and current
generation. The provider read is the documented full saved-simulation
`POST /api/v1/account/{account}/project/{project}/simulations/{id}`
with no request body, through the existing provider-key environment reference.
See the [official endpoint](https://docs.tenderly.co/api-reference/simulator/get-full-simulated-transaction-details).

1. Read `merchant_tenderly_operation` for the selected profile and operation.
2. Call `merchant_tenderly_provider_lookup` with that same operation key
   and simulation ID. The response includes the original lookup ID, request
   comparison, current operation and retained observations.
3. Review `merchant_tenderly_provider_inspect`. A `MATCHED` observation
   has passed the original saved-result contract and request comparison,
   including simulation ID, network, block/position, EVM call and gas price.
   Retrieve the full observation bytes with `merchant_tenderly_file_read`,
   selecting `kind: "provider-response"`, the lookup ID and observation ID.
4. Use `merchant_tenderly_provider_recover` with the reviewed lookup ID,
   observation ID, original expected generation and provider reference.
   It applies those retained bytes through the original operation controller.
5. Read the original operation and `merchant_tenderly_result` again.
   Retrieve its complete original response with `kind: "response"` and
   the operation key. The response SHA256 should equal the chosen observation.

Repeating a lookup with its default `refresh: false` reopens retained
observations. `refresh: true` explicitly requests another provider read.
The original implementation retains errors and complete returned bytes, respects
an actual Retry-After, and leaves prior matched observations available for review.
A later rate-limit response does not replace a previously retained match.

After an interrupted recovery reply, repeat the same reviewed provider-recovery
command. Its original reconciliation identifies whether that command already
completed and reopens the retained original result.

For provider-confirmed outcomes available as a file, the original manual
`merchant_tenderly_recover` remains available: use `action: "complete"`,
the exact request hash/current generation and complete response status, headers
and canonical base64 body. For provider-confirmed retry use `action: "retry"`
and its provider reference. The native controller applies its original generation
and running-owner rules. Inspect the operation again after a lost manual reply.

## Complete response downloads

`merchant_tenderly_result` returns response metadata and a simulation
summary. File reads return the complete original bytes in base64 chunks:

```json
{
  "workspace": "evm",
  "profile": "RETURNED_PROFILE_ID",
  "kind": "response",
  "id": "ORIGINAL_OPERATION_KEY",
  "limit": 65536
}
```

The returned `file` contains the exact name, content type, total byte count and
SHA256. Continue with the returned `readId`, repeat
`expectedSha256: file.sha256`, and use `offset: nextOffset`.
The final chunk has `nextOffset: null` and closes its temporary read.
Verify the concatenated byte count and SHA256 before opening the file.

All chunks use the existing retained-file reader. A live read loads the original
file once and reads the same verified snapshot thereafter. The existing reader
uses private unlinked descriptors for larger files and releases them on completion,
explicit release, idle expiry or owner shutdown.

After idle expiry, workspace close or process restart, omit the old `readId`
and request the same original profile/kind/ID/observation, SHA256 and byte offset.
The original file is reopened and checked against that hash before continuing.
`merchant_tenderly_file_release` releases a temporary read while retaining
every original workspace file.

| File kind | `id` | `observationId` |
|---|---|---|
| `plan` | Omit | Omit |
| `request` | Original `r-…` request ID | Omit |
| `response` | Original operation key | Omit |
| `provider-response` | Original lookup ID | Original observation UUID |

## Histories and shared browser operation

| History | Tool | Continuation |
|---|---|---|
| Saved profiles | `merchant_tenderly_profiles` | `nextCursor` → `before` |
| Saved requests | `merchant_tenderly_requests` | `nextCursor` → `before` |
| Merchant operations | `merchant_tenderly_operations` | `nextCursor` → `cursor` |
| Operation audit | `merchant_tenderly_audit` | `nextAfter` → `after` |
| Saved-provider lookups | `merchant_tenderly_provider_lookups` | `nextCursor` → `before` |

Merchant operation states are the native `IN_FLIGHT`, `COMPLETE`,
`UNCERTAIN` and `RETRY_READY`. Audit positions are numeric sequence
values. Saved-profile/request/lookup cursors and operation cursors have different
native meanings; pass each returned continuation to its matching tool.

The browser link is live state owned by the current process. Browser actions and
agent mutations use the original model's serial queue and operation controller.
If the browser selects another profile, read the current state and select the
intended saved profile before continuing.

Close with `merchant_tenderly_close` and the current `instanceId`.
It finishes pending tool work, releases its temporary file reads, and drains its
one original browser/model/merchant. Opening the same declared alias later
reopens the saved workspace and returns a new process-owned browser instance.
