# Counterpress Compass — original synthetic tactical intelligence prototype

**New, separate Microsoft/Premier League Inside the Game 2026 candidate.** Not PitchPulse or MatchLens and not an update to their source. All fixture names, timing and events are invented. This is a **source-complete local synthetic demo**, not an authenticated Microsoft Foundry request, deployed Azure app, registered human entrant, competition submission, sponsor award, professional tactical evaluation, or use of real Premier League footage/data.

## Product and value

Within the first eight seconds after a club loses possession, Counterpress Compass tests whether a sequence of documented team pressure actions ended in a same-team regain. It keeps the evidence IDs, exact event times and a closed observation window; silence and an incomplete stream do not become a false failure. A compact on-screen cue emerges only after a confirmed recovery or an observed timeout. Broadcast viewers can switch between human-friendly captions and fact-dense analyst overlays in English/Spanish, focused on either side. This is **counterpress-window accounting from synthetic events**, not an LLM pretending to understand a match or claiming a tactical causal effect.

The five official challenge stages are realized as (1) timed synthetic fixture ingestion; (2) rolling event-time loss/pressure/regain state machine with evidence IDs; (3) conservative explanations with no invented performance claims; (4) timed, machine-readable broadcast cue objects; and (5) two genuinely different audience variants and two languages. New event fixtures may be authored locally with valid schema; the public demo API deliberately accepts **only event prefix counts from the server's own fixture**, avoiding shared-session mutation and arbitrary user uploads. Every browser is independent, so one judge's stepping cannot move another judge's replay.

## Run

Requires Node.js 22+; **no npm install, cloud account, live data, footage, key, or network call is needed for the local demo.**

```sh
node src/server.mjs
# Open http://127.0.0.1:3167
npm run check:focused
```

The fixture contains two evidenced Harbor FC successful regains in 5.0s and 4.0s, one Metro Rovers pressured attempt that expired after eight seconds, and a late Harbor unpressured loss that does not count as a failed press. All values are synthetic and were handcrafted for deterministic validation. `GET /health`, `GET /api/bootstrap`, and stateless `POST /api/analyze` expose structured reproducible evidence and snapshots.

Example:

```sh
curl -s http://127.0.0.1:3167/api/analyze \
  -H 'content-type: application/json' \
  -d '{"count":15,"team":"Harbor FC","audience":"analyst","locale":"en"}'
```

## Optional Microsoft Foundry AI narrative draft

The server includes a real REST integration adapter for a customer-provisioned **Azure OpenAI model deployed via Microsoft Foundry**. Current Microsoft Foundry REST docs describe `POST /openai/v1/chat/completions`. The endpoint, deployment and API key are sourced only from server environment; the endpoint is restricted to HTTPS on the expected Azure OpenAI resource domain. The browser never receives credentials or request details. No model call happens on the replay path; the visitor must click **Request optional Foundry draft**, which may incur usage charges. Provider output is marked UNVERIFIED and can never replace canonical data and event IDs. Failed calls degrade back to the deterministic cue. No actual Foundry credentials were available/tested here, so neither live compatibility nor paid inference is claimed.

```sh
# Only after the original entrant authorizes an existing Azure resource/key/usage budget:
AZURE_OPENAI_ENDPOINT='https://YOUR-RESOURCE.openai.azure.com' \
AZURE_OPENAI_DEPLOYMENT='YOUR-DEPLOYMENT-NAME' \
AZURE_OPENAI_API_KEY='(server-side secret)' \
node src/server.mjs
```

Do not commit `.env`, API keys, or inference payloads containing personal data. Default listener is loopback; `HOST=0.0.0.0` is possible only behind production HTTPS reverse proxy, admission throttling and model expense limits. This prototype has **no hosted public URL**. Production needs proper per-user authorization, provider cost quota/rate limits, access logging policy, resilient service boundaries, Azure Container Apps/AKS deployment, service monitoring and licensed presentation materials. Do not enable optional live inference publicly without them.

## Real contest requirements and next acceptance gates

Microsoft [OFFICIAL RULES](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md) require registration by **October 20, 2026 at 12:00 noon Pacific**, then project submission by **October 27, 2026 11:59 PM Pacific**, a public GitHub repository, a **sub-two-minute** public video showing actual functionality, a free functioning judge access link/test build, and permitted materials. The application must legitimately use Microsoft technology and fit one selected prize category. The current source is sufficient for offline product demonstration and an implemented optional Azure connector, not sponsor confirmation, Foundry execution evidence, deployed app, demo video, valid human/team account, or accepted submission. The registered original entrant should reconcile uniqueness/team and prize rights with the existing PitchPulse and MatchLens projects, verify actual model integration and cost cap, publicly publish the independent MIT code if chosen, capture a real on-device video under two minutes, and submit from the authorized account.

Relevant Microsoft Foundry REST spec: https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/chat?view=rest-microsoft-foundry-v1

## Files and attribution

- `src/engine.mjs`: deterministic state machine and evidence-linked view model.
- `src/server.mjs`: stateless judge replay backend, protected local HTTP and optional drafting route.
- `src/foundry.mjs`: opt-in server-only Azure OpenAI/Foundry REST adapter.
- `web/index.html`, `web/app.js`, `web/style.css`: interactive replay, timed overlays, two-persona UI, bilingual explanation and keyboard-accessible buttons.
- `data/events.json`: explicit fabricated match fixture and event provenance.
- `test/engine.focused.test.mjs`: three narrow focused contract checks; no broad suite.
- `package.json`, `LICENSE`: zero dependency runnable Node application and MIT license.

Original 2026 source authored in the TokenJunkieLabs Commons swarm for the owner's competition exploration. Preserve the human entrant's actual legal ownership, rights and collaborator provenance when publishing or entering. All synthetic and brand-neutral art, no real team/player logos, no footage, no sponsor endorsement or implied prize.
