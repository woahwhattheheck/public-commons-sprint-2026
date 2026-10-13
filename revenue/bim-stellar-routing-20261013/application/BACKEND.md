# BIM backend and original request operation

This is the complete Node backend, CLI and Next integration for the BIM SCF45 application. It keeps local configuration, source files, provider evidence, prepared instructions, wallet observations and portable workspaces in one SQLite store. The final application composes these bodies with the actual provider adapters, browser modules and their exact source manifest. This source-only review packet does not claim a launched server, provider request, wallet signature or rendered product.

## Runtime and installation

Use Linux with Node 22.16 or later and its actual node:sqlite DatabaseSync. The workspace owns one retained lease. SQLite uses WAL and synchronous FULL. Complete source-files.json is read and every selected source body is hashed before the database opens; the workspace stores that original application identity and provider catalogue identity. A changed installed edition must be handled explicitly, never silently substituted into an existing workspace.

The standalone CLI imports providers/index.mjs, whose createProviders() returns the final complete provider factories. The Next integration accepts the same selected adapters and uses the same workspace, command journal and route handler. Keep it in a persistent Node host with owned local disk. A disposable edge/serverless filesystem is not the selected runtime. Browser code contains no server credential resolver.

A completed installation includes the exact local wallet bundle and its dependency lock. Build that bundle from the pinned source with the documented package command; never inject an unrelated global wallet API or substitute a CDN build. Public source and an actual installed dependency/runtime receipt are separate records.

## Commands and HTTP

Run node cli.mjs help for complete options. Every CLI input/output/workspace is an absolute path. Output publication is create-only with exact-byte replay and file/parent synchronization. A CLI invocation opens the same whole workspace and releases it after the complete operation, including failures. serve owns the listener and workspace until SIGINT/SIGTERM; it aborts and drains original HTTP before closing the SQLite owner.

POST /api/command accepts {requestId,expectedRevision,method,args}. Authorization is Bearer plus X-BIM-Workspace-ID. Next uses the same interface at /api/bim when selected by the host. The complete envelope is cloned and validated before it enters the serial queue. Same-ID different intent is rejected. An already completed original request returns its exact receipt before the revision check. Lookup is read-only and never executes a request.

The immutable accepted body is {workspaceId,requestId,revision,result}. X-BIM-Replayed is false only for a newly admitted outer request and true for any already retained request, even if its previous response was lost. The browser MUST require the literal false header for the first wallet submission. A missing header grants no permission.

GET /api/bootstrap returns workspace/config/catalogue/capabilities. GET /api/state returns every complete retained collection, including requests, source files, exchanges, query results, plans, submissions, wallet operations and session events. There is no hidden first-page truncation. GET /api/request/:id returns the accepted receipt or 409 with the whole unresolved original request in error.details.request. Other errors use {error:{code,message,details}}. Authored provider validations may explicitly supply publicMessage; the backend redacts private credential/session values before retaining it and adds actual original exchange IDs. Arbitrary fetch/SDK error strings are not exposed.

GET /api/files/:id returns the full original binary object with its original filename and X-Content-SHA256. GET /api/export returns a whole portable JSON attachment. GET /api/wallet/:id returns the complete latest wallet operation. GET /api/session/:id returns {session,secret:{sessionToken}} only under the authenticated, no-store original host. Never add this ephemeral secret response to browser drafts, logs or working-copy exports.

## Local configuration and sources

config.save retains the complete public configuration. network contains id, kind, optional chainId, RPC/Horizon URLs and passphrase. wallet contains address, networkId and optional provider. providers maps each provider to its public base/environment/contract IDs, publicConfig and server-only credentialAlias. Secret values have no configuration field.

The credential resolver supplies exact allowed origins and private injected headers for an alias. The private original header bytes remain in the original private store; public evidence retains only the alias/header names/hash. The CLI credentials file and token file must be private regular files. Neither is exported.

source.import takes name,type,contentBase64,bytes,sha256 and retains all original bytes after exact verification. Identical bytes reuse their original object identity; the earliest descriptor remains the original filename/type record. note.save is append-only whole text. Browser chain response retention uses this same source.import writer: journal.retainHTTP(record) serializes the complete response record, saves its exact UTF-8 bytes and returns the native file receipt before interpreting the response. It must never include live session capabilities or authentication headers.

## Provider adapter context

Factories expose catalogue or actions plus execute(actionId,input,ctx), with prepare for external-write actions. Descriptor mode is read, local, prepare or external-write. Each descriptor declares its exact HTTP origins. Adapter-level metadata alone does not grant an origin.

ctx.config and ctx.configuration are the same frozen original public configuration. ctx.now is the original request creation time. ctx.evidence is a frozen array containing only explicitly selected evidenceIds. A query row contains id,actionId,input,configuration,value,exchangeIds and sourceStatus; value is the complete provider projection. ctx.getResult(id) returns only that selected row. It does not search unrelated history.

ctx.fork(label) returns a stable child context for parallel provider discovery. Labels use letters, digits, underscore or hyphen. Each hierarchical lane has its own ordinal sequence and shares the same immutable request/config/evidence/time and cancellation signal. The exchange identity binds requestId,lane,index. Repeated access to the same lane shares its counters. Use fixed provider names rather than completion order.

Every ctx.http call is tracked by the owning request. The backend drains all already-started calls before it publishes a success or failure; after the context closes it admits no new calls. This remains true when one parallel adapter throws. Exchange IDs are sorted in the accepted result and the portable verifier checks each lane's complete ordinal sequence.

HTTP input explicitly selects method, exact URL, public headers, optional exact bodyBase64, credential alias, read/write semantics, timeout and byte bound. Redirects are rejected. The attempt reservation is committed before fetch. Exact prior COMPLETE requests adopt retained bytes; any RESERVED, READING or UNCERTAIN attempt is never sent again. Responses retain complete or partial bytes, status, public headers, actual observation time, byte count/hash and strict UTF-8/JSON projection with exact number tokens. Readers are cancelled/released before the context ends.

A read query may return sourceStatus INCOMPLETE with a provider failure visibly retained. It must not be described as an empty successful market. A plan using incomplete selected HTTP becomes NEEDS_REVIEW. A fallback may retain failed read-only lanes while selecting a successful lane: selectedSourceLane plus selectedExchangeIds must name exactly every current exchange in that lane/subtree. The overall sourceStatus remains INCOMPLETE, while selectedSourceStatus can be COMPLETE. No incomplete external write is excluded by that selection. An external write cannot complete while any selected exchange is incomplete. Raw evidence and domain completeness are separate: HTTP COMPLETE means all bytes arrived, not that a quote or provider status is economically valid.

## Preparation and explicit external actions

query.run is limited to read/local descriptors. plan.prepare retains the complete original input, selected evidence, configuration and unsigned payload. It lifts status,selection,execute and expiry without losing the full value.

operation.execute requires the exact original PREPARED external-write plan, explicit executionEnabled, current identical configuration and a valid expiry. Before dispatch it reconstructs the plan using the original immutable request and retained original HTTP only, compares the entire result, and rejects altered source or instructions. The same plan cannot acquire a second execution request. Original uncertain attempts stay associated with that plan.

Wallet plans have no server execute action. submission.record retains the reported original plan/hash/envelope and labels it CLIENT_REPORTED_SUBMISSION. Independent confirmation is a separate read-only provider query. Neither browser reporting nor local history alone proves settlement.

A settled local/read-only failure becomes an immutable FAILED original request, retaining every complete/partial response; the same ID never sends again. Only an original external write/session attempt can remain UNCERTAIN and block normal work. An unknown outer request blocks another normal command until the original is reconciled or explicitly preserved with request.retire{originalRequestId,reason}. Retirement keeps the full unknown request, captured attempts and history. It does not assert provider failure, free the same plan for execution or permit reusing the original ID. The visible action should say “Preserve unresolved attempt and continue”.

## Wallet-side submission

wallet.reserve freezes the operation ID, source account, network passphrase, entire unsigned XDR/hash and original plan or session/transaction intent. wallet.signed retains the complete signed envelope and signature receipt. wallet.submitting commits SUBMITTING before the browser calls its selected network. It requires executionEnabled and the original network/wallet/provider configuration. The enable flag can change deliberately; other selected values cannot. Reserve binds the exact prepared XDR/hash/source/passphrase, and all these checks are replayed against the original historical configuration during portable inspection.

Only a fresh, explicit outer submitting receipt with X-BIM-Replayed:false permits the first transport attempt. The browser owns its per-operation Web Lock and rereads the exact signed operation before sending. SUBMITTING, UNCERTAIN, SUBMITTED, CONFIRMED and FAILED all resume through status lookup by the original hash; no second POST follows lost responses, NOT_FOUND or an ambiguous result.

wallet.observed appends the full original browser HTTP and NETWORK_PROOF, TRANSACTION_SUBMISSION or TRANSACTION_STATUS projection. These remain CLIENT_BROWSER_OBSERVATION. Unresolved status cannot erase an earlier terminal result; a conflicting terminal observation is retained as a conflict. Root's independent server-side stellar.confirm remains the settlement check.

## MoneyGram capabilities and original transaction links

Session creation is a prepared external write. Its original response body and live token are private. Public rows keep the exact response identity and time, session metadata and expiry. No portable export claims to carry the private bytes.

session.event retains an actual widget observation and original Ramps/MoneyGram transaction IDs. Status reads select a committed original transaction binding. Fresh view sessions can explicitly associate a prior event by sourceEventId; the server verifies the same environment, wallet and flow, then copies the original IDs rather than accepting replacement IDs. View mode is not authorization for another wallet payment.

MoneyGram sign operations keep one stable wallet operation across fresh provider sessions. Session recreation cannot regenerate the signed envelope or resend an uncertain transaction.

## Complete workspace transfer

workspace.inspect verifies the exact packet digest, complete objects, original requests/results, ordered history, source bindings, query/plan projections, wallet transitions, session associations and complete application roster. Source bodies and exact original stream bytes remain available. Private bodies and capabilities are explicitly unavailable to the recipient.

CLI receive requires an explicit destination and original request ID. workspace.receive is the authenticated equivalent: it computes a new child directory from the original request and packet hash, receives there, disables execution and records the complete receipt in the current journal. It never replaces the currently open workspace or silently changes its token. The operator may explicitly serve the returned child afterward.

Both paths use the same complete verifier/receiver and exact installed source edition. Repeating the original receive adopts its original packet/ID and preserves later recipient work. A completed parent command replays its saved receipt without reopening or rewriting the child. Received unresolved requests retain original-owner custody, and private session secrets cannot be reconstructed from public hashes.

## Actual receiving and honest outcomes

The product must be operated from its complete installed source with actual dependency/runtime receipts. Open the standalone and the selected Next integration, configure a real authorized read-only network, retain complete sources, quote through every selected provider, inspect partial failures, prepare without signing, save/reopen the full browser working copy and original source files, inspect/receive/export the whole native workspace and independently reopen its return. Use the exact original request IDs at interruption boundaries.

At desktop and narrow width, open and LOOK at every relevant source/report/JSON/archive/download and its usable contents. Exercise normal form editing, source selection, original recovery, expired sessions, cancelled wallet prompts and layout. Real wallet signatures, session creation, bridge activation or submissions require the user's explicit selected intent; no authoring or source review dispatches them.

Keep source-review, syntax verification, actual HTTP, actual wallet execution and actual viewed browser evidence separately named. This backend source packet records no live provider or browser result.
