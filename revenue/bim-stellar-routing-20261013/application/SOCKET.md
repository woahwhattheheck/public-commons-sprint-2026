# Socket V3 bridge integration

This adapter implements the currently published Socket Swap V3 routes behind the historical Bungee integration in BIM's architecture. It is an additive provider in the original BIM request/file store, not a new application or an automatic migration of pending Bungee v1 requests.

## Exact source

The complete 17-file official source selection is F0C90612V6D, 147,333 bytes, SHA256 7c4718cfdd918bb9f401b23e13d035113c6086bcc063d98b2f2533a2639b42c0. It contains all indexed lines of 16 original official pages and the complete authored source contract. Current endpoints and deposit lifecycle come from https://docs.socket.tech/ ; their full original page URLs are preserved in that source selection. The upstream OpenAPI JSON could not be acquired, and this adapter does not represent a guessed schema as an original API specification.

## Factory and actions

createSocketAdapter({access:"prototype"|"production",credentialAlias?,affiliate?}) returns the stable seven-action registry.

Prototype uses https://public-backend.socket.tech with shared public capacity. Production uses https://dedicated-backend.socket.tech with the selected server x-api-key credential and affiliate header. No API key enters browser or portable request bodies. The separately documented domain-whitelisted frontend origin is not silently substituted for this server profile. Access, selected original configuration and source evidence remain pinned to each request.

- socket.chains GET /v3/swap/supported-chains.
- socket.providers GET /v3/swap/providers with optional literal-text includeDepositRoutes.
- socket.tokens.list GET /v3/swap/tokens/list. list defaults to full; trending remains a visibly partial subset. chainIds is the original comma-separated decimal ID string.
- socket.tokens.search GET /v3/swap/tokens/search. The result is a search scope, not a complete inventory.
- socket.quote GET /v3/swap/quote, with {query,chainsResultId,tokensResultId}.
- socket.quote.activate POST /v3/swap/quote/{quoteId}/activate, with {quoteResultId,quoteId}; this is external-write and requires the original prepared operation.
- socket.status GET /v3/swap/status with {quoteResultId,quoteId,includeQuoteDetails?}. Deposit status always uses its original quoteId. A source transaction hash is not a substitute for the deposit quote identity.

All requests go through ctx.http and retain original request/response bodies, status, headers, SHA256, numeric-token provenance and server-req-id where supplied. ctx.getResult(id) must return the backend's original committed provider result. A caller cannot substitute a copied quote as native evidence.

## Selected Stellar deposit workflow

The current source documents Base chain 8453 and Stellar chain 1110002, USDC in either direction, using deposit mode. This adapter selects that exact workflow. It does not infer unsupported output-amount modes, arbitrary tokens, CEX withdrawal routes or custom destination execution.

First obtain original chain and token evidence. Select full provider token addresses and decimals; Stellar token-address encoding is taken from the original response rather than guessed from an issuer or symbol. A USDC symbol is not an independent issuer attestation. The consumer must retain the complete selected token and review its actual chain/asset identity when preparing a transfer.

The quote query contains userOps:"deposit", originChainId, destinationChainId, inputToken, outputToken, inputAmount, receiverAddress and refundAddress. Input amount is a positive original base-unit integer string. Optional slippage is percentage text with at most three decimal places; feeBps and feeTakerAddress are paired. The selected operation uses EXACT_INPUT. Receiver/refund/sender addresses are validated for their actual selected chain.

Quote admission binds its original source request to the returned chain pair, input asset and amount, receiver, each output asset and each exact quote ID. The complete returned route list is preserved, including rejected/empty outcomes exposed by the original envelope. No route is called best merely because it appeared first or carried a provider tag.

## Activation and instructions

A route with activationRequired:true is a preview. prepare freezes the original committed quote result, full original route, query, expiry and source exchange. The normal operation journal admits one explicit activation attempt. Unknown transport results retain that original operation and are reconciled without blind repeat activation.

Activation checks real time before dispatch. The original 201 documentation has no separate response schema; the adapter retains either the documented successful result envelope or an original bare activated route. Stable quote ID and actual instruction presence are required before exposing instructions. Conflicting or unavailable response identity remains unresolved with the complete original response retained.

The official general guide uses txData.kind plus object, while the deposit guide uses txData.type. These shapes are preserved exactly. The adapter does not rename them or invent a Stellar signed-envelope field. The UI can display exact depositData, txData, token, amount, address and memo for explicit source-bound preparation. Any automated signer must validate the actual selected chain, complete asset, amount, destination, memo and original XDR before the existing wallet driver can sign. Exact unknown fields remain in the source.

An active route with activationRequired:false requires no activation. Its original quote already carries the instructions. Do not activate it simply to produce a new receipt.

## Status, refunds and chronology

Status uses the stored original quote result even after its quote expiry. The adapter preserves full origin, destination and refund objects, hashes, amounts, token identities, statusCode and any destination-payload outcome.

PENDING and IN_PROGRESS are nonterminal. The documented deposit terminal states are COMPLETED, FAILED, EXPIRED and REFUNDED. REFUNDING, REFUND_FAILED, MANUAL_REVIEW_REQUIRED and lower-level ASSIGNED/EXTRACTED/FULFILLED/SETTLED/CANCELLED states remain visible without inventing identical terminal semantics. An unrecognized value remains UNKNOWN.

Provider fulfillment or settlement is separate from independently observed source and destination transfers. Source broadcast alone cannot prove destination delivery; a refund label alone cannot prove the returned asset and amount. The root domain reconciles these original observations against independent ledger evidence.

The original statusCheck interval/maxDuration is retained with the selection. This adapter makes one explicit read per action and starts no hidden polling loop. A host may schedule original reads within those selected limits. Expiry of an observation window means unresolved, not failed or refunded.

## Operator and receiving

All quote, activation, instruction, status and refund source bodies are exported through the existing full JSON/report/portable workflow. Received packages retain source history and execution-disabled configuration. Actual credentials, current provider support, wallet selection, fees and network evidence must be selected explicitly before executing a new provider operation.

The source-only checks exercise the authored query bounds, exact base units, supported chain pair, original addresses and status identity. They do not claim an acquired live quote, activated address, signed transfer, customer deployment or rendered browser. Run the whole original application course on its accepted equipment, inspect actual wide/narrow screens and every generated attachment, and retain original network and ledger results in the same case.


## Original backend selection

ctx.getResult is restricted to the request's explicit evidenceIds. It returns the complete committed row {id,actionId,input,configuration,value,exchangeIds,...}; value contains this adapter's full provider projection. Quote IDs live in the original full routes array. Every selected row is checked against its actual original action and result identity; no caller-provided replacement enters activation.

The selected application network must be {kind:"stellar",chainId:"1110002",passphrase:"Public Global Stellar Network ; September 2015"} for the documented Stellar route. Provider public access/affiliate configuration and server credential alias are pinned in each original projection and must match when selecting earlier evidence. Query status retains old quote evidence without requiring its original price window to remain open.


## Catalogue and typed action input

The issued /v3/swap/providers response is the bare object {bridges:[...],dexes:[...]}; both complete arrays and the unchanged object are retained. Other read actions keep their documented successful result envelopes. Quote activation separately supports its documented original activated-route shape.

Descriptor query has type json and is parsed once as the complete query object. Optional token/user/provider parameters stay absent when not supplied. Provider booleans remain the exact text true/false required by the query contract. Source IDs are evidence-id fields and must also be selected as original request evidence. These descriptors drive the existing mounted operator, without a second command format.
