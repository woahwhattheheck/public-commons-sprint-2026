# Use the merchant operator from a local MCP client

Connect an MCP host to the original Starforge merchant release operator as a
subprocess. The client receives the same twelve tools for source inspection,
staging, comparison, activation, seller startup, customer SDK export, rollback
and shutdown. The existing release store holds every version and selection;
the existing operator owns the seller it starts.

The subprocess uses the shared [MCP stdio transport](../mcp-paid-agent/stdio.mjs)
and starts the original [merchant factory](./serve.mjs) in one
[owned child](./merchant-host.mjs). Each request reaches the existing authenticated
HTTP handler through a private ephemeral loopback listener. The transport
generates its bearer internally and receives the child address through local IPC.
Standard output contains one complete JSON-RPC message per line. Both child
output streams go to standard error, including the original SF61 compiler's
direct stdout writes and trusted application diagnostics.

## Prepare the existing merchant

Use Node 22+ on the host that will run the merchant and keep the complete
installed Starforge source available. Follow the original
[merchant preparation guide](./README.md). For existing OpenAPI inputs:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs init \
  --dir /private/my-merchant \
  --spec /private/api/openapi.json \
  --selections /private/api/selections.json \
  --bindings /private/api/bindings.json \
  --name "My merchant" --seller-port 0
```

The resulting `merchant-mcp.json` fixes the private release store, customer
export directory, approved source aliases and runtime configuration. Existing
trusted handlers, upstream bindings and facilitator settings continue to use
the formats supported by the installed original merchant. MCP callers select
those aliases when preparing a release.

Keep backend credential values in the host's existing environment. The
registration below exports only the chosen merchant configuration path.

## Generate the host registration

Run this command on the machine that will launch the subprocess:

```sh
node stellar-forge/mcp-merchant-operator/client-config.mjs \
  --config /private/my-merchant/merchant-mcp.json \
  --name starforge-merchant \
  --output /private/starforge-merchant-host.json
```

The original merchant reader checks the selected configuration, release store
and export directory. The generator then creates a new private JSON file with
the actual absolute Node executable and installed entry path. Its shape is:

```json
{
  "mcpServers": {
    "starforge-merchant": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/stellar-forge/mcp-merchant-operator/stdio.mjs"
      ],
      "env": {
        "MCP_MERCHANT_CONFIG": "/private/my-merchant/merchant-mcp.json"
      }
    }
  }
}
```

Use the generated paths with the MCP host's subprocess configuration. To
compose with an existing host file, add `--merge` and select a different output:

```sh
node stellar-forge/mcp-merchant-operator/client-config.mjs \
  --config /private/my-merchant/merchant-mcp.json \
  --name starforge-merchant \
  --merge /private/current-host.json \
  --output /private/combined-host.json
```

All existing settings and servers are retained. An existing registration with
the selected name is reported as a conflict; choose an unused name. New output
files use mode `0600`, and an existing output is preserved. Merged configurations
are written to the selected private file because they can contain the host's
other service credentials.

A host can also launch the entry directly:

```sh
node stellar-forge/mcp-merchant-operator/stdio.mjs \
  --config /private/my-merchant/merchant-mcp.json
```

Alternatively set the absolute path in `MCP_MERCHANT_CONFIG` and launch the entry
without arguments. The MCP host supplies standard input and reads standard
output. Prepare registration again after moving the installed source or Node
executable so the command resolves to their actual new paths.

## Complete the merchant workflow

The host initializes MCP, sends `notifications/initialized`, and lists tools.
Use the original tool schemas and returned values throughout the session:

1. Call `merchant_sources` for the configured alias, then `merchant_stage` with
   that alias and a new release ID. Inspect the exact digest and compare its
   routes and payment choices with the current selection.
2. Activate the reviewed release using its returned digest and current selection
   generation. Start that selection with `merchant_start`. Its returned operator
   instance ID identifies the seller owned by this subprocess.
3. Inspect actual seller metadata with `merchant_catalog`, and create a new
   named customer package with `merchant_client_export`. The package uses the
   original SDK exporter and original seller metadata.
4. Stage and review a later release, select it with the current generation, and
   restart the owned instance. Rollback selects an exact retained release through
   the same original history; restart applies that selection to the seller.
5. Call `merchant_stop`, or close the MCP subprocess. Closing waits for its
   accepted mutation and then drains the seller owned by that process.

The exact argument and result details remain in the
[original merchant tool guide](./README.md#complete-operator-workflow).

## Cancellation, reconnect and shutdown

An MCP cancellation stops this transport's wait for that request. A merchant
change already admitted by the original operator continues under its existing
release and instance tracking. Reconnect and inspect `merchant_status`, the
specific release and current generation before deciding how to continue an
interrupted stage, activation, export or restart. Completed release versions,
selection history and customer exports remain in the existing private store.

Closing standard input, a broken output stream, SIGINT or SIGTERM starts the
same graceful shutdown. The owned child finishes the original operator's
admitted change and drains its seller. Startup signals are retained while the
original factory opens so shutdown can complete as soon as that instance is
available. Parent IPC disconnection also drains the child; unexpected child exit
closes the MCP connection.

Each subprocess has its own initialization state and request IDs. Duplicate
active IDs are rejected. The shared transport handles UTF-8 across stream
chunks, output backpressure, cancellation and its configured concurrency limit.
The original merchant remains the authority for source aliases, generation
conflicts, instance ownership and release recovery.

## Embed and package

`startMerchantMcpStdio({configPath, environment, input, output, maxConcurrent,
diagnostic})` returns the shared transport's `close` function and `closed`
promise. The configuration path must be absolute. `durable` is true because the
original merchant release store is retained; readiness and the active release
are read through the original merchant tools.

`createMerchantMcpClientConfiguration({configPath, name, nodePath, entryPath,
existingConfiguration})` is the pure registration builder. The CLI adds the
original configuration-read check and private create-only output. Keep
`stdio.mjs`, `merchant-host.mjs`, `client-config.mjs` and this guide alongside the
original merchant component, plus the shared paid-agent stdio module and its
existing import closure. This is the same source layout used by the cumulative
distribution.
