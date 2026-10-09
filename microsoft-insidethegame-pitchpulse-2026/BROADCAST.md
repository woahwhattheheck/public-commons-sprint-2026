# PitchPulse broadcast-safe presentation view

The original Microsoft *Inside the Game* candidate can now render a **read-only**, 16:9-friendly evidence graphic at `/broadcast`. It is a local preview made from *fictional, synthetic* match events — not an authorized Premier League feed, real-time provider data, or official contest submission.

## Capture workflow

1. Run `node server.mjs` in an authorized local Node 22 environment. Open `http://127.0.0.1:8789/` and `http://127.0.0.1:8789/broadcast` in **two tabs of the same browser profile**. In that profile both tabs share the PitchPulse session cookie.
2. Advance, import or restart the synthetic event replay in the main tab. The graphics tab polls the *same read-only* `GET /api/state` endpoint every 1.5 seconds and updates scoreboard, active highlight and traceable evidence. Nothing writes to the event ledger from this view.
3. Capture that graphics *tab/window* in an authorized demo recording or window capture. For an OBS browser source, independently isolated browser profiles do **not** share cookies/session; use window capture of the authenticated original browser profile instead. No public multicast or cross-session state is provided.
4. Select `/broadcast?audience=fan&favorite=Valley%20FC` for the fictional club fan's view, or use `audience=analyst`. Press `C` to switch high-contrast display. Browser fullscreen is an optional browser action, not a server action.

The safe area uses generous margins at 16:9, responsive layout, explicit evidence IDs/rule names, and a persistent **SYNTHETIC REPLAY · NOT LIVE** label. Only overlays whose `expiresAtSecond > clockSecond` are displayed as current. Historical/expired overlays remain exclusively in the main application's ledger, never masquerading as live highlights. If the state API fails or the browser is hidden, the image is marked **STALE / FROZEN**; it must not be treated as current. In-process sessions expire if idle for 30 minutes, and server restart resets the current state.

**Privacy and spend:** this graphic issues GET requests only, sends no telemetry, creates no model narration and accesses no credential. Static assets are allowlisted in `server.mjs` and retain the existing CSP, cache-control and frame-ancestor restrictions. Optional Microsoft Foundry narration remains a separate explicit, budgeted main-tab operation.

**Focused optional check:** `node --test tests/broadcast.focused.test.mjs`. This is a tiny local HTTP contract only, not a browser render certification, Azure deployment, OBS integration, or judge-accessible hosted proof. The project still needs a true Azure/Foundry demonstration, eligible registration, publicly accessible working demo and a video under two minutes for official submission.
