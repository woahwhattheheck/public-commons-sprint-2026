# Counterpress Compass: Evidence-linked film room

**Match data:** This product consumes the existing deterministic synthetic events through the original `src/engine.mjs`, `src/live_sessions.mjs`, `src/server.mjs` and session-scoped HTTP/SSE endpoints. Microsoft’s [2026 official hackathon rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md) explicitly require football-realistic synthetic data. There is no licensed Premier League feed or video in this demo.

## Start and use the actual experience

From `microsoft-insidethegame-counterpress-compass-2026` on Node 22+, run `node src/server.mjs` and open the local printed address. Pick a scenario and seed. Press **Play**, **Next event**, or use the scrubber. These controls replay the original session fixture. Changing the focal club and Casual/Analyst or English/Spanish modes uses the existing native `/api/sessions/:id/frame` snapshot. No optional Microsoft or Opus API is required for film-room operation.

1. Choose your club. The **key moments** list shows only its completed original eight-second counterpress windows (an interrupted window remains unresolved).
2. Filter completed moments by outcome and match half (00:00–44:59 first half, 45:00 onward second). The filter never changes the original scores, stats, event stream or outcome derivation.
3. Select any recorded key moment, including with keyboard Tab/Enter. **Press evidence** displays the exact original source event IDs in chronological order, observed timestamps, player/type/zone, the official outcome reason and the next *observed* match event. A following pass/shot is context, **not** proof of a caused clearance or chance.
4. Press **Replay this outcome** to request the precise original frame prefix, not a manufactured snapshot. The standard match link then points to that paused position. Expired windows jump to the *first subsequent event that actually establishes the eight-second watermark*, not an invented expiry frame.
5. Filter the **live feed** independently by both/focal/rival teams and recorded event type. Match-half selection also applies. Underlying timeline, stats and replay provenance remain unchanged.

## Source semantics

The native `derive(events)` recognizes loss → same-team pressure → same-team regain no later than eight seconds as success. No regain may be inferred from silence. A window with pressure expires only when a later timestamp strictly proves the eight-second period elapsed. Another loss before resolution interrupts the old window with **unknown** outcome. Evidence contains the exact `eNNN` identifiers returned in `makeSnapshot(...).overlays[].evidenceIds`; the browser never substitutes its own model. Half segmentation is at 2700 seconds of the same 5400-second match.

**Original-source exercised on 2026-10-11:** `src/engine.mjs` parsed the *actual* `data/events.json` 15-event original fixture in JS runtime and evaluated all 16 event prefixes for both teams. It found Harbor FC success windows `e002` and `e010`, Metro Rovers expired window `e007`, and verified all three evidence-ID chains and replay-frame indexes against the native source. These are fixture exercises, not external match data, Microsoft judge approval or an actual browser acceptance recording. The browser app JS was syntax-compiled after edits. No GitHub Actions job, paid model call or submission was used.

## Integration boundaries

This is an additive film-room extension of the existing `web/app.js`, `web/index.html` and `web/style.css` only. It does not alter event generation, Microsoft Agent Framework bridge, session recovery, time-series evidence engine, optional Foundry, seller payments or the competition submission. The original runtime remains the source of truth for frame, team, zone, player and eight-second window statuses.
