# PitchPulse — Explainable Match Studio (competition prototype)

A **new** zero-dependency Node 22 web app built on October 9, 2026 for the Microsoft + Premier League *Inside the Game* hackathon. All match events, teams and player names are fictional. This is a **candidate, not an entry or a claimed award**.

## Run

    node server.mjs

Open http://127.0.0.1:8789. Press **Next event** to ingest a synthetic event. Switch **Studio analyst / Club fan** and **Following club** to see different grounded explanations; inspect scoreboard and rule-linked overlays. Restart the event ledger to repeat the deterministic replay.

API endpoints:
- `GET /api/state?audience=analyst&favorite=Harbor%20FC`
- `POST /api/next` — add one fixture event
- `POST /api/reset` — clear and rewind synthetic demo
- `POST /api/events` — add one valid event object with `id`, `second`, `team`, `type`, `outcome`, `player`, and `duration` only for possession. Strict ordering, set membership and idempotent event IDs.
- `POST /api/explain` — ONLY explicit opt-in Microsoft Foundry model-draft request if credentials and a nonzero demo budget are configured.

## Microsoft Foundry optional enrichment

Documentation: https://learn.microsoft.com/en-in/azure/foundry/openai/latest?view=foundry . Set `FOUNDRY_ENDPOINT` to your trusted Azure resource origin ending `.openai.azure.com` or `.services.ai.azure.com`, `FOUNDRY_DEPLOYMENT` to its deployed model name, and `FOUNDRY_API_KEY` in the server environment. Also set `FOUNDRY_DEMO_MAX_CALLS_PER_HOUR` to an authorized value from 1 to 24 (default 0 disables all demo calls). The click handler then invokes the published `POST /openai/v1/chat/completions` API. Default/replay mode makes **zero model calls** and **no costs**; the browser never receives the key. Model output is labeled unverified draft, not automatically inserted as facts. No real tenant/provider has been called or configured in this source run.

## Evidence and architecture

- Independent intake: allowlisted teams, event types, outcomes, bounds and clock; replay ID dedupe; no actual match data.
- Analyst: event-sourced score/pass/shots/tackles/pressures and a transparent 300-second control calculation, never purported xG/predictions.
- Narrator: labels each notable moment with exact triggering event, rule and event-time rolling facts, preventing future-event leakage.
- Renderer: synchronized overlays, expiration clock, clear synthetic marker and scoreboard.
- Personalization: two distinct analyst/fan narratives and a chosen club; model-assisted Foundry narrator separately configured.
- Default server bound to loopback only. The example is not a hardened publicly hosted deployment.

## Focused checks

    node --test tests/engine.focused.test.mjs

Two checks cover replay idempotency, proof-linked goal overlay, fan/analyst difference, malformed/out-of-order event rejection and unchanged state after failure. No broad validation suite is included.

## Visitor sessions and replay files

Each browser cookie jar receives an opaque, HTTP-only `pitchpulse_sid` cookie. Different visitors have independent match engines and demo cursors; tabs sharing a cookie deliberately share the same match. The single-process store allows 64 visitors, expires idle sessions after 30 minutes, and returns 503 with `Retry-After: 60` at capacity instead of evicting an active judge. Health checks and static assets do not allocate sessions. A server restart or idle expiry clears in-memory state; this is not account storage.

Use **Export replay JSON** to keep the normalized event ledger and built-in cursor. **Import replay JSON** restores those values only after validating the entire file in a separate engine. Bad JSON, unsupported fixtures, duplicate IDs, out-of-order events, invalid cursors or files above 2 MiB do not replace the existing match. Existing audience/favorite controls remain local display choices, not part of the replay file.

- `GET /api/replay` exports `pitchpulse-replay/v1` with `fixture: "synthetic"`, `events`, and `nextIndex`.
- `POST /api/replay` atomically imports that JSON. Send the cookie returned by the first API response; the browser does so automatically.
- A numeric cursor requires the exact built-in fixture prefix. A custom ledger uses `nextIndex: null`; built-in stepping is disabled until restart.
- A new accepted `POST /api/events` changes the session to custom mode. Duplicate events do not change its cursor. Event bodies remain capped at 8 KiB.

Neither replay endpoint invokes Microsoft Foundry. Browser mutation controls are disabled while a request is in flight. Cross-origin browser mutations are rejected; the reverse proxy must preserve the public Host header. Sessions are not user authentication or a spending authorization mechanism.

## Cloud listener and health probe

Default remains loopback. To run inside an existing authorized container behind HTTPS termination:

    HOST=0.0.0.0 PORT=8789 COOKIE_SECURE=1 node server.mjs

`GET /healthz` returns HTTP 200 JSON without allocating visitor state or calling a model. Supported bind addresses are `127.0.0.1`, `0.0.0.0`, `::1`, and `::`; PORT must be 1024–65535. Do not set `COOKIE_SECURE=1` for plain HTTP local testing. Run one process/replica, or use sticky routing; independent replicas do not share these in-memory sessions.

No cloud instance is provisioned by this change. For a public deterministic demo leave Foundry credentials unset. The process-wide Foundry limiter defaults to zero calls, allows an explicit maximum of 1–24 starts per rolling hour, permits only one call in flight, and counts failed calls conservatively. It returns 429 plus Retry-After when busy or exhausted. It does not enforce currency costs, survive process restarts, or coordinate replicas. Before enabling paid narration publicly, add an authorized gateway and provider-side spending controls; anonymous visitor cookies are not caller authorization.

Focused HTTP acceptance (Node 22, no external dependencies):

    node --test tests/session-replay.focused.test.mjs

Six focused checks cover visitor isolation, replay restoration, invalid-import rollback/custom ledgers, capacity/expiry, the default-disabled global provider budget, and an exact engine-limit replay transfer. No live provider call is used by these checks.

## Judge match-clock review and historical overlay truth

Use the **Review at match clock** slider to inspect any second up to the latest accepted
synthetic event, then **Return to latest**. Moving the slider sends only
`GET /api/state?asOfSecond=238`; it never rewrites or replays the stored events,
changes another visitor's session, or calls Foundry. Scores, control metrics,
source-event IDs, highlight evidence and expiration all project to the chosen
clock. The top match card shows only active highlights; expired ones remain
clearly marked in the historical explainability ledger. Next event, reset and
replay import return to the latest clock. Cloud draft narration is disabled
while inspecting a historical projection, because the model route narrates
the real latest ledger.

HTTP `asOfSecond` accepts a canonical integer from 0 to 5400 exclusively on
`GET /api/state`. Invalid/fractional/signed query values return 422; other
routes reject this parameter. `lastLedgerSecond` reports the actual final
event clock so the browser can seek without projecting future match events.
One focused HTTP regression:

    node --test tests/timeline.focused.test.mjs

It checks earlier clocks, active/expired goals, unchanged replay exports after
scrubbing, malformed parameter rejection and POST-path projection rejection.
No real football data, hosted Microsoft service or official entrant action
is implied by this browser feature.

## Actual competition readiness

Official rules: https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md . Registration by **Oct 20, 2026 noon PT**; submission by **Oct 27, 2026 11:59pm PT**. Entry must be a *new* entrant-owned original project, use the Microsoft/Azure platform meaningfully, present synthetic match intelligence, have a public GitHub repository URL, a working installable/testable app, and a public demonstration video under two minutes with real running footage. An authorized eligible entrant must register/submit and accept official terms. Stage-one and judging criteria apply. Prototype currently needs **real Azure/Foundry configuration + verified response, public judge-accessible deployment, short video and owner submission** before claiming entry readiness. The sponsor advertises total ARV $14,800–$59,200 contingent on winning human team sizes; monetary portions are specified as e-gift cards rather than settled cash. No award is guaranteed.

No real football footage/trademarks or copyrighted data used. MIT project license for original code; contest terms still govern any actual entry.