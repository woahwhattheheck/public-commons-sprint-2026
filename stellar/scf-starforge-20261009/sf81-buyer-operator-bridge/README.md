# SF81 — one operator-approved buyer flow

Node 22+ / Python 3.10+ / POSIX. No dependencies, workflow files or hosted CI.

This connects the existing SF31 HTTP buyer directly to SF62's human terminal
review, SF54's complete-intent mapper, SF59's fresh-reservation rule and SF36's
SQLite budget ledger. A buyer no longer needs to export an intent, run a separate
console command, and manually translate its result into an approval callback.
The five original modules are imported unchanged.

## Use on the trusted operator host

Use an existing owner-managed SF36 policy, private persistent ledger directory,
and original SF36 keys. Do not initialize a fresh budget ledger merely to bypass
an existing pending purchase. The configured actor and service are verified host
identities, not fields received from a merchant. Supply the original supported
x402 scheme signer from the existing wallet integration.

```js
import { OperatorApprovedBuyer } from './bridge.mjs';

// Configure once inside the trusted wallet/operator application, NOT agent code.
const buyer = new OperatorApprovedBuyer({
  operator: {
    python: '/usr/bin/python3',       // actual trusted absolute interpreter path
    actor: 'operator-assigned-agent',
    service: 'operator-verified-api',
    policy: '/private/operator/policy.json',
    ledger: '/private/operator/buyer.sqlite',
    environment: process.env,       // original SF36_*_KEY_B64 values already set
  },
});

// These values come from your application, not from this example.
const result = await buyer.call({
  intentId: operationId,            // stable across recovery of THIS operation
  url: selectedOriginalResourceURL,
  method: selectedOriginalMethod,
  body: exactReplayableBody,
  expect: ownerReviewedPaymentTerms,
  sign: originalSchemeSigner,
  signal: cancellationSignal,
});
// Ordinary SF31 status, response stream and receipt remain available.
// result.operatorReservation identifies the durable reservation, or is null
// when the original server delivered without asking for payment.
```

`ownerReviewedPaymentTerms` is SF31's existing expectation: explicit network,
asset, payTo, maxAtomic (base-unit string), and optional timeout/flow constraints.
SF31 and SF54 currently accept the `exact` flow here; this does not add `upto`
transport support or extend SF36's supported network/amount ranges. Run discovery
with `buyer.discover(...)` through the unchanged original SF31 API.

The operator sees the complete accepted terms, method, URL, exact body hash and
byte count, native budget estimate and the existing `APPROVE <digest>` prompt.
The prompt and answer use `/dev/tty`, not the JSON pipe or an agent's stdin.
Only a *fresh* native reservation resumes the original signer and one signed
HTTP retry. This is not a new approval policy: it invokes the existing one.

## Failure and recovery

A repeated operation ID does not permit another signed attempt. Use a new ID
only for an independently intended operation, not to retry an uncertain payment.
The wrapper preserves the original SF31 error code and `paymentSent` flag; when
received, the native reservation is attached as `operatorReservation` to the
result or error. Retain that association in the existing privileged operation
log. No signatures, body content, consent tokens or keys are added to this result.

The bridge returns an `OperatorBridgeError` for denied review, missing terminal,
competing review, malformed result, timeout or cancellation. Its `intentId`
identifies the operation to inspect in the original ledger. An available
`operatorReason` explains the native denial. A timeout or broken pipe can happen
**after a reservation was committed**: it never proves no reservation exists.
Do not automatically release capacity or mint a replacement ID. Use the
existing original finality/reconciliation path. This bridge performs neither
settlement nor refunds.

Interactive approvals are single-flight within a Node process and serialized by
a nonblocking private lock for the same ledger across SF81 processes. Use one
review console per terminal; unrelated processes using different ledgers do not
share this lock. A cancellation is checked before and after the original signer.
The helper is terminated on cancellation/timeout; there is no paid retry loop.

## Trust and deployment boundary

This is a **trusted operator application component**, not an API exposed to an
untrusted agent. The parent process, interpreter, imported checkout, policy,
ledger, terminal and signer must already be trusted. The child process is NOT
isolation from its parent: a parent with key access can subvert consent. A TTY
can also be automated; terminal input is not cryptographic proof of a human.
Use the existing protected operator/agent separation rather than placing these
keys in an agent runtime. SF36 still needs its independent finality observer and
rollback checkpoints for its advertised operational guarantees.

The helper uses shell-free fixed arguments, Python isolated mode, limited key
inheritance, bounded JSON framing and byte-digest response binding. None of these
replace seller authentication, DNS/connect-time egress policy, the actual wallet
scheme or Stellar finality. A seller HTTP success without a payment receipt
remains `PAYMENT_OUTCOME_UNKNOWN` under SF31, not a confirmed payment.

## One focused native integration check

```sh
python3 stellar/scf-starforge-20261009/sf81-buyer-operator-bridge/acceptance.py
```

The check executes the actual five original modules, a real Node loopback HTTP
server, Python controlling-terminal review and an on-disk SQLite WAL ledger.
It covers free delivery, denial, fresh approval, duplicate ID, lost signed
response, competing review, cancellation, timeout and missing terminal. The
native HMAC journal is audited afterward. Two fixture operations remain reserved;
neither failed response nor timeout frees budget.

The acceptance driver uses disposable generated keys and fictional terms only.
Its injected transport maps an unchanged HTTPS request identity to loopback;
its signer is an explicitly labeled envelope fixture. It tests the complete
application integration, **not TLS/DNS, a real seller, Stellar settlement or
customer payment**. Never aim the PTY driver at a real wallet or operator ledger.

Source closure executed on Linux with Node 22.16.0 and Python 3.13.5, pinned to
`7b8dc0278cdfa13950a7f7999fe5ea182b31e0ba`:

| Original file | Git blob SHA |
| --- | --- |
| SF31 buyer.mjs | ebf100349c30cb722151c5c93a94869ddcd286d6 |
| SF36 governor.py | 9d0a5e58accdf8078b85f42a49561eefb1cda7bc |
| SF54 intent_adapter.py | 6d61d651b7137ba411d2b24cb69f0639080e1515 |
| SF59 operator_gate.py | cf84e16d5b36ab5629c36e903879de7a8aea1a84 |
| SF62 console.py | 9c877d11bcc3e82be18797048772bbbd7439ad40 |

All original source bytes were matched to those Git blob hashes before execution.
Only this new SF81 folder is changed by the delivery; no copies of the original
modules, new policy or extra dependency tree are added to the repository.
