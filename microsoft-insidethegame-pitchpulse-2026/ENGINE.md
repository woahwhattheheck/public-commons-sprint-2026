# Auditable match-clock projections

This extends the existing fictional PitchPulse engine without changing its default
`snapshot()` contract or invoking any model/provider. It is not a contest entry or
an assertion of live Microsoft Foundry integration.

## Review a historical clock without resetting the match

```js
const historical = engine.snapshot({asOfSecond: 238, audience: 'analyst'});
const live = engine.snapshot();
```

`asOfSecond` must be an integer from 0 through 5400; omitted means the latest
accepted event clock. Seeking does not mutate or trim the accepted event ledger.
All scoreboard totals, control windows, overlays and provenance in the projection
use only accepted events at or before that clock. `acceptedEvents` is the visible
event count in an explicit historical projection. At the latest clock its original
meaning is unchanged. Same-second events remain ordered by ingestion; historical
narration for one event never sees later events at the same second.

`overlays` retains the last twelve historical highlights, as before. The additional
`activeOverlays` and `activeHeadline` distinguish displayable moments from history:
an overlay is active until, but not including, `expiresAtSecond`. An explicit clock
past the latest event lets a reviewer observe expiration and empty rolling windows.
Browser/server integration can pass an optional clock; no new HTTP route is added
by this engine change.

## Explain and reconstruct a number

Every overlay's `proof.metrics` holds each reported count and its exact source
`eventIds`. `proof.eventIds` is their union plus the trigger, in ledger order.
`throughEventId` identifies the last event considered, including same-clock ties.
Cumulative shots/tackles and rolling shots/pressures have separate evidence.
The rolling interval is `(throughSecond - 300, throughSecond]`, ending at that
specific event's ingestion position for an overlay.

Every team's `control.components` includes a value, source IDs and weight for
completed passes, shots, won tackles, high pressures and possession seconds.
Summing `value * weight` and rounding to one decimal reproduces `control.score`.
`control.eventIds` and `eventCount` include all that team's accepted events in the
window, even zero-contribution events. Components include only contributing IDs.
Possession retains the original event-accounting semantics: the whole reported
duration is credited at its event timestamp; it is not an inferred continuous
possession interval. Scores are descriptive, not trained predictions.

## Retry integrity

An identical normalized event ID/payload remains an idempotent retry. Reusing its
ID with different normalized data throws `Event id conflicts with existing event`
without changing state. Corrections therefore require a separately reviewed
replacement/import workflow, not silent rewriting. Stored event records are
frozen so mutating an `ingest()` result cannot alter the ledger. `reset()` clears
the retry index as well as the events. The legacy public `events` array remains
for compatibility; callers must not mutate this internal array directly.

## Focused verification

```sh
node --test tests/engine.focused.test.mjs tests/engine.audit.test.mjs
```

Two existing compatibility checks and four new focused checks cover counted-event
evidence, score reconstruction, same-second ordering/window boundaries, backward
and forward projection, expiration, conflicting retries and reset. No HTTP,
browser, hosted deployment, live provider call or competition submission is
asserted by these engine checks.
