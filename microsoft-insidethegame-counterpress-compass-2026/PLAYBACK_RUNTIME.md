# Incremental match playback and seek

Run the existing product with `node src/server.mjs`. The original session, frame
and EventSource APIs use the faster runtime automatically; there is no new
service, installation step or playback format.

## How the runtime works

The original frame path validated and replayed the entire observed match twice
for every event, then discarded the rival team's rendered overlays. The updated
engine shares one event transition between stateless `derive()`/`makeSnapshot()`
and `createReplayTimeline()`. Playback advances only the newly observed events,
reuses team statistics and localized overlays until another outcome resolves,
and reads rival statistics directly.

An immutable fixture has a checkpoint every 64 events. The existing 1,000-event
ceiling permits at most 16 saved states, including the empty state. Checkpoints
contain active pressure windows as well as finished attempts. Seeking within an
already visited prefix restores the nearest checkpoint and advances at most 63
events, in either direction. A first visit beyond the known prefix processes the
new events normally. The runtime keeps only the current two team projections and
up to eight team/audience/language views; it does not retain every output frame.

The same original event-time rules determine every result: an eight-second regain
is inclusive; only a strictly later event proves expiry; a new loss can interrupt
an unresolved window; an unpressured loss does not become a failed press. Elapsed
time and evidence come only from the requested prefix. Snapshot field names,
ordering, explanations, evidence IDs and outcome denominators remain compatible.

## Viewer and saved-match integration

`live_sessions.mjs` initializes the replay state lazily on the first `frame()`
call, using a private WeakMap keyed by the session's immutable `events` array.
Sessions with the same generated match reuse its checkpoints while keeping their
own IDs and stream lifecycle. Alternating viewers may seek independently.
Cached overlays are immutable; returned statistics are copied so caller changes
cannot contaminate another frame.

An archive-backed session creation path can therefore provide its validated,
immutable original event array and reuse `frame()` directly. It needs no private
timeline-registration hook. The archive owner retains responsibility for its
input validation and session creation. Old `makeSnapshot(events, view)` callers
remain valid. Prefix arrays are copied only for the existing `includePrefix`
seek/step responses, rather than for every streaming frame.

The existing session capacity, expiry, scenario cache, SSE reconnect rules and
provider integrations continue to own their lifecycles. Weak keys let timeline
state be collected once neither a session nor the generated-scenario cache keeps
that event array. This is an explicit CPU/memory tradeoff within those existing
limits.

## Actual source execution on October 11, 2026

Comparison used Node v24.19.0, Linux x64, with the original public source pinned
at `bbf20f2b3b1f2114ea98dc0b351ee3167761dcdc`. The reference engine blob was
`2816857809505a8f262e5d3f7bbc7a1a07c4b54d`; the reference sessions blob was
`05b9df8931b8a1bce37a057fd273aa94af076cab`.

The workload ran each original 90-minute scenario with seed 42, advanced every
event, alternated all eight team/audience/language views, revisited nine earlier
and later cursors in each view, and interleaved a second viewer of the same match.
All **4,087 compared frames** serialized identically after replacing only the
independent random session ID with an empty string. The data came from the
product's unchanged `generateMatch()` implementation. Synthetic football events
are the inputs specified by Microsoft's [official competition rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md).

| Original scenario | Events | Original frame CPU, ms | Incremental frame CPU, ms | Original p95, ms | Incremental p95, ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| High press | 946 | 258.53 | 25.42 | 0.579 | 0.051 |
| Low block | 941 | 231.25 | 14.00 | 0.507 | 0.045 |
| End to end | 942 | 184.62 | 10.38 | 0.371 | 0.031 |
| Late siege | 942 | 201.33 | 10.36 | 0.407 | 0.036 |

Total measured frame-generation time fell from **875.73 ms to 60.16 ms**, about
**93.1% lower** in this local workload. These timings exclude JSON serialization,
HTTP transport and browser rendering; they are not network-latency or leaderboard
measurements. Source loading and session creation were outside the measured
frame calls; the incremental runtime's first-frame initialization was included.

A separate retained-heap measurement completed 64 distinct original matches with
the existing default 64-session limit, then measured live heap after explicit GC
in separate Node processes. The original retained 9,091,808 bytes and the
incremental runtime retained 20,773,320 bytes: about **11.1 MiB additional heap**
for that workload. This is retained JavaScript heap, not peak RSS or a universal
per-session estimate. No session limit was increased.

The original Node HTTP server also completed real loopback session creation,
six forward/backward seek responses, four resumed SSE frames with
`Last-Event-ID` overriding `from`, the original end marker, and deletion with
zero remaining sessions/streams. Returned frames matched the original runtime.
No AI provider request, new test file, hosted Actions run or competition upload
was part of this work.
