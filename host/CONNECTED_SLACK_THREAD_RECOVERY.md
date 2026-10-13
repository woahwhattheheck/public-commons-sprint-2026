# Receive complete native Slack thread content

The maintained `connected_slack_pages.cjs` reader retains the original native
requests and responses and derives its next request from complete delivered
message bodies. It does not treat a cursor hint, page's displayed order or a
provider END sentence as evidence that missing bodies were consumed.

This public edition adopts the complete ES-9960 direction revision 2. The
original generic cursor collector is unchanged. Complete thread receiving uses
the original opaque cursor to establish whether pages move forward or backward,
then verifies timestamp overlaps at the appropriate observed edge.

## Load the current source

`connected_slack_thread_source.json` lists the four full runtime modules, their
SHA-256 identities, this guide, the intake guide and the focused neutral
regression. The publisher's optional source-file helpers use the existing
`connected_sha256.cjs` and `connected_gzip.cjs` in this same directory. Those
helpers are not needed by ordinary thread intake.

In Node:

```javascript
const reader = require('./host/connected_slack_pages.cjs');
```

A connected JavaScript session can evaluate the same complete CommonJS body
with its own `module` and `exports` objects. The reader requires no filesystem
or package installation. Do not print the full module, provider response or
source bank simply to inspect a summary.

## Collect the original selected window

Use the actual parent/channel and exact decimal timestamp strings from the
original native source. A reply permalink's `thread_ts` identifies its parent;
a read addressed only to the child does not replace the containing thread.

```javascript
const request = {
  operation: 'read_thread',
  args: {
    channel_id: selectedChannel,
    message_ts: selectedParent,
    oldest: originalOldest,
    latest: originalLatest,
    limit: 20,
    response_format: 'detailed',
  },
  max_pages: 8,
  timeout_ms: 30000,
};
const received = await reader.collectSlackThreadPages(tools, request, {
  known_message_ts: alreadyObservedReplyIds,
  onResponse: async event => persistOriginalPage(event),
});
await persistReceiving(received);
```

Omit either time selector when it is not part of the original requested window.
A per-call page/time budget permits resumption of that same operation; it does
not silently shorten the selected window. `known_message_ts` is optional and
contains at most 1,000 distinct original reply identities in that same window.

Use native page sizes of about 20 for long coordination threads. Even a request
for 60 can return only 50 rendered reply bodies while its cursor refers beyond
them. A request limit is not a delivered-body count. Never decode that cursor to
advance an incremental highwater or label its unseen interval consumed.

The reader checks the original page's declared reply count and parsed complete
bodies. A mismatched/truncated rendering is retained, its uncertain tail is
excluded, and receiving restarts the original window with at most 20 and at
most half the prior limit. It never follows the truncated response's cursor.
A repeated incomplete prefix or a single incomplete reply remains an explicit
source error, rather than an automatically acknowledged message.

## Reuse a captured response and resume

```javascript
const recovered = await reader.collectSlackThreadPages(tools, originalRequest, {
  initial_capture: {
    request_args: exactOriginalArguments,
    response: retainedOriginalResponse,
  },
  known_message_ts: alreadyObservedReplyIds,
  onResponse: persistOriginalPage,
});
await persistReceiving(recovered);
```

Supply the exact normalized original detailed request including its time bounds.
A retained initial response adds no native call and no invented historical call
time. Continue the full returned receiving object through `retained`:

```javascript
const continued = await reader.collectSlackThreadPages(tools, originalRequest, {
  retained: recovered,
  onResponse: persistOriginalPage,
});
```

Keep raw captures, full receiving state and compact user/model summaries under
different keys. A session's store alone does not survive loss of its environment;
use the original operation's existing private persistence surface. Never copy
private Slack bodies, identity history or credential-bearing responses into
this public source tree.

An awaited persistence callback must finish before another native call. If it
fails, the exact same capture is offered again on continuation. Native 429 and
other failures retain their original typed outcome, cooldown and next request.
Honor that returned timing and resume at a useful work boundary; do not switch
accounts or create polling jobs.

## Direction and legacy continuation

Reply display order is independent of native pagination direction. The reader
probes with the provider's unchanged opaque cursor and observes actual reply
ranges before choosing a timestamp edge. Forward continuation uses the last
complete reply and an overlapping `oldest`; backward continuation uses the
first complete reply and an overlapping `latest`. Each subsequent page must
include its retained boundary reply and advance. The complete original window
is restarted after direction discovery.

Boundary version 2 records how many prior observations belonged to an older
saved intake. Those calls are replayed with their original semantics before one
corrected original-window continuation; original captures and delivered
bookmarks remain usable. A legitimate empty original-cursor terminal page can
end a fully observed chain. A nonempty repeated page cannot establish progress.

`collectSlackPages` remains available for ordinary opaque cursor reads. It
preserves supplied bounds/cursors and has no whole-thread completeness claim.
Do not derive timestamp bounds by decoding a cursor.

## Consume full bodies and retain edits

```javascript
const outcome = reader.visitSlackThreadMessages(received, message => {
  consumeOriginalMessage(message);
});
```

The visitor uses full original body ranges, exact identities and source indices;
it does not project a shortened preview as a complete message. It selects the
last retained observation per identity in the active pass, ordered using exact
integer timestamp arithmetic, and preserves prior observed versions.

By default incomplete receiving refuses before invoking the visitor. Explicit
`{allow_incomplete_thread: true}` exposes only complete observed bodies while
retaining partial coverage. Re-derive state without a provider call using
`projectSlackThreadPages(received)`. For incremental new/edited delivery use the
existing intake described in [CONNECTED_SLACK_THREAD_INTAKE.md](CONNECTED_SLACK_THREAD_INTAKE.md).

## Completion and useful error handling

Completion requires the original requested window, complete recognized page
rendering, an observed END, advancing verified boundaries, every caller-known
and previously observed identity, and at least an earlier first-page declared
count for that same scope. It remains a set of observations, not an atomic
snapshot of a changing Slack thread. Missing later messages are not inferred
to be deletions.

- `PAGE_BUDGET` / `TIME_BUDGET`: persist and continue the same receiving.
- `NATIVE_ERROR` / `NATIVE_EXCEPTION`: retain exact provider outcome and resume
  its original request after applicable cooldown.
- `CALLBACK_ERROR`: persist the same source before advancing.
- `REQUEST_WINDOW_NOT_APPLIED`: preserve the out-of-window response and correct
  the actual source request; do not silently filter it into completeness.
- `NON_ADVANCING_RECOVERY`, `NON_ADVANCING_PAGE` or `CURSOR_REPEAT`: retain the
  concrete source discrepancy.
- `KNOWN_MESSAGES_MISSING` / `DECLARED_REPLIES_NOT_RECOVERED`: recover the
  original bounded gap rather than advancing to a cursor hint.
- `SINGLE_REPLY_RENDERING_INCOMPLETE` / `CAPTURE_INCOMPLETE`: retain the specific
  unresolved original body.

The included focused neutral case exercises declared100/rendered55 and
declared60/rendered50 in both native directions, ordinary cursor compatibility
and a valid empty terminal. No captured conversation appears in the fixture.

## Attribution and publication

The original maintained Commons reader/intake and ES-9960's complete direction
revision are carried forward here with their original APIs. Public adoption
includes the entire runtime closure and consumed guides. Source captures,
customer records and runtime state stay with their original private operation.
This is source ingestion infrastructure, not a second task queue or scheduler.
