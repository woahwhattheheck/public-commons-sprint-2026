# Soroban event operations

Capture native Stellar contract events, turn a completed ledger interval into an immutable edition, and deliver that edition through the original Starforge event-feed merchant and Buyer. The same retained workspace is available in the operator browser, the command line and merchant tools. Recurring services extend that workflow across successive ledger ranges and host restarts.

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

The archive path, archive hash and source commit in these commands come from the original package output. Use the resulting READY runtime in the existing Runtime workspace. The selected commands include `soroban-events`, `soroban-events-workspace`, `soroban-events-publish`, `soroban-events-watch`, `merchant-soroban-events`, `webhook-feed` and `buyer-event-feed`.

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

## Operate a recurring service

A recurring service follows one saved plan version through successive native ledger ranges. Its controls keep a durable next-ledger boundary, an active capture and its original child requests, the completed source editions, and the original event-feed publication. The browser, foreground CLI and Merchant tools open the same service state.

### Choose source connections

The existing connection file provides the `default` alias. A second private JSON file can provide named connections:

```json
{
  "testnet": {
    "rpcUrl": "https://soroban-testnet.stellar.org",
    "network": "stellar:testnet"
  }
}
```

Pass this file with `--connections-file`, or select **Named private RPC connections** in the saved Application. The included `examples/named-testnet-connections.json` is the same public testnet configuration. Add the actual archive provider's native connection and any required private headers to this host file when an archive is available. Service controls select its alias.

```sh
starforge soroban-events-workspace \
  --workspace /private/soroban-events \
  --connections-file /private/stellar-connections.json \
  --startup-format json --port 0
```

The operator process runs saved active services after launch. Closing the browser leaves that process running. **Pause after current range** saves a short control change while collection continues, then pauses at the completed range boundary. Stopping the managed Application aborts its runner and drains the original workspace; reopening resumes the saved active service from its retained capture and next ledger.

### Save and start in Services

Open **Services** and choose **New service**. Select the saved event plan and its version, the first ledger or current network tip, the maximum ledgers per range, and a refresh interval. Leave the final exclusive ledger empty to follow the network. A final ledger turns the service into a persistent historical backfill that finishes when it reaches that boundary.

Select the source connection and an optional archive connection. A publication folder enables append into the original paid event-feed engine. Leaving it empty retains native source editions for later review or publication. Publication uses the service's original source/workspace/network/plan namespace, including after receiving onto another host.

Save the service, then start it. The service view shows its desired operation, native next ledger, active capture step, complete ranges, saved plan version and source origin. Open any active or completed capture in the original Captures view. Its full native exchanges and original event data remain available there.

Settings changes keep the current capture's saved selection. The new plan version, end boundary, range size, polling interval or selected connections apply through the service's original control and recovery state. Each window uses its own explicit capture selection; the service does not rewrite the saved event plan to move its ledger range.

### Headless operation

Use the independent service revision returned by `soroban-events-watch state`. It is separate from the native event workspace revision used for plan and capture changes.

| Command | Behavior |
| --- | --- |
| `state` | List services, current service-control revision, named connections and retained exports |
| `save --input JSON --request ID --revision N` | Save a service against an existing plan/version |
| `configure --watch UUID --input JSON --request ID --revision N` | Save changes for the same service |
| `status --watch UUID` | Inspect its active capture, next ledger, ranges and publication |
| `start --watch UUID --request ID --revision N` | Save RUNNING intent and run the original service in the foreground |
| `daemon` | Run all already-active services from their existing saved state |
| `daemon --watch UUID` | Run one selected already-active service |
| `pause --watch UUID --request ID --revision N` | Save PAUSED after stopping the foreground host; use Services or Merchant to pause an active managed host |
| `catch-up --watch UUID --max-windows N` | Continue selected native windows through the same saved operation |
| `repair --watch UUID --input JSON --request ID --revision N` | Select complete retained editions or a compatible archive alias |
| `export --watch UUID --request ID --revision N` | Create a complete private service bundle |
| `receive --source-directory ABS --request ID --revision N` | Receive a complete bundle into this event workspace, paused |
| `source-file --export SHA --path RELATIVE --output NEW_FILE` | Read one complete original file from a retained service export |

Every command takes `--workspace`; source collection also uses `--connection-file` and/or `--connections-file`. A saved service input has the following shape. Replace the plan identity with the UUID returned by the existing plan operation; choose actual ledger bounds when backfilling.

```json
{
  "name": "Contract activity service",
  "planId": "ORIGINAL_SAVED_PLAN_UUID",
  "planVersion": 1,
  "startLedger": null,
  "endLedger": null,
  "windowLedgers": 1000,
  "pollIntervalMs": 15000,
  "connectionAlias": "testnet",
  "recoveryConnectionAlias": null,
  "publication": {
    "directory": "/private/contract-event-publication"
  }
}
```

For an existing service, `configure` accepts changed settings and `--watch` selects its identity. Original command requests are retained. To recover a request whose response was interrupted, repeat its identical arguments and request ID. Foreground `start` then joins the saved service runner.

The operator process and Merchant provider already run active services. Use the CLI daemon as the service host when operating without either of those hosts. The daemon owns the event workspace until SIGINT or SIGTERM drains its current native operation. After it exits, run `pause` to change the saved desired state, or open the same workspace through another interface. Services and Merchant can start, configure and pause their active host directly. The original workspace and runner leases coordinate those owners.

### Recover a historical gap

A service keeps its original required ledger when the provider's retained history moves past it. The Services view shows the actual provider result with the retained capture. Use one of the existing source routes:

- Select a configured archive alias that serves the same Stellar network and covers the required interval. The engine retains the original partial capture and reuses the service's exact fixed range through the compatible source.
- Receive complete native source editions into the event workspace, then select the editions that cover the required interval contiguously. The recovery uses their original network, plan and range identities and feeds those retained events through the same publication.

A repair input can contain `{"recoveryConnectionAlias":"archive"}` or `{"editionIds":["ORIGINAL_EDITION_UUID"]}`. The archive name must be present in this host's private connection map. The service preserves its last completed boundary until that missing source is acquired.

### Continue the original paid feed

The service appends completed source editions through `soroban-events-publish` and the existing event-feed store. Configure the actual merchant plan, payment terms and public origin on that publication using the original publication CLI, then release and run the original merchant. The same Buyer subscription continues from its saved original feed cursors as later events arrive.

Changing a service's polling interval or selected plan version keeps its original event namespace. Complete service receiving preserves the existing feed store, event sequences, private continuation material and original source editions. It restores into the explicit publication directory selected for the new host.

### Transfer and receive a service

Use **Export complete service** to save one complete private bundle. It includes the original watch configuration and continuation state, completed editions, the active partial capture when present, and the original publication snapshot. The manifest supplies the bundle identity and every file's exact size and digest. Host connection credentials and host-local configuration paths are supplied separately on the receiving host.

**Download complete ZIP** collects the selected bundle when it fits the browser archive limit. **Save complete folder** streams the original files in chunks, checks their complete digests, reuses matching completed files and resumes the transfer's own retained partial files. This route also supports large publication database snapshots.

On the receiving host, choose **Receive a service on this host**, select the complete bundle, its original manifest hash, the local source/recovery aliases and the destination publication base folder. Its retained publication targets are restored beneath that base with their original identities. The received service opens paused so the host's own configuration can be selected before collection starts. It keeps the original logical source identity and next-ledger position while retaining the receiving workspace's distinct identity.

The corresponding CLI command is:

```sh
starforge soroban-events-watch receive \
  --workspace /private/received-soroban-events \
  --connections-file /private/receiving-connections.json \
  --source-directory /private/complete-service-bundle \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --connection-alias testnet \
  --publication-directory /private/received-publication \
  --request ORIGINAL_RECEIVE_REQUEST --revision CURRENT_SERVICE_REVISION
```

Inspect that service, then start it through Services or the foreground command. The original paid-feed store and Buyer continuation preserve delivered event positions as the receiving host collects later ranges.

## What the retained source establishes

The source connects the delivered event edition to the actual network response, saved contract/topic selection, selected ledger interval and complete original RPC pages. The receiver can reopen that work after the provider's online history has moved on. The paid subscription separately records its original merchant pages and customer delivery progress.

For the SCF walkthrough, use this complete path: original installed source, managed application launch, actual network capture, saved edition, original merchant release, original Buyer collection, and received source reopened in a second workspace. Keep the original operation directories so capture recovery and customer recovery continue from the demonstrated state.

## References

- [Current Stellar RPC event API](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents)
- [Network identity API](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getNetwork)
- [RPC health and retained ledger range](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getHealth)
- [Native scan cursor implementation](https://github.com/stellar/stellar-rpc/blob/main/cmd/stellar-rpc/internal/methods/get_events.go)
- [Source module guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/soroban-events/README.md)
