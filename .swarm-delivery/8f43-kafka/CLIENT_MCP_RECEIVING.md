# Kafka client and merchant MCP customer receiving

This phase operates the complete typed Node client, its CLI, the Kafka merchant MCP provider and the remote file downloader against the Kafka customer's existing managed console. It belongs to the original operation `SCF-KAFKA-MERCHANT-8F43-20261012` and uses its captured source, imported workspace and saved dataset editions.

## Run inside the original customer phase

The original customer caller starts and owns the Kafka console. Invoke this phase after that caller's browser child completes and before its existing server shutdown. The caller supplies the same `browser-input.json` and receipt directory it already retained.

```sh
node client-mcp-receiving.mjs \
  --input "$CUSTOMER_ROOT/browser-input.json" \
  --receipts "$CUSTOMER_ROOT/receipts" \
  --product-root "$REPOSITORY_SOURCE_ROOT" \
  --out "$CUSTOMER_ROOT/client-mcp"
```

Use the original selected Node executable. The product source root must contain both `stellar/scf-starforge-20261009` and `stellar-forge/mcp-merchant-operator`, including the complete joined source-owned merchant provider and its maintained imports. The original customer source inventory remains the native Kafka authority; the enclosing continuation binds the additional consumer source inventory before dispatch.

The reviewed client source is [49bdf3ac](https://github.com/woahwhattheheck/public-commons-sprint-2026/commit/49bdf3acba6ac4de762e82249997e106b5c2c6ec). Its runtime blobs are:

| File | Git blob |
|---|---|
| client-protocol.mjs | ce83cd9ca6a59f7591fbe154ff791fb57ee5fe5e |
| client.mjs | 78bcd5df1369cb37c75449a5deb7ed7ec8ef567d |
| client-cli.mjs | ed0112608200d3b5dd4f42380933808b44ebcfe1 |

The complete merchant source includes its metadata, tools, provider, setup and downloader modules. The downloader uses the original retained-download engine and the merchant manifest's exact byte envelope. The maintained merchant factory must retain its current retryable close behavior; the full current `serve.mjs` and `operator.mjs` postimages carry the console and lifecycle interfaces together.

## Customer flow

The receiving phase first authenticates the original Kafka console and binds its workspace UUID, source digest and original customer path. It consumes the actual saved connection, broker inspection, two completed captures, selected message, projections, mapping plans, builds, queries and comparison from the original receipts. Repeated source operations use those same saved operation IDs and requests.

The Node client then navigates the source history, reads complete message data with its exact numeric JSON text, reopens the original dataset operations, exports every file mode and receives the existing Kafka, native NDJSON and original source inputs. Its CLI runs the actual inspection, complete-record download, complete-query download and local file-inspection commands.

The merchant phase uses the product's own initialization function and maintained MCP factory. Its host configuration declares the original Kafka workspace and three exact input files. All 26 Kafka tools are called through the original authenticated merchant file client. Complete files retain their original selection and SHA-256, and repeating an export operation reopens that same fixed file.

The remote receiver pauses after a durable nonfinal archive chunk. The same MCP factory then closes and reopens on its retained listener port. The downloader resumes the same directory and checkpoint, verifies the full original archive and manifest, reopens the completed local transfer, and receives the full raw message. The downloader's actual CLI performs the final local verification.

After both consumers close, the phase reconnects to the original Kafka console and verifies the same process, capture and query. This keeps the original customer's managed lifecycle intact through client shutdown.

## Retained output and continuation

The primary result is `CUSTOMER_ROOT/client-mcp/result.json`:

- Schema: `stellar-forge.kafka-client-mcp-receiving.v1`
- Operation: `SCF-KAFKA-MERCHANT-8F43-20261012`
- Successful status: `COMPLETED`
- Source and workspace binding, actual tool counts, complete file identities, CLI results and resumed remote transfer are included.

The same directory also retains the immutable input selection, operating journal, direct downloads, merchant configuration, export store and complete remote receiving directories. Resume by supplying the same original four paths while the original customer console is available. Fixed files are inspected in place, saved native operations reopen by their original identities, and the retained MCP port keeps the remote endpoint identity stable.

The original output lease remains held through consumer shutdown and final publication. A rejected close is retried on the same native consumer with pacing; the first failure and source operation remain retained. SIGINT and SIGTERM handlers stay installed through that drain and preserve exit 130 or 143. The enclosing native operation should forward signals to this child and wait for its actual exit so the original console can perform its own final shutdown.

The result is published after the client and MCP consumers have drained, while output ownership is still held. The output lease releases last.
