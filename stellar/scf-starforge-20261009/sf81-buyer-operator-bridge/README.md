# SF81 — one operator-approved buyer flow

Node 22+ / Python 3.10+ / POSIX. No new dependencies or hosted CI.

Connects SF31's HTTP buyer directly to SF62 operator review, SF54 complete-intent
mapping, SF59 fresh-reservation enforcement and SF36's durable SQLite ledger.
The operator can review the live payment challenge in the commerce browser or
the original terminal. Both paths authorize the same mapped request and fresh
reservation before the original signer continues with one signed retry.

The [commerce workspace](../sf66-demo-launcher/COMMERCE_CONSOLE.md) supplies the
complete browser interaction. An existing trusted host can embed the shared
browser approval broker described below. Standalone callers continue to use
terminal approval unless their trusted host explicitly selects the broker.

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

In terminal mode, the original prompt displays complete accepted terms, URL,
method, body hash/byte count and native budget estimate. Review and the typed
`APPROVE <digest>` answer use `/dev/tty`. In browser mode, the host renders the
same SF62 review and forwards an explicit decision through the private broker.
Only a fresh native reservation resumes the existing signer.


## Browser approval in an operator host

The browser broker is host infrastructure for the same approval callback. The
merchant's HTTP 402 response supplies the live accepted terms; the original SF54
mapper and SF62 review supply their canonical request digest. The host's operator
page presents that review and budget estimate, then exposes **Approve** and
**Reject**.

`createBrowserApprovalBroker({directory})` creates an operator-owned broker in an
existing absolute host directory; omit `directory` to use the host's temporary
directory. Its `environment` carries `SF81_APPROVAL_SOCKET` and
`SF81_APPROVAL_TOKEN` for the host's original buyer child. The socket uses the
local Unix transport. Keep those values in trusted process configuration; the
operator page receives the review through its existing authenticated host API.

The broker's public interface is:

| Method or value | Purpose |
| --- | --- |
| `environment` | The socket and token settings selected by the trusted host |
| `snapshot(intentId)` | Read the current review and decision state for that original intent |
| `decide({intent, approvalId, requestSha256, decision})` | Submit lowercase `approve` or `reject` for the displayed review identity and digest |
| `revoke(intentId)` | End the selected intent's pending review when its original operation is interrupted |
| `close()` | Close this broker with its owning host |

Use the broker's actual generated settings with the existing operator keys:

```js
import { createBrowserApprovalBroker, OperatorApprovedBuyer } from './bridge.mjs';

const approvals = await createBrowserApprovalBroker({
  directory: '/private/operator/browser-approval',
});
const buyer = new OperatorApprovedBuyer({
  operator: {
    ...trustedOperatorSettings,
    environment: {
      ...existingOperatorKeyEnvironment,
      ...approvals.environment,
    },
  },
});

// The existing authenticated operator controller reads approvals.snapshot(id)
// and forwards the person's explicit decision to approvals.decide(...).
// Keep buyer.call(...) and its original signer in the same operation lifecycle.
// In the owning host's shutdown handler, await approvals.close().
```

The installed package exposes the original bridge through
`@tokenjunkielabs/starforge-merchant/operator`. The maintained SF62/SF81 source
components contain the same implementation. A trusted SF66 embedding host can
pass its generated transport through
`session.setOperatorApprovalEnvironment(approvals.environment)` before starting
an operation. The owned commerce console creates and supplies its own broker in
its default browser mode.

The shared `browser-ui/approval-panel.mjs` and `browser-ui/approval.css` provide
the live review component for original operator applications. Keep the existing
application's authenticated controller, selected intent and original buyer
lifecycle around that component. Its decision must retain the current review's
approval ID and canonical request digest.

### Read the live review

The review shows the exact request ID, verified actor/service, resource and
method, network, asset, recipient, atomic amount, timeout and body identity. It
also retains the complete accepted terms, their digest and the mapped request
digest. The amount reserved is the merchant's exact accepted amount; a larger
operator spending limit remains a separate ceiling.

Canonicalization belongs to the original Python modules. A host must forward
the displayed `requestSha256` and `approvalId`, together with the selected
`intent`; it must not calculate a substitute digest from a reduced browser
summary. The existing commerce controller supplies these bindings.

The same original SF36 governor checks the current policy and budget when the
operator approves. A displayed estimate explains the review; reserve remains
the atomic authority. The review deadline limits how long that displayed
decision remains actionable.

### Decision and receiving states

| State | Operator meaning |
| --- | --- |
| `AWAITING_OPERATOR` | Read the live terms and choose Approve or Reject |
| `APPROVING` | The original helper is applying the explicit decision |
| `APPROVED` | The original fresh SF36 reservation returned; follow the original buyer's execution and delivery result |
| `REJECTED` | The explicit rejection ended this approval request |
| `EXPIRED` | The review's decision window ended |
| `FAILED` | Read the original operation error and retained ledger association |

Keep the same approval identity when recovering a lost decision response.
Refreshing the page reads that pending or completed review; it does not create
another approval or buyer call. The original inbox retains the payment attempt
and its recovery independently of the broker's presentation.

`checkOperatorChannel` validates the host-selected approval channel. Original
SF88 execution, inbox and customer entry points use that shared preflight.
A broker setting belongs to host configuration, while the saved operator JSON
continues to contain `python, actor, service, policy, ledger`. Workspace loading
keeps the three native governor keys private and preserves the explicitly
selected broker transport through the original child process.

The original `checkOperatorTerminal` remains the direct controlling-terminal
check. An operator choosing terminal mode receives the existing prompt and
typed confirmation in that terminal.

## Recovery and operating boundary

Use one stable ID per intended operation. Repeating an already reserved ID does
not permit a second signed attempt. Recover through the original caller's
retained result or explicit unpaid-continuation API. Where that original API
prepares a linked successor, it retains the earlier outcome and still requires
fresh review and native reservation. The wrapper preserves original SF31
errors and `paymentSent`.
When received, `operatorReservation` is attached to the result or error; retain
this association in the existing privileged operation log.

A denied review, timeout, cancellation, unavailable selected approval channel,
competing review or invalid result returns an `OperatorBridgeError` with `intentId`. When available,
`operatorReason` explains the native denial. A broken pipe or timeout may occur
**after the reservation committed**. Inspect the original ledger; never release
capacity automatically or retry under a replacement ID. Original trusted finality
reconciliation remains responsible for settlement. A seller's HTTP 200 without
a receipt remains `PAYMENT_OUTCOME_UNKNOWN`, not a confirmed payment.

The original operator lock serializes approval for a ledger across SF81
processes. No SQLite transaction is held while the operator reads the review.
Cancellation is checked before and after the signer. Terminal mode also retains
its process-level review exclusion; use one review console per terminal.

This is a **trusted operator component, not an untrusted agent API**. Parent,
interpreter, checkout, policy, ledger, terminal and signer must already be trusted.
A subprocess is not isolation from its parent, and an automated TTY is not proof
of human consent. Keep the existing operator/agent separation; do not expose
these keys to an agent runtime. Fixed shell-free arguments, isolated Python,
limited key inheritance and input-byte response binding do not replace that
boundary, merchant authentication, the wallet scheme or Stellar finality.
SF36 still needs its independent observer and rollback checkpoints.

## Original local integration fixtures

The repository's [acceptance.py](./acceptance.py) and
[acceptance.mjs](./acceptance.mjs) contain the original isolated local transport
and native-governor fixtures. They create their own private policy, random keys
and SQLite ledger, run the original Node HTTP buyer and Python modules, and
supply an explicit local signer envelope. Their Unicode accepted terms and body
identity exercise the original canonical mapping.

Use the current [commerce operator workflow](../sf66-demo-launcher/COMMERCE_CONSOLE.md)
for browser receiving: saved request review, live terms, explicit decision,
original attempt and delivery, interruption and reopening. Keep the original
request/approval identity through that complete journey and read the native
ledger association when recovering a missing result.

## Read-only spending workspace

Use SF36's [buyer spend statements](../sf36-spend-governor/STATEMENTS.md) with
this operator's **same** `ledger` and optional `policy` paths. It generates a
private, self-contained HTML workspace or JSON/CSV: settled amounts, unresolved
maximums, whole-ledger capacity and actor/service/day breakdowns. No keys or
provider calls are needed; filters never hide whole-ledger outstanding exposure.
It reads native ledger state, not independently verified chain finality, and
never releases a reservation or authorizes another purchase.
