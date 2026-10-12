# Soroban contract-event operations

Operate a retained collection of native Stellar RPC events from saved contract and topic filters. A capture fixes its ledger range and filter revision, records complete RPC response pages, and resumes from the provider's original cursor. Operators can inspect the complete event records, name an immutable source edition, publish that edition through the existing paid event feed, and transfer the complete source to another workspace.

## Operator workflow

1. Open **Soroban contract events** in the original Applications workspace, or run `starforge soroban-events-workspace --workspace /private/events --connection-file /private/stellar-rpc.json --port 0`.
2. Save the contract and topic filters. Select the start ledger and exclusive end ledger for the capture. The native adapter checks the actual network and retained history before reading events.
3. Capture the selected range. Reopening the workspace retains the same plan, capture identity, source pages and pagination cursor. Resume the selected capture when a provider or connection interruption needs recovery.
4. Review the returned event records and create a named edition of the completed capture. Raw topics and values remain in their original XDR form.
5. Use `starforge soroban-events-publish` to put the edition into the original SF30 webhook-feed store and merchant release. The original `starforge buyer-event-feed` performs paid collection and customer export.
6. Export the complete retained source, then receive it into another private workspace. Merchant clients can download the original files with their sizes and hashes instead of depending on a shortened tool response.

See [the operating guide](../../../../products/soroban-events/OPERATING.md) for source installation, private connection setup, recovery and customer delivery. The [merchant client guide](../../../../stellar-forge/mcp-merchant-operator/soroban-events/CLIENT.md) documents typed calls, host configuration and complete file downloads.

## Recurring source services

Use **Services** in the operator browser or `starforge soroban-events-watch` to follow a saved plan across successive ledger ranges. Each service retains its next ledger, exact active child requests, complete source editions and original paid-feed publication. Its short start, pause and configuration controls use an independent service revision while native collection continues.

The managed operator and Merchant provider run saved active services. A headless host uses `soroban-events-watch daemon`; `start` saves RUNNING intent and enters the same foreground runner. Named connections come from the private `--connections-file` map, with the ordinary single connection available as `default`. Recovery can use an actual compatible archive alias or contiguous complete source editions.

Complete service export includes the retained active partial capture and original publication snapshot. Receiving preserves the logical source origin, plan versions, event sequences and next ledger, while the receiving workspace keeps its own identity and host configuration. It opens the received service paused. Browser folder receiving streams and verifies source bytes in chunks, reuses exact completed files and resumes its own incomplete transfer.

## Native source behavior

Filters use the current `getEvents` contract: contract or system event types, contract IDs, and topic patterns containing XDR values or supported wildcards. The first request supplies the selected ledger interval. Subsequent requests use the original cursor and omit the mutually exclusive ledger bounds. The capture keeps the original interval locally while it follows the provider's cursor.

A page with no matching events can still advance through a sparse range. Completion follows the native scan cursor and original maximum-event sentinel, not the number of events on one page or the node's latest ledger. This preserves empty intervals and long sparse histories without silently discarding later matching events.

The connection is private host configuration. The actual `getNetwork` passphrase must match it. A capture retains its network, plan revision, ledger interval, request parameters, response bytes and event identities. Source receiving works without an RPC connection; an operator can configure a connection later to continue work.

## Modules

| Module | Responsibility |
| --- | --- |
| `rpc.mjs` | Native JSON-RPC transport, filter validation, network and history reads, original event pagination |
| `engine.mjs` | Saved plans, durable captures, event review, editions and complete source receiving |
| `server.mjs`, `public/` | Local operator workspace and authenticated browser access |
| `cli.mjs` | Command-line access to the same workspace operations |
| `source-download.mjs` | Shared native CLI transfer of exact export files through incremental range reads |
| `watch.mjs`, `watch-cli.mjs` | Recurring native ranges, short controls, original publication and complete service recovery |
| `public/watch.mjs`, `public/source-transfer.mjs` | Service operator controls and streaming complete-folder receiving through the original browser digest |
| `publish.mjs`, `publish-cli.mjs` | Immutable source edition to original SF30 paid feed and merchant release |
| `application.mjs`, `application-provider.mjs` | Original Applications review, saved launch, startup identity and restart |
| `stellar-forge/mcp-merchant-operator/soroban-events/` | Merchant configuration, tools, typed client and complete retained-file transport |

## Source-selected package

The `soroban-event-operations` selection includes this workspace, the original SF30 webhook-feed merchant, the SF88 event-feed Buyer, source receiving, the merchant tool runtime and the managed Applications lifecycle. The contribution is `distribution/contributions/soroban-events.json`.

## Protocol references

- [Stellar RPC getEvents](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents)
- [Stellar RPC getNetwork](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getNetwork)
- [Stellar RPC getHealth](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getHealth)
- [Original getEvents scan implementation](https://github.com/stellar/stellar-rpc/blob/main/cmd/stellar-rpc/internal/methods/get_events.go)
- [Original RPC cursor implementation](https://github.com/stellar/go-stellar-sdk/blob/main/protocols/rpc/cursor.go)
