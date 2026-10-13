# BIM Stellar wallets and MoneyGram cash ramps

This is an authored integration against the published Wallets Kit, Privy extended-chain and MoneyGram Ramps interfaces. It supplies real connection, envelope signing, browser submission, session creation, widget message handling, status reading and signed-notification verification. Provider credentials, authenticated Privy configuration, a selected wallet and an equipped browser are supplied by the operator.

## Source selection

- Stellar Wallets Kit 2.7.1, Creit-Tech/Stellar-Wallets-Kit: exact complete 84-file source carrier F0C8Y1YTWBC, SHA256 c587d449cc7525a225e86ad2390dc3729a9edd501596b91875ecb218dcf9e9e5. The adapter uses the actual static authModal, fetchAddress, getNetwork, setNetwork and signTransaction methods.
- Privy extended-chain React documentation and complete Node SDK v0.35.0: F0C90853RGR, SHA256 a7bb2e5c9514bc8585c66b6213f579ee05c1daf54158cbd1a4686941befc46c9. Official documentation: https://docs.privy.io/wallets/wallets/create/create-a-wallet and https://docs.privy.io/wallets/using-wallets/whitelabel . Node SDK source is retained for the broader authenticated API contract; browser signing uses the actual React extended-chain hooks.
- Current MoneyGram Stellar widget/session/status/webhook contract: F0C908C6EBT, SHA256 72524cef3370b6f3514e4ffa8a4b668526cc528e89e63ad7b366aaae5f08fb99. Complete official pages: https://xramps.moneygram.com/ops/developer/guides/web-stellar , https://xramps.moneygram.com/ops/developer/guides/embed-widget , https://xramps.moneygram.com/ops/developer/reference/transaction-created and https://xramps.moneygram.com/ops/developer/reference/status-webhooks . Original source URLs and all complete retrieved pages remain in that carrier.
- Stellar SDK is injected from the application's installed @stellar/stellar-sdk dependency. The application must retain the selected SDK package/version in its runtime source inventory. No browser dependency is silently downloaded by these modules.

The MoneyGram profile selects its documented Stellar USDC non-custodial flow. Legacy SEP partner credentials and custodial hot-wallet movement require their own selected contracts. The referenced ramps-v1.yaml endpoint could not be acquired; this implementation calls only the fully documented session and status routes and the documented widget contract.

## Files and one-store integration

lib/moneygram-core.mjs contains browser-safe original values, StrKey validation, exact decimal bounds, widget observations and status projection.
lib/moneygram.mjs contains the server-only adapter and native Ed25519 webhook verifier. Do not serve this Node module as a browser module.
web/bim-wallets.mjs contains Wallets Kit and Privy drivers.
web/privy-stellar.jsx mounts the real extended-chain hooks inside an existing PrivyProvider. It creates no wallet or signature merely by rendering.
web/stellar-submission.mjs creates exact original payment plans and carries their signing/submission/observation through the existing backend wallet journal.
web/moneygram-widget.mjs owns the exact-origin iframe and its listener, full observation flow, retained transaction identifiers, balance requests and explicit payment callbacks.

There is one original backend request store. Each command uses its existing {requestId,expectedRevision,method,args} envelope. Browser callbacks preserve that exact envelope before POST and recover the same request on transport uncertainty. No adapter has a second financial or credential store.

## Provider registry

createMoneyGramAdapter({environment,secretAlias,registeredWebhookUrl?}) exposes a stable actions list and both exact API origins. Registry construction must use the configuration frozen for the original request, not an unrelated live environment variable:

- moneygram.session.create: external-write. Input {walletAddress,flow}, with flow on-ramp or off-ramp. prepare returns the full original POST selection. execute is allowed only through the existing prepared external-write operation.
- moneygram.status.get: read. Input {sessionId,transactionId}. It requires the transaction's retained widget evidence to be associated with that session.
- moneygram.webhook.verify: read/local. Input {rawBody,signatureHeader}. The registered URL and environment come from the selected provider configuration.

Session POST is /api/v1/sessions, with original JSON {walletAddress,chain:"stellar"} and a server secret alias. The whole response is private; the public record retains its status, byte count and SHA256. The session token lives only in private original SQLite objects and the active iframe capability. Expiry is conservatively one hour from the original frozen request time. Replayed request time never extends it.

ctx.exposeSession receives kind, expiresAt, public metadata and secret.sessionToken. Its public descriptor contains id, kind, createdAt, expiresAt, public, sha256 and transactionIds. public includes environment, apiOrigin, walletAddress, flow, chain, asset, walletType, providerSessionId and widgetUrl. The authenticated no-store GET /api/session/:id returns {session,secret:{sessionToken}} only while available and unexpired. Working files, exported state and portable archives do not contain that capability. Received portable state preserves the public source hashes and disables execution until explicitly commissioned.

A fresh session is used when reopening the widget. session.event may associate an existing retained sourceEventId after verifying the original wallet/environment/flow. View mode does not emit another created event. A free-form transaction ID cannot create source evidence.

## Wallet drivers

createWalletsKitDriver({kit,stellar,networkPassphrase}) and createPrivyDriver({getSession,createWallet,signRawHash,stellar,networkPassphrase}) expose connect(), getAccount() and signEnvelope({xdr,networkPassphrase,address}).

Wallets Kit uses its actual selected module and refreshes the actual account before and after signing. A reported different network rejects the operation. Some published modules cannot report a network; that remains UNREPORTED and the returned signature must still verify over the exact requested network-domain transaction hash. The driver does not call Wallets Kit signAndSubmitTransaction, whose status-only result is insufficient to prove the original transaction.

Privy connect explicitly creates a Stellar wallet only when the authenticated user has none. Multiple Stellar embedded wallets require an explicit address. useSignRawHash signs the original transaction hash, and the adapter verifies the 64-byte Ed25519 signature before attaching it. Keys stay in the wallet provider. No server application secret belongs in the React component.

Both drivers retain the original transaction body hash and every original signature, require the selected account's valid signature, and return the full signed XDR and actual provider response. If account selection changes after signing, the result remains retained with SELECTION_CHANGED and cannot automatically submit. The ordinary-envelope profile deliberately rejects fee-bump envelopes; a fee-bump signer/profile can be added when explicitly selected.

## Actual browser submission

createStellarSubmissionDriver({stellar,wallet,networkPassphrase,horizonUrl,rpcUrl,journal,fetchImpl?}) accepts HTTPS endpoints without embedded credentials. It verifies Horizon network_passphrase or RPC getNetwork.passphrase before sending. API response bodies, request bodies, headers, SHA256 and times are retained as client browser observations.

journal.command(method,args) returns {value, replayed:boolean}; replayed must come from the server's X-BIM-Replayed header, with any missing or ambiguous header treated as true. journal.get(id) returns the latest original wallet operation, never an old accepted command result.

Commands:
1. wallet.reserve freezes {id,networkPassphrase,address,unsignedXdr,unsignedHash,intent}.
2. wallet.signed retains exact {id,signedXdr,hash,signatureReceipt}.
3. wallet.submitting commits before the first POST and only admits current SIGNED state.
4. wallet.observed appends {id,originalHTTP,projection}.

Projection kinds are NETWORK_PROOF, TRANSACTION_SUBMISSION and TRANSACTION_STATUS. Network reads do not change financial state. Submission outcome is SUBMITTED or UNCERTAIN. Status lookup is CONFIRMED, FAILED or UNRESOLVED. Unknown later observations retain earlier original terminal evidence rather than rewriting it.

The driver requires a fresh submitting response (replayed===false) and re-reads the current operation before sending. Per-operation browser Web Locks serialize cooperating tabs. Original backend SIGNED→SUBMITTING admission prevents concurrent senders even when Web Locks are unavailable. A resumed SUBMITTING, UNCERTAIN or SUBMITTED operation reads status by the frozen hash only. A lost response, NOT_FOUND, malformed reply, non-2xx response or provider rejection never causes an automatic second POST.

prepareMoneyGramPayment reads the actual selected Horizon account sequence, freezes the complete payment, exact USDC asset/issuer, uint64 ID memo, fee, 180-second time bound and full source replies. Its stable operation ID is independent of a fresh MoneyGram session. Existing operations adopt the original exact XDR and sequence rather than rebuilding a new transaction. General quote/swap plans enter signAndSubmit with their already prepared complete immutable XDR.

Horizon submissions use POST /transactions with form-encoded tx. RPC submissions use sendTransaction with original signed XDR. Follow-up uses the exact transaction hash. These are retained client observations; the backend's independent stellar.confirm read supplies separate original ledger evidence.

## Widget lifecycle

mountMoneyGramWidget takes container, private capability, optional viewTransactionId, persistEvent, onObservation, submission, onError, onClose and onChange. It validates both event.origin and event.source against the exact iframe. It sends private session configuration only to that iframe. It never includes the token in working state or callbacks.

onObservation retains the whole actual browser event. persistEvent commits the normalized event through session.event. Created events are retained before a known transaction can authorize a signing path. Events have source CLIENT_WIDGET_OBSERVATION; their numeric quote display values are not used as exact payment amounts.

For cash-out, the original signing payload must select Stellar, USDC, the selected network, G-address, original decimal-string amount, correct network issuer and exact Memo.id. The application uses the actual wallet driver and full submission journal. RAMPS_SIGN_SUCCESS is returned only after the original transaction hash has a successful status observation. Signing uncertainty sends an unresolved error and keeps the original hash for recovery.

The same transaction keeps one wallet operation across fresh sessions. View mode is read-only. Closing removes the listener/iframe immediately, waits for already active work to retain its outcome, and starts no hidden signature after closure. No new payment is created to recover a pending one.

RAMPS_CHECK_BALANCE uses an actual original Horizon account/trustline read. Exact integer atoms determine sufficiency; the widget display balance is numeric. Cash-in signing is rejected because the standard source contract does not require it.

RAMPS_TRANSACTION_COMPLETE means the widget's done screen. Cash-out completed means cash ready, paid_out means collected. funds_received is not cash ready. refund_mgi_success is not the terminal refunded state. Cash-in completed reports USDC delivered; an independent ledger observation remains separate evidence. Original provider status and all unknown states stay available.

## Signed notifications

The current Stellar MoneyGram notification is Ed25519, not the RSA contract for a different product. The selected official environment public key is a verified Stellar StrKey. The signature covers original timestamp + "." + registered webhook hostname + "." + the original message string from the outer JSON wrapper. Verify before parsing the signed message. Preserve the exact complete raw body, Signature header and original message string.

The verifier allows the documented one-hour retries plus five minutes, and at most five minutes of future skew, using the signed header timestamp and original receipt time. Data timestamps are informational: the supplier documents a Central-time/Z-format issue. Notification transaction ID is the MoneyGram ID, distinct from the Ramps transaction ID. The status vocabulary differs from the Ramps status endpoint. A verified notification triggers correlation/status reconciliation; it does not directly credit a balance.

## Commissioning and received evidence

The authored source checks exercise original public-key checksums, exact seven-decimal/int64 bounds, selected network and uint64 memo, created-event identity and cash-ready/collected/refund distinctions. They are source-only checks with authored inputs. No provider session, wallet signature, payment, installed native course or rendered-browser result is represented by them.

Commission the complete application with the actual configured runtime and original provider inputs. Use the full app and original receiving operation. Inspect actual wide and narrow screens, use each connected flow, open every generated attachment and preserve original browser/network/ledger evidence. Keep secrets and private session capabilities out of screenshots, logs and deliverable archives. Full runtime/rendered results belong in the existing original case and sole accepted receiver operation.


## Installed browser entry

web/wallet-entry.mjs is the actual standalone entry. The maintained Node package installs @stellar/stellar-sdk 16.0.1 and the upstream npm distribution @creit.tech/stellar-wallets-kit 2.7.1. The npm scope uses a dot; its official source/JSR scope uses a hyphen. Upstream src/build_npm.ts declares this package and the exact /sdk and /modules/* exports. Keep the kit's own SDK dependency independent instead of aliasing its SDK17 to the application's SDK16.

The maintained esbuild step bundles this entry into web/wallet-entry.bundle.mjs. No CDN script or global injected wallet is required. createWalletRuntime({config,journal,fetchImpl?}) returns connect, getAccount, signAndSubmit, observe, readBalance, prepareMoneyGramPayment, mountMoneyGram and destroy, plus lifecycle-tracked wallet and submission facades. mountWallets is the same factory.

config.network selects {id,kind:"stellar",passphrase,horizonUrl,rpcUrl}. config.wallet.networkId must match if present. Optional config.providers.walletsKit.publicConfig supplies moduleIds and WalletConnect projectId/metadata. The default actual modules are Freighter, Albedo, xBull, Lobstr and Rabet. WalletConnect is included only with the configured application metadata and project ID. Its published SDK initializes its own transport; no signing or submission occurs during module initialization.

Only one wallet runtime owns the page at once. Destroy closes its MoneyGram listeners, waits for owned in-flight actions to retain their results and then permits another configuration. Wallet sessions themselves are maintained by the original SDK for the page; changing module/project identity requires an explicit saved working-file/page reload. Changing the selected network after closure does not replace retained operation network pins. Optional Privy remains a real React bridge inside the host's configured PrivyProvider.

Original transaction minTime/maxTime are checked before a first signature and immediately before first submission. An expired unsigned/signed plan is retained for review and an explicit new plan. Already admitted SUBMITTING/UNCERTAIN operations remain status-only even after their time bound passes.


## Browser HTTP custody

The submission driver requires journal.retainHTTP(record), implemented through the existing source.import command with complete UTF-8 JSON {name,type:"application/json",contentBase64,bytes,sha256}. The accepted original File receipt is returned as sourceFile before any response is interpreted.

Each browser HTTP request owns an AbortController and response reader, with a 30-second default total deadline and 16-MiB default retained-body bound. Configurable bounds are limited to 1–120 seconds and 1KiB–64MiB. The durable bim.browser-http.v2 record retains exact response bodyBase64, bytes, SHA256, UTF-8 validity, complete/partial flag, observed byte count, original error and reader cleanup outcome. It does not duplicate the response as JSON-escaped body text. The in-memory body display is derived from the retained bytes, with replacement characters only for a visibly invalid UTF-8 display; accepted JSON still requires valid complete UTF-8. The same compact record is used by wallet.observed and original payment intents. Historical v1 records remain unchanged. A maximum 64-MiB body expands to at most 89,478,488 base64 characters plus the retained metadata, within the original 128-MiB source object capacity; the original UTF-8 JSON File byte count and hash still apply. A capacity-limited response is an explicit source prefix and cannot prove a complete API result. Invalid UTF-8 is retained as bytes and cannot be parsed as accepted JSON.

close aborts the driver's pending HTTP requests and waits for their original source retention. Each MoneyGram widget has its own submission-driver HTTP scope, so disposing that widget cannot cancel an unrelated wallet operation elsewhere in the application. Already requested wallet signing remains owned until the actual wallet responds; its full signed result is retained, and closure prevents a subsequent hidden send.


## Descriptor and validation transport

Every HTTP action declares both exact allowed MoneyGram origins on its own descriptor. Descriptor fields preserve their actual type: flow is the literal on-ramp/off-ramp enum, rawBody is multiline original text, and signatureHeader remains a string. The generic operator must preserve rawBody line breaks rather than parse/re-serialize the signed source.

Authored input validation errors carry code PROVIDER_VALIDATION and publicMessage. The original backend may display that bounded authored message after its credential/capability redaction; arbitrary underlying SDK or transport exceptions are not automatically declared public.
