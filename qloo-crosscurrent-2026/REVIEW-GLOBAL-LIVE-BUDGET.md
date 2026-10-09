# CrossCurrent server-global Qloo upstream budget — 2026-10-09

Source parent: `/Commons/competitions/Qloo-CrossCurrent/crosscurrent-qloo-per-plan-counts-20261009.zip` (previous independently shipped cumulative Qloo source). Preserve original MIT license, entrant and contributor rights.

## Reproduced design gap

The source's 12/minute request admission is keyed to incoming socket IP. Its `QlooClient` is shared, but the only global upstream protection is a completed-result cache and same-URL singleflight. Distinct searches from different IP addresses still issue unlimited real Qloo GETs. Logical `qloo_requests` is a per-plan metric and cannot be treated as provider quota.

## Implemented behavior

- Local synchronous admission in `QlooClient.fetchOnce` before every real outbound attempt, shared by all plans in one server process; default 48 per 60-second window, host-configurable 1..120. Provider failures still debit the attempted-call budget. Cache hits and same-URL pending requests do not.
- Explicit 429 `QLOO_LOCAL_BUDGET` propagates from cross-domain and second-hop work to `/api/plan` instead of fabricating an empty Qloo result or partial concept. UI explains how to retry or use the fictional mode.
- A public health field describes only the configured budget, not a Qloo key; `.env.example` and README document operator configuration, local-only limitation and the need for cross-instance throttling before distributed production use.
- No real Qloo credentials, network requests or provider quotas were used to validate this work. This does not submit a Devpost entry, establish live API entitlement, or represent prize acceptance/payment.

## Scope and acceptance

Exact member modifications: `src/qloo.mjs`, `src/agent.mjs`, `src/server.mjs`, `public/app.js`, `.env.example`, `README.md`; new `tests/qloo-global-budget.test.mjs` and this handoff. All other source files are preserved byte-for-byte from the parent archive. Focused offline fake-fetch verification only.
