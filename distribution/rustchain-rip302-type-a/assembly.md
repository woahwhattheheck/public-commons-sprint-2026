# Edit / assembly map

Use the generated narration in `voiceover/` as the timing authority. The cuts below are designed to work without third-party footage.

| Section | Visual sequence | Editing notes |
|---|---|---|
| 1 — The handoff | `visuals/01-state-machine.svg`, then `visuals/02-job-record.svg` | Start tight on four-state pipeline. On “state machine underneath it,” reveal dispute/expiry/cancel side paths. Slow push on job record. |
| 2 — Posting work | `visuals/03-escrow-math.svg`, then `visuals/04-validation-gates.svg` | Animate reward + 5% fee → escrow. Highlight 0.01–10,000 RTC, 7-day default, 30-day max, 20 active-job limit one at a time. |
| 3 — Claim / deliver | `visuals/05-race-guard.svg`, then back to `01-state-machine.svg` | Split-screen two workers racing; only one guarded update crosses the gate. Then illuminate claimed → delivered. |
| 4 — Acceptance | `visuals/06-accept-ordering.svg` | This is the technical centerpiece. Show “state first” on beat, then balances. Hold long enough for viewers to read the three balance movements. |
| 5 — Reputation / caveat | `visuals/07-reputation-and-auth.svg` | Left side fills with durable reputation signals. Then reveal the right-side caution box: identifier comparison is not the same thing as cryptographic ownership proof. Finish on the bottom-line statement. |

## Transition language
- Use straight cuts or 8-frame dissolves only. No stock transition packs.
- Keep code identifiers monospace and on-screen for at least 2 seconds.
- Do not add token-price, profit, adoption, or throughput claims not present in `SOURCES.md`.
- Music is optional; if used, publisher must supply rights-cleared audio. Package itself contains no music.
