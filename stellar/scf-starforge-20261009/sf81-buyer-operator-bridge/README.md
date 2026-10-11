# SF81 — one operator-approved buyer flow

Node 22+ / Python 3.10+ / POSIX. No new dependencies or hosted CI.

Connects SF31's HTTP buyer directly to SF62 terminal review, SF54 complete-intent
mapping, SF59 fresh-reservation enforcement and SF36's durable SQLite ledger.
The manual intent-file handoff is gone: the exact HTTP challenge reaches the
existing operator review, then a fresh reservation resumes the original signer
and one signed retry. The original modules are imported, not copied or rewritten.

The default also consumes the peer's merged `createPublicHttpsFetch`: public-IP
validation and pinning at connection time, verified HTTPS on port 443, and no
redirect or automatic retry. An explicit `fetchImpl` is a trusted-host seam only;
replacing it replaces those transport protections.

## Trusted-host usage

Keep the existing owner-managed SF36 policy, persistent ledger and original
`SF36_CONSENT_KEY_B64`, `SF36_AUDIT_KEY_B64`, `SF36_OPERATOR_KEY_B64` values.
Do not create a new ledger to bypass existing pending reservations. The configured
actor and service are verified host identities, not merchant-supplied fields.

```js
import { OperatorApprovedBuyer } from './bridge.mjs';

const buyer = new OperatorApprovedBuyer({
  operator: {
    python: '/usr/bin/python3', // actual trusted absolute interpreter path
    actor: 'operator-assigned-agent',
    service: 'operator-verified-api',
    policy: '/private/operator/policy.json',
    ledger: '/private/operator/buyer.sqlite',
    environment: process.env, // original SF36 keys, in the trusted host only
  },
});

// The following values come from the existing wallet/operator application.
const result = await buyer.call({
  intentId: operationId, // stable across recovery of THIS operation
  url: selectedOriginalResourceURL,
  method: selectedOriginalMethod,
  body: exactReplayableBody,
  expect: ownerReviewedPaymentTerms,
  sign: originalSchemeSigner,
  signal: cancellationSignal,
});
// Original SF31 status, receipt and response stream are preserved.
// operatorReservation is the native result, or null for free delivery.
```

`expect` retains SF31's explicit network, asset, payTo and maxAtomic base-unit
string, plus optional timeout/flow constraints. This bridge retains the original
`exact`-only flow and SF36's supported networks/amount ranges; it does not add
`upto`. `buyer.discover(...)` uses the unchanged original SF31 discovery API.

The existing operator prompt displays complete accepted terms, URL, method,
body hash/byte count and native budget estimate. Both review and typed
`APPROVE <digest>` answer use `/dev/tty`, never the JSON pipe. Only a *fresh*
reservation resumes signing; no new approval policy is introduced.

## Recovery and operating boundary

Use one stable ID per intended operation. Repeating an already reserved ID does
not permit a second signed attempt; assigning a new ID means a new operation,
not recovery. The wrapper preserves original SF31 errors and `paymentSent`.
When received, `operatorReservation` is attached to the result or error; retain
this association in the existing privileged operation log.

A denied review, timeout, cancellation, missing terminal, competing review or
invalid result returns an `OperatorBridgeError` with `intentId`. When available,
`operatorReason` explains the native denial. A broken pipe or timeout may occur
**after the reservation committed**. Inspect the original ledger; never release
capacity automatically or retry under a replacement ID. Original trusted finality
reconciliation remains responsible for settlement. A seller's HTTP 200 without
a receipt remains `PAYMENT_OUTCOME_UNKNOWN`, not a confirmed payment.

Approval is single-flight per Node process and nonblocking-locked per ledger
across SF81 processes. Use one review console per terminal: different ledgers
and unrelated processes do not share this lock. No SQLite transaction is held
while the operator reviews. Cancellation is checked before and after the signer.

This is a **trusted operator component, not an untrusted agent API**. Parent,
interpreter, checkout, policy, ledger, terminal and signer must already be trusted.
A subprocess is not isolation from its parent, and an automated TTY is not proof
of human consent. Keep the existing operator/agent separation; do not expose
these keys to an agent runtime. Fixed shell-free arguments, isolated Python,
limited key inheritance and input-byte response binding do not replace that
boundary, merchant authentication, the wallet scheme or Stellar finality.
SF36 still needs its independent observer and rollback checkpoints.

## One focused native integration check

```sh
python3 stellar/scf-starforge-20261009/sf81-buyer-operator-bridge/acceptance.py
```

Executes the original modules through a real Node HTTP server, actual Python
controlling TTY and on-disk SQLite WAL. Covers default public-transport pre-DNS
rejection, free delivery, denial, fresh approval, duplicate ID, lost response,
concurrent review, cancellation, timeout and no terminal. The original HMAC
audit returns `JOURNAL_CONSISTENT`; exactly two fixture operations remain reserved.

Disposable keys, fictional terms and an explicit signer-envelope fixture are
used only in this check. The injected HTTP transport maps the unchanged HTTPS
identity to loopback. This verifies the application integration, **not live TLS,
a real merchant, Stellar settlement or customer payment**. Never aim the test's
PTY driver at a real wallet or ledger. No workflow or repository-wide suite runs.

Executed on Linux / Node 22.16.0 / Python 3.13.5. Original byte-matched source:

| Module | Git blob |
| --- | --- |
| SF31 buyer | ebf100349c30cb722151c5c93a94869ddcd286d6 |
| SF36 governor | 9d0a5e58accdf8078b85f42a49561eefb1cda7bc |
| SF54 mapper | 6d61d651b7137ba411d2b24cb69f0639080e1515 |
| SF59 gate | cf84e16d5b36ab5629c36e903879de7a8aea1a84 |
| SF62 console | 9c877d11bcc3e82be18797048772bbbd7439ad40 |
| SF31 public transport | a90e86d4e09f8f31ab2345fd97682aa08933e584 |

First five pinned at `7b8dc0278cdfa13950a7f7999fe5ea182b31e0ba`; peer transport
consumed at `6854ae59855f983feec652a26bef7a30c4522c6a`. Only this new SF81 folder
is changed. Existing modules, policies, wallet source and workflows are untouched.

## Read-only spending workspace

Use SF36's [buyer spend statements](../sf36-spend-governor/STATEMENTS.md) with
this operator's **same** `ledger` and optional `policy` paths. It generates a
private, self-contained HTML workspace or JSON/CSV: settled amounts, unresolved
maximums, whole-ledger capacity and actor/service/day breakdowns. No keys or
provider calls are needed; filters never hide whole-ledger outstanding exposure.
It reads native ledger state, not independently verified chain finality, and
never releases a reservation or authorizes another purchase.
