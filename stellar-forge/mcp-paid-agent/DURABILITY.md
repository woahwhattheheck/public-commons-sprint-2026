# Durable MCP operator workspace

The original MCP buyer keeps its quotes, execution checkpoints and merchant
receipt metadata after a process restart. The same search, describe, preview
and independently approved execution tools remain in use. No payment engine
or operator budget ledger is replaced.

## Run the existing server with persistent state

Use Node **22.13+ or 24** on a local POSIX filesystem. Built-in SQLite requires
no package installation. The workspace's parent must already exist; the launcher
creates the final directory with mode `0700`. Existing storage must belong to
the current user and use `0700` for the directory and `0600` for files.

```sh
export BAZAAR_DISCOVERY_URL=https://your-trusted-catalog.example
export PAID_RESOURCE_ORIGINS=https://your-approved-seller.example
export MCP_STATE_DIR=/private/commerce/mcp-quotes
# Keep the existing MCP_ACCESS_TOKEN in the operator environment.
node stellar-forge/mcp-paid-agent/serve.mjs
```

This configuration enables discovery, previews and persistent history. To connect
the operator's existing approval and native x402 signer, also set
`MCP_OPERATOR_MODULE` to its **absolute local module path**. That module must
export `approve(quote)` and `signPayment(context)`. It may export the existing
`agentCommerce(args)` SF43 adapter and a `close()` cleanup function. Connecting
a module requires persistent state; a missing function stops startup.

Use the original independent approval/reservation and exact native signer. The
quote ID is the stable operation identifier for adapter correlation; retain the
operator's existing ledger. Configuring the adapter does not approve a quote.
Module paths, callbacks, keys, discovery settings and allowed origins come only
from trusted host configuration. The module executes as trusted host code and
cannot be selected through MCP, a catalog, or a model response.

The listener remains `127.0.0.1`, with the existing bearer-token, MCP protocol and
Origin checks. Default port is 3210; `MCP_PORT=0` chooses an available local port.
SIGINT/SIGTERM stop new execution, cancel undispatched work, record uncertainty
for a dispatched request, abort HTTP work and close storage. Approval and signer
callbacks receive an optional shutdown `signal`; they should honor it. Even if
they ignore it, the broker cannot newly dispatch their result after shutdown.
The injected SF43 adapter retains its own ledger/cancellation behavior and its
trusted module is responsible for closing its own resources.

## Restart behavior

Every transition commits a quote snapshot and a checkpoint record together.
Checkpoints precede the approval callback, unsigned probe, signer and signed
dispatch. Storage failure prevents the next side effect. The dispatch marker is
committed **before** the request: a crash in that small interval records that the
seller may have received it, even if the process never reached the network call.

| Saved state | Behavior after restart |
| --- | --- |
| Unexpired preview, same discovery/origin configuration | A new explicit execute call may ask the original approval callback again |
| Expired preview | `EXPIRED`; no execution |
| Preview with changed discovery/origin configuration | `CONFIG_CHANGED`; search and review current terms |
| Interrupted approval/execution before a dispatch marker | `INTERRUPTED`; inspect the original approval/reservation before another operation |
| Interrupted execution with a dispatch marker | `INDETERMINATE`; retain and reconcile the original operation |
| Completed, rejected, cancelled or indeterminate quote | Original status remains inspectable; execute never submits it again |

Recovery makes no merchant request, asks for no approval, signs nothing, releases
no reservation and creates no chain result. `CONFIRMED_BY_SERVER` remains the
original seller-reported receipt classification. Independent original SF82/SF86
verification is still required to establish a transfer. Changing a saved quote ID
does not recover an existing reservation.

Discovery handles remain ephemeral. Quote IDs and terms persist. Even adding an
allowed origin changes the configuration binding and invalidates saved previews.
Changing an operator module does not reuse an approval: the callback runs anew
for every surviving preview.

## Inspect through MCP or the terminal

The new `bazaar_history` tool accepts optional exact `status`, `limit` (1–100,
default 25) and opaque `cursor`. It returns detached statuses, matching `total`,
`nextCursor` and `durable`. Immutable creation time and quote ID determine page
order, so status updates do not move a record between pages. `bazaar_status`
continues to retrieve one quote ID.

Read-only CLI inspection works while the broker runs or after it exits:

```sh
node stellar-forge/mcp-paid-agent/history.mjs \
  --state-dir /private/commerce/mcp-quotes --status INDETERMINATE

node stellar-forge/mcp-paid-agent/history.mjs \
  --state-dir /private/commerce/mcp-quotes --quote ORIGINAL_QUOTE_ID

node stellar-forge/mcp-paid-agent/history.mjs \
  --state-dir /private/commerce/mcp-quotes --format html \
  --out /private/commerce/quote-workspace.html
```

Formats are `json`, `csv` and `html`. Files are created once with mode `0600`
under an existing private parent. The offline HTML shows original terms,
timestamps and recovery status in a restrained table; it contains no scripts or
external assets. CSV quotes cells and neutralizes spreadsheet formula prefixes.
A single-quote export includes its most recent 100 checkpoints. A paginated
export retains the next cursor rather than presenting its first page as complete.

## Embedding and storage ownership

```js
import { SqliteQuoteStore } from './quote-store.mjs';
import { McpPaidToolBroker } from './agent-server.mjs';

const quoteStore = new SqliteQuoteStore({ directory: '/private/commerce/mcp-quotes' });
const broker = new McpPaidToolBroker({
  discoveryUrl: trustedCatalogURL,
  allowedResourceOrigins: independentlyApprovedOrigins,
  quoteStore,
  approve: existingOperatorApproval,
  signPayment: existingNativeSigner,
});
// Serve the original createMcpHttpHandler as before.
await broker.close(); // closes the owned store; concurrent callers await it
```

One writer owns the workspace through an exclusive SQLite transaction in a
separate `writer.sqlite` file. Data commits use `quotes.sqlite` with WAL and
`synchronous=FULL`. A competing broker gets `QUOTE_WORKSPACE_IN_USE`. The OS
releases the writer lock on process death, so there is no PID guessing, timed
takeover or lock-file deletion. Read-only history does not acquire that lock.
Do not use a network share, delete a live writer file, or copy a running database
without its WAL. Failed broker construction also closes an accepted store.

Snapshots contain original terms and bounded receipt metadata. Signer payloads,
credentials and response bodies are not stored. A text response is represented
on disk by content type, byte length, SHA-256 and truncation flag; after restart,
`content.omitted:true` replaces its body. The digest describes the broker's
bounded decoded text, not raw network bytes. Use original SF31/SF88 file delivery
when the returned resource itself must be kept.

Default capacity is 10,000 quotes with at most 256 KiB per snapshot. A full store
rejects another preview and preserves all earlier operations. This is local
process-recovery storage, not a distributed coordinator or a tamper-proof external
ledger. It cannot detect an operator rolling the entire directory back to an old
backup. Keep this workspace alongside the original approval ledger, and reuse
both when restarting.

## Focused exercise

`node stellar-forge/mcp-paid-agent/durable-acceptance.mjs` uses the original Bazaar
HTTP catalog and original broker with real SQLite and child-process interruption
at signed dispatch. It covers restart behavior, writer ownership, current-origin
invalidation, metadata export and a failing-persistence shutdown. Its explicit
loopback signer/receipt fixtures test application behavior, not a Stellar transfer.
It does not require repository suites, a wallet or GitHub Actions.

References: [Node 22.13 SQLite](https://nodejs.org/download/release/v22.13.0/docs/api/sqlite.html),
[SQLite transactions](https://www.sqlite.org/lang_transaction.html),
[WAL](https://www.sqlite.org/wal.html).
