# Review/advisory admission boundaries

The loopback ClaimProof contest demo retains reviewed carts in an in-memory Map for 30 minutes. A review may optionally await external AI advisory before a cart is stored. Without admission bounds, multiple concurrent reviews and repeated requests can exhaust demo memory or consume unbounded provider calls.

The standalone `ReviewAdmission` counter enforces **250 combined saved-plus-pending reviews** and **8 simultaneous pending advisory reviews**. A pending request reserves capacity **before** the advisory awaits. Its reservation releases in a `finally` block even if the model provider fails. Expired saved reviews are reclaimed at admission using the same 30-minute TTL as normal checkout validation. The check is in-process and synchronous: two requests cannot both take the last slot within one Node event loop.

At capacity, `POST /api/review` returns HTTP **429** with an explanation. It does **not** delete valid reviews, approve carts, create orders, capture payments or retry an AI model. The buyer can finish an existing review or retry after an older saved review expires. Existing `/api/create`, `/api/capture`, and read-only `/api/status` remain operable for retained reviews.

This is a single-process loopback demo guard, **not** a distributed rate limiter, quota or production denial-of-service defense. Restart clears both saved reviews and counters. A sandbox provider integration and an actual accepted Devpost submission have not been demonstrated by this change.

Focused isolated check only: `node --test tests/review-admission.test.mjs`. No live PayPal or AI endpoint required.
