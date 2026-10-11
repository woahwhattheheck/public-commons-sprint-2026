# Paid request lifetime

The existing SF30 seller now joins application cancellation, request capacity,
and shutdown into one lifetime. It still delegates every payment decision to the
original native x402 server; this is not another payment implementation.

## Configure and use

Set `handlerTimeoutMs` in the existing seller JSON (default **30000**, integer
**1–300000**). `serve.mjs`, `upstream-serve.mjs`, and embeddings using
`startSellerService({ config, ... })` share this setting through the original
reader/runtime. The low-level constructor also accepts it directly:

```js
const resources = createSellerResourceHandler({
  compiled, nativeServer, handlerTimeoutMs: 15000,
});
```

Every application handler receives `context.signal`, an `AbortSignal`. Pass it
to cancellation-aware I/O and check it before expensive or irreversible work.
For example, a merchant-owned handler can pass `signal` to Node's `fetch` using
its existing fixed, trusted backend URL. Never forward the buyer's payment or
credential headers to that backend. The existing upstream adapter can consume
this same signal without changing its native payment path.

A disconnect aborts with `name: "AbortError"`, `code: "CLIENT_DISCONNECTED"`.
The application deadline aborts with `name: "TimeoutError"`,
`code: "APPLICATION_TIMEOUT"`. The deadline starts when the handler starts;
it is separate from admission, request-body, and shutdown limits.

## What happens at each boundary

| Boundary | Behavior |
|---|---|
| Abandoned before verification | No native payment entry. |
| Verification finishes after disconnect | Do not invoke the application; invoke the original native cancellation dispatcher once. |
| Disconnect or deadline during application | Abort its signal, cancel through the original dispatcher once, and discard late results. A connected timed-out buyer receives HTTP 504 with `APPLICATION_TIMEOUT` and the native failure-path receipt headers. |
| Native settlement has started | Await that one native result. Disconnect does not start cancellation or a second settlement. No payment operation is raced against an application timer. |
| Handler ignores cancellation | The response/payment continuation stops, but its actual promise still occupies request capacity until it ends. A late rejection is consumed and cannot resume settlement. |
| Shutdown | Stop admission, then wait for both HTTP completion and original dispatch completion. A socket disappearing does not imply that native work finished. |
| Drain grace expires | Close HTTP connections and reject `close()` with `SELLER_DRAIN_DEADLINE_EXCEEDED`. `forcedClose` and remaining `inFlight` stay visible; this is not reported as a clean drain. |

Native cancellation uses the existing SDK's `handler_threw` reason with a
controlled interruption error; handler-returned failures keep `handler_failed`.
It preserves the original `beforeHandlerSettlement` receipt handling. Cancellation
is **not a refund guarantee**, nor proof that already-performed backend side
effects were undone. Applications that mutate state still need their backend's
idempotency/recovery mechanism. This adapter cannot preempt synchronous JavaScript
or forcibly kill a noncooperative handler; retaining its slot prevents cancellation
from becoming a way to bypass the concurrency limit.

Existing `--max-in-flight` and `--drain-grace-ms` settings remain unchanged.
`lifecycle.snapshot().inFlight` now counts resource attempts until **both** their
HTTP response and original dispatch finish. These are request counts, not payment
or revenue totals. Challenge-only mode remains unpaid and never runs a handler.

## Focused local exercise

From the repository root, using Node 22+:

```sh
node --test stellar/scf-starforge-20261009/sf30-seller-sdk/test/handler-lifecycle.test.mjs
```

This runs the original compiler/router/resource handler and lifecycle over real
loopback HTTP, including a real signal-cancelled backend request. The native
payment interface is an explicit test double; the exercise neither creates a
wallet nor verifies or settles a real payment. It covers late completion,
verification/handler/settlement disconnects, native cancellation failure, overload,
clean drain, forced drain, and unchanged successful/error/challenge responses.
