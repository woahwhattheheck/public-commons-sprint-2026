# Complete native MCP results

A durable MCP workspace keeps the useful product returned by a remote tool.
After a purchase, a host can read structured records, consume text or embedded
resources, export the complete result, and reopen it after a process restart.
The result remains attached to its original quote, exact invocation and receipt.

The existing launcher enables this when `MCP_STATE_DIR` is configured. It writes
under `MCP_STATE_DIR/results`, with a private directory and mode `0600` files:

| File | Content |
| --- | --- |
| `<quoteId>.json` | Complete JSON serialization of the SDK's native `CallToolResult` |
| `<quoteId>.meta.json` | Original quote identity, terms, completion, receipt and full result hash |

The JSON result preserves `content`, `structuredContent`, embedded data and
`_meta`, including the original `x402/payment-response`. Its representation is
`MCP_CALL_TOOL_RESULT_JSON`. It is limited to 2 MiB, matching the remote transport
limit. The separate status preview remains limited to 64 KiB. Resource links
remain links; the reader consumes the saved bytes without fetching their targets.

## Read from an MCP client

1. Call `bazaar_results` with optional `limit` (1–100) and opaque `cursor`. The
   result contains `results`, matching `total`, `nextCursor` and `durable`. Each
   row includes the original quote state, tool name, receipt and file metadata.
2. Call `bazaar_read_result` with its `quoteId`. Optional `byteOffset` and
   `maxBytes` (1–65536, default 32768) select a byte range.
3. Decode `data` from base64 and continue at `nextByteOffset` until it is `null`.
   The response includes the complete file's `bytes`, `sha256`, content type and
   representation. A complete single-range read also includes UTF-8 `text`.

Offsets count bytes, so concatenate decoded ranges before decoding UTF-8. The
reader verifies the complete file hash and uses a bounded cache for subsequent
ranges; a changed file identity, size, modification time or hash invalidates the
cached content. The result inbox lists saved metadata; reading performs the file
verification. `bazaar_history` retains failed captures and their partial-file
details alongside the original payment outcome.

## Read or export from the terminal

These commands open the original quote store read-only and can run while its
broker is active. Use an existing private parent for an export destination.

```sh
node stellar-forge/mcp-paid-agent/result-cli.mjs list \
  --state-dir /private/commerce/mcp-quotes

node stellar-forge/mcp-paid-agent/result-cli.mjs read \
  --state-dir /private/commerce/mcp-quotes --quote ORIGINAL_QUOTE_ID \
  --byte-offset 0 --max-bytes 32768

node stellar-forge/mcp-paid-agent/result-cli.mjs export \
  --state-dir /private/commerce/mcp-quotes --quote ORIGINAL_QUOTE_ID \
  --out /private/commerce/exports/tool-result.json
```

Export verifies the complete original file and creates the requested destination
once. Existing destinations remain intact. Its returned SHA-256 covers the full
exported native JSON, including the receipt and all native result fields.

## Use the original Node file API

`McpSavedResult` extends the original SF88 `VerifiedFile`. Its `json()`, `bytes()`,
`chunks()`, `verify()` and `saveAs()` methods consume the saved result. Streaming
consumers should finish the iterator before committing downstream side effects.

```js
import {join} from 'node:path';
import {SqliteQuoteStore} from './quote-store.mjs';
import {McpResultStore} from './result-store.mjs';

const quotes = new SqliteQuoteStore({directory: workspaceDirectory, readOnly:true});
const results = new McpResultStore({
  directory:join(quotes.directory, 'results'), readOnly:true,
});
try {
  const quote = quotes.load().find(value => value.quoteId === originalQuoteId);
  const file = results.file(quote);
  const nativeResult = await file.json();
  const records = nativeResult.structuredContent;
  // Consume the seller's actual structured data or native content items here.
  await file.saveAs(absoluteExportPath);
} finally {
  await results.close();
  quotes.close();
}
```

An embedding broker supplies `resultStore:new McpResultStore(...)` alongside its
existing `quoteStore`. The standard HTTP and stdio launchers already do this.
File paths come from trusted workspace configuration, never discovery or tool
arguments. The same SF31 create-only writer reserves the payload and manifest
before a merchant call; `saveBytes()` adds native byte capture to that writer.

## Recover a completion locally

If an interrupted final database update left an older quote snapshot, call
`bazaar_recover_result` with the original quote ID. The operation checks the
saved manifest against the original quote ID, endpoint, tool, typed arguments,
full payment terms, timestamps and operator binding. It verifies the full native
file and its retained preview and receipt, then saves the recorded completion
through the original quote store. An existing confirmed completion is preserved.

The equivalent terminal command acquires the workspace's existing single-writer
lock, so run it after the broker closes:

```sh
node stellar-forge/mcp-paid-agent/result-cli.mjs recover \
  --state-dir /private/commerce/mcp-quotes --quote ORIGINAL_QUOTE_ID
```

Recovery reads local files. It asks for no approval and calls no merchant, signer
or ledger. `CONFIRMED_BY_SERVER` remains the recorded seller receipt
classification. A result whose original payment remained `INDETERMINATE` keeps
that state. An incomplete payload remains available for operator inspection;
only a complete result matching its known metadata enters the saved inbox.

The payload and manifest have separate save outcomes. If the payload finishes
but its manifest fails, the payload is still usable and metadata records
`manifestStatus:SAVE_FAILED`. Recovery can rebuild a missing manifest from the
original completed quote and verified payload. The local writer owns a 30-second
save timeout; broker shutdown gives local capture its configured grace period.

## Attach a result retained by an older host

The host importer accepts a private absolute path containing the original full
native `CallToolResult`. The current quote's preview digest, native schema,
receipt and invocation must match it. Run this write command after the broker
closes:

```sh
node stellar-forge/mcp-paid-agent/result-cli.mjs import \
  --state-dir /private/commerce/mcp-quotes --quote ORIGINAL_QUOTE_ID \
  --source /private/commerce/original-call-tool-result.json
```

If the database itself contains an older dispatch snapshot, also provide the
original complete `bazaar_execute_approved` or `bazaar_status` result retained by
the host:

```sh
node stellar-forge/mcp-paid-agent/result-cli.mjs import \
  --state-dir /private/commerce/mcp-quotes --quote ORIGINAL_QUOTE_ID \
  --source /private/commerce/original-call-tool-result.json \
  --completion /private/commerce/original-broker-completion.json
```

The importer restores only mutable completion fields. Original terms and
invocation remain owned by the database, attempts cannot decrease, and a signed
dispatch cannot become unsigned. A legacy preview digest covers only its bounded
preview; the host supplies the original full result, and import records its
complete hash. This command never creates a new purchase.

## Failed settlement metadata

The complete native result also retains failed `x402/payment-response` receipts.
Compact quote metadata includes their failure code and detail as well as the
original hash, network and payer. Local recovery checks existing receipt fields
and restores additional failure details from the saved native result when an
older quote snapshot omitted them. It preserves an existing independent
transaction observation and never changes the original native file bytes.
Use [payment recovery](PAYMENT_RECOVERY.md) to inspect the original transaction
through Stellar from the same quote and console.

