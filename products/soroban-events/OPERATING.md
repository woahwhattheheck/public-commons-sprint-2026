# Soroban event operations

Capture native Stellar contract events, turn a completed ledger interval into an immutable edition, and deliver that edition through the original Starforge event-feed merchant and Buyer. The same retained workspace is available in the operator browser, the command line and merchant tools.

## Install the selected product

Build from the source commit that contains the complete Soroban contribution. The source selection keeps the native event collector, merchant runtime, paid feed, Buyer and Applications together.

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/source-checkout \
  --ref ORIGINAL_SOURCE_COMMIT \
  --selection soroban-event-operations \
  --out /absolute/soroban-package
```

Use the resulting archive and its SHA-256 with the original runtime installer. Node 24 provides the native SQLite support used by the existing event-feed store. Keep the selected runtime and its source archive together.

```sh
starforge runtime-install prepare \
  --dir /private/soroban-runtime \
  --archive /absolute/original-package.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator
starforge runtime-install install --dir /private/soroban-runtime
starforge runtime-install inspect --dir /private/soroban-runtime --load --source
```

The archive path, archive hash and source commit in these commands come from the original package output. Use the resulting READY runtime in the existing Runtime workspace. The selected commands include `soroban-events`, `soroban-events-workspace`, `soroban-events-publish`, `merchant-soroban-events`, `webhook-feed` and `buyer-event-feed`.

## Configure the native connection

Keep one connection JSON file on the host. The public Stellar testnet example is:

```json
{
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "network": "stellar:testnet"
}
```

Use `stellar:pubnet` with the actual mainnet RPC endpoint for mainnet work. The collector checks the live `getNetwork` passphrase against the selected network. Optional `headers` belong in this private host file. Explicit local development connections can use `allowHttp: true` with a loopback HTTP endpoint.

The distributed example is `sf30-seller-sdk/soroban-events/examples/testnet-connection.json`. Copy it to a private location before configuring provider-specific headers. The source edition carries the native network identity and original RPC request/response records.

## Open and operate the workspace

In **Applications**, select **Soroban contract events**, choose the private event workspace and connection file, review the selected runtime and inputs, then save and start it. Open the returned private operator URL. A saved application binds the original workspace ID and selected runtime source, so restarting keeps the same plans, captures and editions.

The standalone command uses the same server:

```sh
starforge soroban-events-workspace \
  --workspace /private/soroban-events \
  --connection-file /private/stellar-rpc.json \
  --startup-format json --port 0
```

The process prints its complete startup record and private browser URL. The URL includes the local session token. When viewing a received source without making RPC requests, leave the connection file empty.

### Save the selection

A plan contains its name, ledger bounds, page size and native event filters. `startLedger` is inclusive and `endLedger` is exclusive. Omitting both bounds captures the latest ledger observed when capture starts. For a historical interval, set both bounds within the provider's actual retained history.

The example `examples/contract-events-plan.json` selects all contract events in the latest observed ledger. Add actual contract IDs or topic filters for a specific contract. Topic values remain base64 XDR; the supported `*` and terminal `**` patterns pass through to the native RPC query. The browser exposes these fields directly.

Saving a plan creates a version. Starting a capture freezes that version and its ledger interval. Later edits to the plan apply to later captures.

### Capture and recover

Start the selected plan, then inspect its capture status and original event pages. The engine records each complete RPC exchange before advancing its cursor. Its current capture state includes the request ID, page list, original cursor, ledger frontier and any provider error.

A completed range has status `COMPLETE`. A provider interruption leaves the selected capture available for resume. Resume uses its saved cursor and keeps the original ledger interval. The initial request supplies ledger bounds; paginated requests omit those bounds and use the provider cursor. Sparse or empty pages continue until the native cursor establishes the end of the selected interval.

Command-line operators can use:

| Command | Original selection |
| --- | --- |
| `state` | All plans, captures, editions, exports and current workspace revision |
| `plan-save --input PLAN_JSON` | New plan, or a new version of the plan identified in its input |
| `capture-start --plan PLAN_ID` | Current saved plan version |
| `capture-resume --capture CAPTURE_ID` | Existing capture and native cursor |
| `capture-status --capture CAPTURE_ID` | Original capture progress and provider error |
| `events --capture CAPTURE_ID --limit 100` | Retained event page; use `--after EVENT_ID` for the next page |
| `edition-create --capture CAPTURE_ID --name LABEL` | Completed source capture |
| `edition --edition EDITION_ID` | Original edition metadata |
| `publisher-source --edition EDITION_ID` | Complete event-array file, byte count and SHA-256 |
| `export --edition EDITION_ID` | Full source edition and manifest |
| `receive --source-directory DIRECTORY --manifest-sha256 SHA256` | Complete original exported source |

Every command takes `--workspace /private/soroban-events`. Capture commands also take `--connection-file /private/stellar-rpc.json`. Changes take `--request ID --revision N`; use the current revision returned by `state` or the preceding result. Reusing the identical request arguments recovers its retained result. To continue an interrupted capture, use `capture-resume` with a new request ID.

## Publish and deliver

Create a named edition after the selected capture completes. The edition's full `events.json` retains every original event field, topic and value. Its metadata records the selected network, plan version, ledger bounds, complete event count and the final source page.

`soroban-events-publish` connects this edition to the original SF30 webhook-feed engine. The publisher uses a stable workspace/network/plan namespace and original event IDs. Overlapping capture windows therefore reuse existing events in that feed, while each source edition remains separately retained. The original event-feed store owns paid pages, event sequences, duplicate handling and customer cursors.

Use the publication CLI's `help` command for its prepare, append, merchant release, run and original Buyer commands. Supply the actual merchant payment configuration and public origin used by the existing merchant installation. Its generated release uses the original native merchant, and the customer uses the original `buyer-event-feed` subscription.

```sh
starforge buyer-event-feed init \
  --dir /private/event-subscription \
  --config /private/original-buyer.json \
  --feed ORIGINAL_FEED_ID --id CUSTOMER_SUBSCRIPTION \
  --runtime /private/original-buyer-runtime \
  --buyer-state /private/original-buyer-state --page-size 100
starforge buyer-event-feed sync --dir /private/event-subscription
starforge buyer-event-feed inspect --dir /private/event-subscription --limit 20
starforge buyer-event-feed export \
  --dir /private/event-subscription --out /private/received-events.ndjson
```

The Buyer configuration selects the actual paid endpoint and payment runtime. Its retained subscription owns collection, recovery and export cursors. Use `buyer-event-feed recover` for that original subscription when its payment or delivery state needs continuation.

## Transfer the complete source

Export the edition from the event workspace. The output identifies its original export directory and manifest SHA-256. Keep the entire directory: `manifest.json`, `source.json`, the complete native RPC exchanges and the edition's complete event file. The browser can save the full source folder or ZIP.

Receive that directory into a separate private workspace using the selected manifest hash. Receiving checks file membership, sizes, hashes, original request parameters, the cursor chain, the event projection and the final range-completion source before installing the original plan, capture and edition. The receiving workspace has its own workspace identity and can be opened, reviewed and edited independently.

Merchant tools use the same engine. Host configuration maps named workspaces and permitted receiving destinations; the typed client supplies full JSON reads and retained-file downloads. Follow [CLIENT.md](../../stellar-forge/mcp-merchant-operator/soroban-events/CLIENT.md) for setup, tool inputs, resumable downloads and receiver aliases.

## What the retained source establishes

The source connects the delivered event edition to the actual network response, saved contract/topic selection, selected ledger interval and complete original RPC pages. The receiver can reopen that work after the provider's online history has moved on. The paid subscription separately records its original merchant pages and customer delivery progress.

For the SCF walkthrough, use this complete path: original installed source, managed application launch, actual network capture, saved edition, original merchant release, original Buyer collection, and received source reopened in a second workspace. Keep the original operation directories so capture recovery and customer recovery continue from the demonstrated state.

## References

- [Current Stellar RPC event API](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents)
- [Network identity API](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getNetwork)
- [RPC health and retained ledger range](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getHealth)
- [Native scan cursor implementation](https://github.com/stellar/stellar-rpc/blob/main/cmd/stellar-rpc/internal/methods/get_events.go)
- [Source module guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/soroban-events/README.md)
