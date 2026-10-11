# Stellar x402 — buyer-controlled spend governor

**SF-36, SCF-STARFORGE-20261009 · independent original Python source, standard library only.**

This library is a production-oriented *offchain spending-policy primitive*, not a funded grant, a wallet, a settlement engine, a Stellar contract, or a confirmation of live payments. It sits on the BUYER side of the canonical x402 flow and can be wired between an agent's "I want to buy this resource" intent and the original x402 SDK. It **cannot sign transactions**, move XLM/USDC or substitute its permission for the wallet's Soroban authorization entries. The cryptographic authorization in the underlying payment protocol remains authoritative.

## Why it exists

Autonomous agents need a way to express "up to this much, for this resource and this one request" while preserving owner-approved daily, per-service, per-agent and total budgets. When an x402 `upto` payment authorizes a maximum, **reserve the MAXIMUM**, never the optimistic estimated or usage amount. The trusted settlement watcher later attests to the actual settled amount and releases unspent reserved capacity, while the Soroban scheme itself enforces single-use authorization, recipient binding and time validity.

Direct authoritative specs, pinned at engineering time:

- [x402 Foundation, `upto`](https://github.com/x402-foundation/x402/blob/main/specs/schemes/upto/scheme_upto.md), Git blob `202dae031d453db9cf46cd52de92c1800aee33f5`
- [x402 Foundation, Stellar `exact`](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_stellar.md), Git blob `702624ad929411553c8635e60dad855e55fc9b82`
- [SCF x402/Bazaar RFP](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track): **Q3/#45** listing; #46 applicability unresolved; owner submission HOLD.

## Source files

`governor.py` implements:

- Asset/network allowlist for exactly `stellar:testnet` / `stellar:pubnet` and 56-character Stellar contract IDs; no default permission to spend.
- Canonical **base-unit string only** arithmetic. Reject floats, JSON numbers, negative and noncanonical integer encodings; support values up to signed 64-bit maximum. Units are in the asset contract's own base units, NOT human-readable XLM, USD or decimals; external SDK must perform verified decimal conversion.
- Five caps **per asset and network**: one payment request, lifetime total, UTC calendar-day total, per-agent/day, per-service/day. Rolling windows are a possible later extension, not claimed here.
- Explicit operator-issued HMAC-SHA256 **v2** consent bound to the complete purchase intent: resource URL, recipient/payee, network, asset, scheme, signed maximum, timeout, HTTP method, body bytes/presence/hash and canonical accepted payment-terms SHA-256, plus unique request ID and a 15-minute maximum expiry. Buyer agent never receives the HMAC key; agent cannot mint new permissions or change signed terms.
- Atomic SQLite `BEGIN IMMEDIATE` reservation and idempotent retry handling, **confirmed on-disk WAL + synchronous FULL**; memory databases/SQLite `file:` URI paths fail closed, and the constructor reads back the actual journaling and sync settings before accepting a ledger. Reserve **max** of `upto`, full price of `exact`. Current-state budgets include unreconciled reservations, preventing accidental overbooking. An operator must still use genuinely persistent storage, never a RAM-backed filesystem or unprotected copied ledger.
- Separate trusted finality observer attestation, also HMAC signed, binding original provider receipt reference, its SHA-256 and the actual charged amount. The receiver enforces `actual <= reserved max` (`exact` additionally requires exact equality). Multiple reservations cannot claim the same network receipt. No agent API for releasing unsettled pending reservations.
- Persistent HMAC-chained append-only event journal AND a reconstructed reservation projection integrity check before mutation. This is **tamper-evident against unauthorized edits given separate secret custody**, not a cryptographically anchored defense against malicious FULL database rollback. Pin/checkpoint journal digest outside this service for rollback evidence.
- One-call `estimate()` for UI/dry-run; it is never a permit or spend reservation.

## Integration, trusted roles and exact flow

```python
import os, json, hashlib
from datetime import datetime, timezone, timedelta
from governor import Governor, issue_consent, issue_finality_attestation
policy=json.load(open('policy.example.json',encoding='utf-8'))
# Use separate secret-bearing operator services; never export keys to the agent.
ck=os.environ['GOVERNOR_CONSENT_KEY'].encode()    # >=32 random bytes
ak=os.environ['GOVERNOR_AUDIT_KEY'].encode()      # >=32 random bytes
ok=os.environ['GOVERNOR_OPERATOR_KEY'].encode()   # >=32 random bytes
ledger=Governor('buyer-ledger.sqlite',policy,ck,ak,ok)
# Trusted buyer/operator confirms the EXACT offered x402 accepted terms and
# obtains this canonical digest from the real SDK; these values are illustrative.
# The fake payee here is NOT a valid funded production Stellar account.
payee='G'+'A'*55
asset='CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
terms={'scheme':'upto','network':'stellar:testnet','asset':asset,'payTo':payee,
       'amount':'1000000','maxTimeoutSeconds':60}
terms_hash=hashlib.sha256(json.dumps(terms,sort_keys=True,separators=(',',':')).encode()).hexdigest()
request={'request_id':'nonce-001','actor':'agent-01','service':'api-vendor',
 'resource':'https://api.vendor.example/priced','network':'stellar:testnet',
 'asset':asset,'scheme':'upto','max_amount':'1000000',
 'pay_to':payee,'max_timeout_seconds':60,'method':'GET',
 'body_present':False,'body_bytes':0,'body_sha256':hashlib.sha256(b'').hexdigest(),
 'accepted_terms_sha256':terms_hash}
print(ledger.estimate(request))  # informative only
# Operator separately approves exact request and issues a short-lived token:
permit=issue_consent(ck,request,(datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat())
print(ledger.reserve(request,permit))  # atomic spending cap hold BEFORE x402 SDK action
# ORIGINAL wallet/client and resource server now perform normal x402 protocol flow.
# ONLY after authenticated original Stellar RPC finality, privileged observer issues:
attest=issue_finality_attestation(ok,'nonce-001','750000','stellar:testnet/tx-hash-from-original-rpc','a'*64) # substitute TRUE receipt SHA
print(ledger.reconcile(attest)) # reconciles original amount, releases 250000 reserved units
ledger.close()
```

**The snippet is illustrative operator wiring**, not evidence that a live network receipt exists. The `a*64` digest in the snippet is a placeholder to be replaced by an actual independently verified provider receipt hash; never use that placeholder operationally.

The HMAC **issuer and finality watcher are privileged operations**: deploy separately from untrusted agents/tool calls and do not expose them through MCP. Their source-of-truth permission/finality verification, key rotation, ledger/account controls, and external independent checkpoint are additional production tasks. An attacker who obtains those keys or DB admin plus signing authority can forge approvals. Do not claim this module alone enforces Soroban wallet allowances or bank-level guarantees.

### Complete-intent consent boundary (source upgrade, October 10)

This source now requires **15 exact, named fields** for each new consent and reservation. Older eight-field operator permits will fail closed; previously signed consent tokens are not silently upgraded or accepted. Existing already-reserved SQLite entries remain auditable and may be reconciled by the trusted watcher, but an unsettled reservation must not be released merely because the permit format changed. An operator must reapprove a new exact intent and use a new request ID after a rejected upgrade attempt, subject to the remaining budget.

The new fields are `pay_to` (exact eventual x402 recipient), `max_timeout_seconds` (1–86400), uppercase HTTP `method`, boolean `body_present`, integer `body_bytes` (0..1,048,576), lowercase `body_sha256` of the actual request bytes, and `accepted_terms_sha256` of the canonical **complete** x402 `accepts` requirement. The last hash covers original scheme-specific `extra` metadata as well as the visible recipient/network/asset/max/expiry fields. The buyer/operator must compute and compare it against the original live 402 challenge *before issuing consent*, and reject any mismatch between approved terms, the subsequent signer payload, and the reserved request. This module checks the exact owner-approved field values and HMAC but **does not itself fetch a 402, independently verify a seller, or recompute the quote digest**. Caller-invented hashes are not payment verification. The original SF-31 buyer handles the wire challenge and signer; a source-bound, independently authorized integration is still required.

`body_present` keeps absent and zero-length request bodies distinct, and `GET`/`HEAD` must have no body; absent body requires zero bytes and SHA-256 of the empty byte string. The governor rejects unknown fields rather than silently stripping a caller-supplied payee. No Stellar payee-format/trustline/merchant-account validation is implied: original wallet and server SDKs own those checks. The local SQLite journal still stores a cryptographic request digest, not a human-readable payee log; retain the exact approved request in the privileged operator's evidence store for audit.

### Resource URL authority preflight (October 10)

Before issuing a purchase-intent consent, SF-36 now parses the claimed HTTPS resource authority instead of trusting only a `https://` prefix. Absent or malformed DNS hosts, embedded credentials, raw control characters, backslashes, fragments, invalid ports, address literals, legacy numeric/hex IP encodings, local/private DNS suffixes and ambiguous single-label hosts are rejected. A normal public ASCII/Punycode DNS name with a valid optional HTTPS port, path and query is retained *byte for byte* for HMAC identity binding. The extra preflight is aligned with SF-31's default public-resource policy rather than an assertion that text-prefix HTTPS is safe.

This is a **lexical and authority check**, not DNS rebinding prevention, network fetching, external service authentication or an attestation that the subsequent SDK signs identical terms. Operators must still independently validate original 402 terms, exact URL/canonical-host behavior, resolved destination and any redirect prohibition in the live SF-31 signer path. It performs no network or payment action.

### Policy composition with Stellar smart accounts and `upto`

1. Agent asks to call exact paid HTTP/MCP resource; merchant terms supplied through trusted SDK.
2. Buyer risk UI previews `estimate` and, only if consented, operator issues bound permit. `reserve` atomically checks the **signed maximum** and rejects overspend.
3. Buyer wallet builds the canonical Stellar signed auth entries. `__check_auth` smart account limits can further restrict the actual *onchain* authorization, independently of offchain limits.
4. Original x402 resource server submits signed auth entries; facilitator `/verify` and `/settle` ensure correct recipient, amount, expiry, replay and fee sponsorship. `upto` MUST settle no more than original signed maximum.
5. Trusted observer obtains **actual** finality (hash, status, amount) from original provider, signs attestation. `reconcile` cannot verify network by itself; it only enforces offchain reservation/accounting rules.
6. If finality is unknown, **keep full reserve held**. A cancellation notification is not proof of non-settlement; don't free funds on client timeout/restart or duplicate callback.

### Run the single focused behavior check

```sh
python3 focused_check.py
```

This runs only the changed authorization, limits, replay, reconciliation, receipt reuse, exact-versus-upto and tamper-detection paths. It does NOT invoke RPC, create accounts, run GitHub Actions, simulate a chain or claim a paid transaction.

### Known operational gaps (handoff to original product integration owners)

- No network proof fetcher, wallet SDK integration, onchain cap enforcement, trustline lookup, token decimal registry, payment reversal/refund, external journal checkpoint, multi-tenant SSO, automatic key rotation or deployed uptime metrics.
- Production reconnects must establish a new verified finality watcher and authenticated ledger link. A signed operator attestation alone does not prove a transaction occurred; verify actual onchain amount/token/recipient/ledger/network.
- Operational fee spending and `upto` fees must be tracked separately; the policy here budgets **paid resource transfer amounts only**, not facilitator-sponsored XLM transaction fees or vendor platform costs.
- HMAC keys are process capabilities: an agent controlling the process may forge consent. Protect the service runtime and keys using existing authorized custody; this SDK should be hosted behind an authenticated, rate-limited operator service before production use.
- The RFP's presence for SCF Round #46 is not confirmed (current listing is #45); no application/interest form submitted.

**Ownership boundary:** `SF-36` spend governor only. Do not duplicate SF-31 buyer client, SF-32 `upto` Stellar scheme work, SF-29 federation, or SF-38 network conformance. License this original code permissively under the accompanying MIT LICENSE (not AGPL). No GitHub Actions/workflows are added.

## Author an operator policy locally

The policy workbench edits the existing `stellar-spend-governor/v1` configuration
and calls this directory's original `validate_policy()` before offering a
separate download. It does not instantiate `Governor`, open a ledger, read keys,
issue consent, inspect balances, sign, or install the downloaded policy.

From the repository root, start an empty editor:

```sh
python3 stellar/scf-starforge-20261009/sf36-spend-governor/policy_workbench.py --port 0
```

Open the printed loopback URL. To edit an existing operator configuration, add
`--policy /private/operator/policy.json`, or select the file in the page. Nothing
loads the example policy by default. Choose each network and asset explicitly,
then enter all five caps as positive canonical **base-unit strings**. Empty rows
are drafts; the original validator determines whether the complete policy is
valid. The workbench proposes no cap, asset, network or decimal conversion.

The five fields retain their original meanings: `max_single`, `max_total`,
`max_per_utc_day`, `max_per_actor_utc_day`, and `max_per_service_utc_day`. These
limits concern transferred resource amounts per network/asset. They are not
human-readable currency, current remaining capacity, facilitator fees or a
payment authorization. Existing reservations and settled spending still affect
the original governor when the operator separately uses the policy.

Import retains the exact source bytes and their SHA-256. Editing a source row
keeps its unknown metadata; removing that row explicitly removes that row's
metadata too. New rows contain only the chosen network, asset and caps.
Top-level metadata remains intact. Original numeric metadata is handled on the
server without browser or binary-float rounding. Export can change JSON
formatting but preserves metadata values. Duplicate JSON keys are rejected
rather than silently discarding one value.

Select **Validate** after editing, inspect the result, and explicitly download
the separate policy file. Any subsequent edit invalidates that download until
validation succeeds again. A valid configuration says nothing about available
balance, live ledger capacity, recipient trust or approval of a purchase. The
operator remains responsible for choosing and configuring the resulting file
through the existing SF81/SF88 operator path; this page never updates it.

The editor also saves and reopens a browser draft with the original source and
pending row values. A draft is not a runtime policy. Keep source files, drafts
and downloads private; the page uses no browser persistence or remote service.
Stop the local server with Ctrl-C when finished.

The server uses Python's standard library and binds only to `127.0.0.1`. Source
and downloaded policies are limited to 1 MiB and 256 asset rows; a request is
limited to 2 MiB. Failed imports or validation return a clear JSON error without
changing the startup file. A startup failure exits 2 with
`POLICY_WORKBENCH_ERROR`; the browser retains edits after a validation failure.
