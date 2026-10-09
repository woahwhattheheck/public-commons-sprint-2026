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
- `POST /api/explain` — ONLY explicit opt-in Microsoft Foundry model-draft request if server is configured.

## Microsoft Foundry optional enrichment

Documentation: https://learn.microsoft.com/en-in/azure/foundry/openai/latest?view=foundry . Set `FOUNDRY_ENDPOINT` to your trusted Azure resource origin ending `.openai.azure.com` or `.services.ai.azure.com`, `FOUNDRY_DEPLOYMENT` to its deployed model name, and `FOUNDRY_API_KEY` in the server environment. The click handler then invokes the published `POST /openai/v1/chat/completions` API. Default/replay mode makes **zero model calls** and **no costs**; the browser never receives the key. Model output is labeled unverified draft, not automatically inserted as facts. No real tenant/provider has been called or configured in this source run.

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

## Actual competition readiness

Official rules: https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md . Registration by **Oct 20, 2026 noon PT**; submission by **Oct 27, 2026 11:59pm PT**. Entry must be a *new* entrant-owned original project, use the Microsoft/Azure platform meaningfully, present synthetic match intelligence, have a public GitHub repository URL, a working installable/testable app, and a public demonstration video under two minutes with real running footage. An authorized eligible entrant must register/submit and accept official terms. Stage-one and judging criteria apply. Prototype currently needs **real Azure/Foundry configuration + verified response, public judge-accessible deployment, short video and owner submission** before claiming entry readiness. The sponsor advertises total ARV $14,800–$59,200 contingent on winning human team sizes; monetary portions are specified as e-gift cards rather than settled cash. No award is guaranteed.

No real football footage/trademarks or copyrighted data used. MIT project license for original code; contest terms still govern any actual entry.