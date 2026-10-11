# Launch Stellar Forge from a local MCP client

The maintained buyer workspace can run as a subprocess of a desktop client,
editor or agent host. The host starts `stdio.mjs`; its tools use the original
Bazaar broker, HTTP dispatcher, operator adapter and SQLite quote history.
The client sees the same discovery, description, preview, execution, status,
history and cancellation tools as the HTTP workspace.

Use Node 22.13+ or Node 24 and the complete source checkout or maintained
Starforge package. The transport uses Node's standard library. Native payment
dependencies belong to the existing configured operator module.

## Prepare the client registration

Run the generator **on the machine that will launch the MCP process**, so its
absolute Node and entry paths point to that machine's installed source:

```sh
node stellar-forge/mcp-paid-agent/client-config.mjs \
  --discovery https://catalog.example/stellar \
  --state /absolute/private/starforge-buyer \
  --origin https://merchant.example \
  --output /absolute/private/starforge-mcp.json
```

Replace the illustrative URLs with the existing catalog base and the merchant
origins selected by the operator. A catalog deployment prefix is preserved.
Repeat `--origin` for each allowed merchant. Create the private parent directory
before the first launch; the original quote store creates its own state directory
with mode `0700` and requires files with mode `0600`.

The generated registration uses the standard local-client shape:

```json
{
  "mcpServers": {
    "stellar-forge": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/source/stellar-forge/mcp-paid-agent/stdio.mjs"],
      "env": {
        "BAZAAR_DISCOVERY_URL": "https://catalog.example/stellar",
        "MCP_STATE_DIR": "/absolute/private/starforge-buyer",
        "PAID_RESOURCE_ORIGINS": "https://merchant.example",
        "MCP_OPERATOR_MODULE": ""
      }
    }
  }
}
```

Add this registration to the host's existing MCP configuration. For a host that
uses a JSON `mcpServers` object, the generator can prepare the combined file:

```sh
node stellar-forge/mcp-paid-agent/client-config.mjs \
  --discovery https://catalog.example/stellar \
  --state /absolute/private/starforge-buyer \
  --origin https://merchant.example \
  --merge /absolute/client/existing-config.json \
  --output /absolute/private/reviewed-client-config.json
```

The separate output retains all existing settings and registrations. The command
requires an unused server name, creates the output once with mode `0600`, and
prints only its path. Set `--name` to choose another registration. Restart or
reload the host's MCP connections after applying the combined configuration.

The generator copies only the listed workspace configuration. The stdio process
creates its own ephemeral loopback port and internal bearer; those transport
details are managed by the process. Desktop hosts receive the subprocess's MCP
messages on stdout and operational diagnostics on stderr.

## Use the existing buyer workflow

1. Call `bazaar_search` with the required resource query.
2. Inspect `bazaar_describe` for the original inputs and full payment choices.
3. Call `bazaar_preview` with the chosen handle, payment option and query input.
4. Use the existing operator approval and signing adapter for
   `bazaar_execute_approved`.
5. Read `bazaar_status` or `bazaar_history` to continue the original operation.

The existing buyer's supported methods, origins and payment rules apply equally
to HTTP and stdio. The fixed tool list and response content come directly from
the maintained HTTP dispatcher, including additions by its original owners.

To connect an already configured operator module, add its absolute path:

```sh
node stellar-forge/mcp-paid-agent/client-config.mjs \
  --discovery https://catalog.example/stellar \
  --state /absolute/private/starforge-buyer \
  --origin https://merchant.example \
  --operator /absolute/private/operator.mjs \
  --output /absolute/private/starforge-approved-client.json
```

The module uses the original `approve`, `signPayment`, optional `agentCommerce`
and optional `close` exports documented in [DURABILITY.md](DURABILITY.md).
Approval remains attached to each original quote. Loading the module selects the
operator integration; the original broker decides when its hooks may run.
Trusted module logging should use `console` or stderr. The CLI routes ordinary
console output to stderr for the lifetime of the connection.

For the maintained native Stellar buyer, first follow
[NATIVE_WORKSPACE.md](NATIVE_WORKSPACE.md) to initialize the adapter around the
existing operator workspace. Pass its generated `operator.mjs` to `--operator`
and use the discovery URL, origin and quote directory printed by that command.
The native workflow uses `sf43_discover_review_and_pay` with its original
`prepare`, `execute`, inspection and recovery actions. The same intent and saved
inbox survive client reconnection. Native execution uses the existing terminal
approval path; launch the host where that controlling terminal is available.

## Restart, concurrent calls and cancellation

Keep the same `MCP_STATE_DIR` when restarting one host. The original SQLite
workspace retains quotes and payment state, including interrupted operations.
The original store allows one writer per workspace. Independently running host
processes should each use their own state directory.

Requests can proceed concurrently, so a client can inspect or cancel an operation
while another request awaits operator approval. Responses retain the exact
original JSON-RPC request IDs. The default is 32 simultaneous calls; the
programmatic API can set `maxConcurrent` from 1 to 256.

An MCP `notifications/cancelled` for `bazaar_execute_approved` invokes the original
broker's quote cancellation for that active request. Its original signed-dispatch
state determines recovery. The notification itself has no response. For other
requests the transport stops waiting for the local response while the maintained
workspace governs its accepted work. A host closing stdin, sending `SIGINT` or
`SIGTERM`, or disconnecting stdout closes the original workspace and operator.

Only complete newline-delimited UTF-8 JSON messages are accepted. Framing uses
the existing HTTP request size of 128 KiB, handles split multibyte characters and
drains an oversized line before reading the next message. Output writes observe
backpressure. One request creates one local HTTP dispatch, with its original
result or error returned to the host.

## Embed the same transport with another original workspace

```js
import { startMcpStdio } from './stdio.mjs';

const connection = await startMcpStdio({
  environment: process.env,
  startWorkspace: async ({ environment }) => {
    const original = await startExistingWorkspace({ environment });
    return { address: original.url, close: () => original.close() };
  }
});
await connection.closed;
```

The factory receives `MCP_ACCESS_TOKEN`, `MCP_PORT=0` and an empty
`MCP_CLIENT_ORIGINS` for this private connection. It must bind `127.0.0.1`, honor
that token, and return its HTTP address and lifecycle method. An optional trusted
`cancelRequest(rpc, workspace)` callback can apply that product's existing
cancellation semantics. The merchant operator's own stdio entry uses this same
transport and its original source, release and owned-server lifecycle.

## Protocol references

This adapter negotiates the original dispatcher version `2025-11-25`. The
implementation follows the official [stdio framing and transport rules](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
and [initialization, version negotiation and shutdown lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).
The configuration shape follows the official [local MCP client guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers).
