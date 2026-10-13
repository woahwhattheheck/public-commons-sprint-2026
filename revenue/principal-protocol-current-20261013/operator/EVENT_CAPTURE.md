# Current Principal original event pages

This module captures complete source pages from the operator-selected Stellar RPC and retains them in the same SQLite workspace, original request journal and portable handover as native CLI observations. It sends only getNetwork and getEvents. It does not deploy, sign or submit a transaction. There is no background poll or automatic historical backfill.

## Select an exact query

Use the ordinary command envelope:

{
  "requestId": "YOUR_ORIGINAL_EVENT_REQUEST",
  "expectedRevision": 0,
  "method": "event.capture",
  "args": {
    "query": {
      "contractKeys": ["recovery_escrow"],
      "startLedger": "YOUR_EXACT_U32_LEDGER",
      "limit": "100",
      "eventType": "contract"
    }
  }
}

These are explanatory values; use the current workspace revision, actual configured contract IDs and a ledger retained by the selected RPC. contractKeys contains one to five distinct keys from the exact installed API, with distinct configured contract IDs. Each selected contract requires its configured WASM digest. startLedger and limit are exact decimal strings; limit is 1–10000. eventType is contract, system or all. A query contains exactly one of startLedger and cursor; a cursor is the original opaque provider value.

The native request uses explicit named parameters, one exact contract filter, the selected limit and xdrFormat:"json". getNetwork must return the configured passphrase before getEvents is requested. The configuration pins RPC URL, passphrase, contract key/ID, selected WASM and the complete API digest.

The configured WASM digest is a selection pin for event queries, not independent proof of the historical code that emitted an event. Event binding therefore explicitly records codeVerification:"CONFIGURATION_PIN_ONLY". A current native CLI observation separately checks the deployed contract hash. Neither converts an old event into a historical WASM attestation.

## Whole originals and exact typed values

Each original attempt retains input.json, reserved.json, the complete JSON-RPC request for each method, HTTP response URL/status/headers, complete raw body, successful-response hash receipt and result.json. The workspace stores every retained file as full bytes with its own identity; each page supplies sourceFiles with original path/ID/bytes/hash and sourceFileIds for download.

The source parser preserves numeric lexemes as exact strings. Typed event topicJson/valueJson structures come directly from the RPC's supported XDR-to-JSON representation. No client-side heuristic decoder is used, and no fixed application interpretation is imposed on changing XDR structures. The complete original event and response remain beside convenient ledger, contract, transaction, topic and value fields. Each accepted page retains its full original numberTokens map, and each event retains a correctly scoped map. These maps participate in event identity: a bare JSON number and a quoted string never collapse into one typed event merely because their visible characters agree.

A CAPTURED page passes full request/network/contract/type/ledger/typed-field checks. ERROR and INTERRUPTED retain the actual original files and explicit failure, with no accepted event rows. Complete portable inspection repeats the same projection from original raw response files and checks it against the saved accepted page, original request and exact source-file roster.

## Original continuation

A saved page has:
- id, createdAt, query and full binding;
- previousPageId or null;
- status CAPTURED, ERROR or INTERRUPTED;
- originalResult and complete events on success;
- latestLedger, oldestLedger and their original close-time fields;
- the original response cursor and a nextQuery derived solely from it;
- coverage SELECTED_RPC_PAGE and populationComplete:false;
- original configuration, API digest and full source-file references.

To continue, deliberately submit a new original command with args.query equal to the saved nextQuery and args.previousPageId equal to that page ID. The selected contract/network/WASM/API binding must still agree. The continuation omits startLedger. Each accepted page remains immutable; later ledger retention or changed provider observations never rewrites it.

A page shorter than its limit, an empty page or an advancing cursor does not establish complete historical coverage. The RPC keeps a bounded retained ledger window, and its scanning rules can produce sparse pages. The operator never labels these pages a complete market history. If the original start ledger has expired, preserve the rejection and choose a new explicit query with an explained coverage gap.

state.eventPages retains every full saved page. state.events is a derived view: byte-identical event bodies with the same source identity share an event row and retain all pageIds. Different full bodies under the same network/contract/provider event identity remain separate rows marked identityConflict. The view does not silently replace an earlier event or choose an authoritative one. All raw bodies are still in eventPages and source files.

## Interruption and ownership

The original request is saved before capture. Each attempt has one immutable source reservation. A 60-second bound applies to each HTTP exchange, and closing the server aborts active reads, closes response readers/files and retains the workspace lease until closure. Full response bodies are limited to 128 MiB; the aggregate workspace capacity still applies. Oversized or incomplete bodies are explicit failure evidence, not complete pages.

A repeated completed command returns its original response before revision checks. If the original Node owner ended after reservation but before a terminal receipt, resuming that same request preserves its existing files as INTERRUPTED instead of issuing a second source read. The operator may then choose a new explicit request; it remains a distinct observation. A database publication failure after HTTP completion reuses the same complete terminal files on the original request.

All newly created and adopted directory entries are synced before reservation. File bytes and parent directories are synced before terminal acceptance. The terminal source roster and every full hash are checked both on first acceptance and later replay. Imported pending requests remain with their original owner; a recipient cannot resume another producer's uncertain operation.

## Recovery cases and handover

The browser can reference saved event IDs, observations, plans and original files in append-only RecoveryEscrow review notes. A case stage is an operator review record. It does not assert seizure, settlement or transaction finality solely from a note.

Export the complete native workspace for all event originals, cases and code, and export the separate browser working copy for unfinished query/case fields and selected files. Open the actual exported JSON, raw event sources and HTML report; operate desktop and narrow views and inspect their real results before presenting the product. The same original receiving course supports event.capture when an actual configured source query is supplied. No live query was invented for this source delivery.

## Primary interface references

- getNetwork: https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getNetwork
- getEvents, event types, limits, retention, ordering and xdrFormat: https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents
- Cursor semantics: https://developers.stellar.org/docs/data/apis/rpc/api-reference/structure/pagination
- RPC source and JSON-XDR field changes: https://github.com/stellar/stellar-rpc/blob/main/CHANGELOG.md
- Original current Principal source: https://github.com/principal-Protocol-org/principal/tree/f35b914cbf4896255a3711d81795b810b0a47f1c

This is complete authored source and interface review, not a claim of a performed provider capture, native build, funded transaction or rendered customer commissioning.
