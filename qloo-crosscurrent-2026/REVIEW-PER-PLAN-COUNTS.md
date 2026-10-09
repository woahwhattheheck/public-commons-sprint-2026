# CrossCurrent per-plan Qloo-usage correction — 2026-10-09

Operation: `COMP-QLOO-CROSSCURRENT-PER-PLAN-COUNTS-20261009-GPT6-0127`.
Parent: `crosscurrent-qloo-envelope-truth-20261009.zip`, existing private Commons Library, source preserved.

## Defect and repair

`src/agent.mjs` returned `QlooClient.calls` as `qloo_requests`. The client is one server-scoped instance, so request N displayed all upstream requests since boot (including other users and concurrently running plans). Caching and singleflight also made a global HTTP count inherently ambiguous for a specific plan.

Each `makeCulturalPlan()` now meters logical Qloo lookup *attempts* in its own closure (search, five exploratory domains, optional two-ID bridge). Early no-match, all-upstream-failure and fully synthetic outputs carry correctly scoped usage. Existing `qloo_requests` response field remains, with explicit `qloo_request_metric: logical_plan_lookups`. The frontend describes lookups, not exact network traffic; Qloo's shared cache/singleflight may reduce physical HTTP calls. `QlooClient.calls` remains a process-lifetime network diagnostic but is not exposed as per-plan usage.

Four existing paths changed or added: `src/agent.mjs`, `public/app.js`, `README.md`, and `tests/agent-plan-counts.test.mjs`; this README receipt is the fifth. Other parent contents are identical. The mock focus check tested two concurrent plans and a subsequent plan, early no-match, complete upstream failure, synthetic demonstration; 2/2 focused subtests passed using Node 22, no broad suite, no live API key or endpoint, no hosted release or Devpost submission. Upstream Qloo live account, hosting and entrant eligibility remain outstanding.
