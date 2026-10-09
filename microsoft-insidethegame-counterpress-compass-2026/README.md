# Counterpress Compass — original synthetic tactical intelligence prototype

**New, separate Microsoft/Premier League Inside the Game 2026 candidate.** Not PitchPulse or MatchLens and not an update to their source. All fixture names, timing and events are invented. This is a **source-complete local synthetic demo**, not an authenticated Microsoft Foundry request, deployed Azure app, registered human entrant, competition submission, sponsor award, professional tactical evaluation, or use of real Premier League footage/data.

## Product and value

Within the first eight seconds after a club loses possession, Counterpress Compass tests whether a sequence of documented team pressure actions ended in a same-team regain. It keeps the evidence IDs, exact event times and a closed observation window; silence and an incomplete stream do not become a false failure. A compact on-screen cue distinguishes confirmed recovery, observed timeout, and an interrupted observation whose outcome remains unknown. Broadcast viewers can switch between human-friendly captions and fact-dense analyst overlays in English/Spanish, focused on either side. This is **counterpress-window accounting from synthetic events**, not an LLM pretending to understand a match or claiming a tactical causal effect.

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

## Sparse-event outcome accounting

An additional loss for the same team before the current eight-second window closes interrupts the earlier observation. Without a recorded regain, its outcome is unknown; it is neither a confirmed failure nor a success. The interruption cue reports the actual observed duration and includes the new loss ID as closing evidence in both English and Spanish.

`counterpressAttempts` still includes interrupted press attempts. `resolvedCounterpressAttempts` counts only successful regains and observed expiries; `interruptedAttempts` reports unknown outcomes separately. `successRatePct` is the **resolved-window success rate**, with `successRateBasis: "resolved_counterpress_attempts"`; it is `null` if no outcome has resolved. The browser explicitly shows its successes/resolved denominator and the interrupted count. A paired synthetic fixture has one unknown plus one success (1/1 resolved, 100%, one interrupted), versus one observed expiry plus one success (1/2 resolved, 50%, none interrupted). These are accounting examples, not measured tactical performance.

Run only this regression with `node --test test/interrupted.focused.test.mjs`.

The eight-second regain deadline is inclusive. A replay prefix ending at exactly the deadline does not prove expiry: a later consumed event may have the same timestamp and contain a valid regain. Timeout requires an event timestamp strictly beyond the deadline. The focused `node --test test/boundary.focused.test.mjs` fixture compares a clock at 8s (no outcome yet), an appended regain at the same 8s (success), and a clock at 8.1s without a regain (expiry recorded at the 8s deadline).

## Optional Microsoft Foundry AI narrative draft

Optional live drafts are capped at eight admitted requests per rolling hour and one in flight per process; further requests return 429 before provider contact. See [Foundry admission](FOUNDRY_ADMISSION.md) for the retry contract and deployment limitations.

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


## Deterministic judge evidence export

Use **Evidence JSON** or **Evidence CSV** from the replay controls. The server
exports the exact currently selected synthetic event prefix and selected
team/language/audience; it does **not** call Foundry, reveal keys, run a model,
or rely on mutable browser session state. JSON includes the actual event rows,
engine outcome cues, their evidence IDs and exact source-event SHA-256 digest
(`SHA-256(UTF-8 JSON.stringify(selectedEvents))`). The digest is
a reproducibility fingerprint, **not a digital signature** or an attestation of
real-match authenticity. CSV exports the same outcome citations with quoted,
spreadsheet-formula-neutralized fields. No outcome is fabricated when the
prefix contains no complete press window. Source events remain explicitly
labelled synthetic throughout.

A selected event count must be within the bundled fixture length; team,
audience, locale and format are validated server-side. The export endpoint
returns only local synthetic evidence and is never a paid-provider operation.
The one isolated source contract is `node --test test/evidence-export.focused.test.mjs`.
