# Continue a selected Slack thread with its complete source

`connected_slack_thread_intake.cjs` is the working intake for a selected
message, its containing thread, and the next refresh of that same operation.
It composes the existing Slack page reader, native envelope adapter and result
publisher. The returned destination can be passed straight to the existing
message and file publishers.

The intake retains complete native responses privately, resolves the original
selected reply before reading, observes native cursor direction and follows verified timestamp overlaps, indexes complete
message bodies, recovers a shortened page using its original request, and saves
the next read with the same operation. The chronological context includes the
entire retained message bodies and their source locations.

## Start from the containing parent, not just the selected reply

When a task arrives as a work-order reply, retain that reply's exact message
identity and resolve its containing parent before checking sibling claims.
A permalink can name the reply in its path and the parent in `thread_ts`.
An empty read addressed to the reply does not establish that the containing
conversation is empty. Use the existing resolver below; unresolved parent
metadata remains `RESOLUTION_REQUIRED`.

Read the original task/claim window as well as relevant later continuations.
The first search hit or earliest message in a recent suffix is not necessarily
the original still-active source owner. Reconcile actual scope, handoffs and
completed delivery in the existing conversation, then continue complementary
work without introducing a claim-approval gate.

Search can lag a new message or an in-place edit. Refresh a known claim directly
through its containing parent before overlapping it. The default
`new_replies` refresh does not revisit an older edited claim; `mode: 'full'`
revisits the constructor's original window. If the selected initial window did
not include that claim, choose the required bounded parent window explicitly.
Keep earlier observations and the existing operation identity.

Use complete observed decimal strings for `message_ts`, `thread_ts`,
`oldest` and `latest`. Do not round to integer seconds or append invented
fractional digits. Inspect returned timestamps against the original bounds;
retain a historical/out-of-window response as a failed observation and correct
that request using its original exact decimal source. This is a targeted
source correction, not a whole-channel restart or a fixed waiting period.

## Load the maintained modules

In Node:

```javascript
const reader = require('./host/connected_slack_pages.cjs');
const publisher = require('./host/connected_slack_publish.cjs');
const envelope = require('./host/connected_slack_native_envelope.cjs');
const {createSlackThreadIntake} = require('./host/connected_slack_thread_intake.cjs');
```

In a connected code-mode session, load those same source files into CommonJS
export boxes. Supply `reader`, `publisher` and `envelope` explicitly
as below. The implementation needs no filesystem, browser, URL global, package
installation or additional provider connection.


## Deliver new and edited messages without repeating the thread

Call `delivery()` after the existing read or refresh. Its first call returns the
retained message bodies. Save the returned bookmark with the material you have
actually consumed, then supply that bookmark on the next call. Each later
delivery includes only newly observed messages and changed retained versions,
with their full original bodies, source indices and prior source for an edit.

```javascript
const key = existingOperation.id + '-thread-delivery';
const pendingKey = key + '-pending';
let update = load(pendingKey);
if (!update) {
  update = intake.delivery(load(key) || null);
  store(pendingKey, update);
}
await consumeProjectMessages(update.messages);
store(key, update.bookmark);
store(pendingKey, null);
```

The bookmark carries message/source indices, not another copy of every body.
It must travel with the original intake snapshot; complete native captures
remain in that snapshot. Restoring both resumes the same delivery. Different
operations, missing captures, duplicate message identifiers and foreign source
indices are rejected as mismatched retained data.

For a long initial intake, choose a delivery `limit` and continue until
`delivery_complete` is true. Only bodies actually returned advance the bookmark;
unreturned messages and edits remain pending on the next call.

```javascript
let update;
do {
  update = load(pendingKey) || intake.delivery(load(key) || null, {limit: 12});
  store(pendingKey, update);
  await consumeProjectMessages(update.messages);
  store(key, update.bookmark);
  store(pendingKey, null);
} while (!update.delivery_complete);
```

Both examples retain a pending batch before invoking the consumer and save its
bookmark only after consumption. A resumed caller consumes its retained pending
batch first. If execution stops after consumption but before acknowledgement,
that batch can be replayed; use the message identity and source indices to make
the consumer repeatable. The intake does not acknowledge a delivery automatically,
send messages, classify claims, schedule work or discard any original source.

A repeated capture of the same body, user and message kind does not repeat that
body in the delivery. A changed version names `previous_source` so the caller can
inspect both retained versions. `refresh(..., {mode: 'full'})` observes older
edits; the existing `new_replies` refresh keeps its original overlapping reply
window. Missing messages in a later page are not inferred to be deleted.

`counts` separates newly observed, changed, unchanged, delivered and remaining
messages. `delivery_complete` describes this retained delivery only. The original
reader status, selected window, provider ending marker and cooldown remain
separate fields. Call the existing reader when it has further pages, then
deliver the additional messages from the same bookmark. `context()` still
returns the complete retained conversation.

## Read the selected project's existing conversation

Use the original native search result or a retained rendered reply as
`observedMessage`. Keep its exact channel, decimal message timestamp and
permalink. A native permalink with `thread_ts` or an observed rendered
reply parent resolves immediately. A child-only thread rendering does not
establish that the child is its own containing parent.

```javascript
const request = {
  operation_id: existingOperation.id,
  source_message: observedMessage,
  args: {limit: 20},
};
const intake = createSlackThreadIntake(request, {reader, publisher, envelope}, {
  state: load(existingOperation.id + '-thread-intake'),
  onState: async state => store(existingOperation.id + '-thread-intake', state),
});

let outcome;
do {
  outcome = await intake.read(tools, {max_pages: 4, timeout_ms: 45000});
  // A model turn may yield here. All source and the exact next request are saved.
} while (outcome.status === 'CONTINUE' || outcome.status === 'RECOVERING_CAPTURE');

const context = intake.context();
existingOperation.result_destination = context.destination;
store(existingOperation.id, existingOperation);
store(existingOperation.id + '-current-thread', context);
```

The constructor's request is retained exactly. On resume, supply that same
request and its saved state. `args` accepts an optional `oldest`,
`latest` and initial `limit` from 1 to 100. Omit the time bounds for
the whole original thread. An explicit window remains visible in the context.

The page/time values govern one call to `read`, so a working seat can
yield and continue a long thread without repeating earlier pages. They are
execution budgets, not a limit on the work undertaken.

## Resolve missing parent metadata from an existing search

For a source with no canonical parent, the maintained resolver first consumes
retained searches and then uses its original native exact-message lookup.
Supply existing search collections with `retained_collections` at
construction. A resolution cursor and original captures remain in the saved
state if the lookup needs continuation.

A connector's metadata-only lookup can return an empty result. Use the existing
all-channel lexical search for the task or project, retain that native
collection, and give it to the same intake:

```javascript
const originalSearch = await reader.collectSlackPages(tools, searchRequest);
store(existingOperation.id + '-source-search', originalSearch);
await intake.retainSearch(originalSearch);
const outcome = await intake.read(tools, {max_pages: 4, timeout_ms: 45000});
```

Only the exact selected channel and message timestamp can supply its parent.
The parent comes from the maintained projector's native permalink/reply
reference. Search ranking, a link mentioned inside a body, or another message
about the same project cannot redirect the operation. Continue a search cursor
with its original selectors; a broader lexical search is a new retained
collection.

## Source, capture recovery and current context

Each capture retains the original `readSlackResultThread` result,
including resolution, native response pages and cursor metadata. If the native
tool supplies a `{text: JSON-string}` envelope, the existing adapter
provides the collector view and the original envelope is retained beside it.
Already supported envelopes pass through unchanged.

The intake saves that capture before deriving message context or advancing
the cursor. A saving callback error propagates with the complete state still
available from `snapshot()`. Resume the saved pending capture or save
the current snapshot and continue; the retained page is processed before
another provider read.

A shortened native response can declare more replies than it renders. The
maintained projector identifies that discrepancy even when the provider says
there are no more messages. It retains only bodies closed by the next complete
header; the final visible reply stays in the raw capture until its complete body
is received. The maintained whole-thread reader discards the opaque cursor and restarts the
original selected window with a smaller page. It requires a complete rendered
cursor chain, every caller-known selected reply, and at least the reply count
already declared for that window. An END page that merely repeats earlier
replies cannot complete the intake. Per-page overlap recovery remains recorded
with its original capture as historical evidence; it does not certify the
whole original window. Original captures, the selected window and the exact
whole-thread next request remain separate.

Supply `oldest`, `latest` and message identities as their original decimal
strings. Integer strings are rejected before a native read; the intake never
silently turns an old integer request into a different historical request.
A direct native capture made with invalid bounds remains original source
evidence and needs an explicitly selected valid request. The projector also
reports replies outside valid supplied bounds. Such a response remains in its
capture with the count/window diagnostics, reaches `CAPTURE_REQUIRES_SOURCE`,
and contributes no usable message bodies. A provider end marker cannot override
that refusal.

Native failure envelopes retain their typed error and retry timing. An observed
HTTP 429 with a numeric provider delay also saves its original observation time
and `cooldown.not_before`. Reopening the same intake during that interval returns
`PROVIDER_COOLDOWN` with zero additional native calls. The saved original request
becomes readable after that time; the helper does not sleep or schedule a retry.
Canonical-parent resolution and thread reads share that same operation state.
A page
with unknown pagination retains its own original request for recovery. Neither
a failed read nor an empty child-only rendering advances the operation to a
completed parent thread.

`context()` reconstructs all indexed bodies directly from retained
source pages. Message identities appear once in chronological order, while
`observations` retains every source occurrence across overlapping
pages and later refreshes. The latest observed rendering supplies the current
body; earlier raw renderings remain accessible through the capture index.

Read those bodies to understand current owners, completed work, instructions
and opportunities for another engineering contribution. The intake does not
infer ownership or permission from a transport status.

## Reuse an existing thread collection offline

Give the intake a complete original `collectSlackPages` result already held by
the project. This accepts the existing reader's collection directly, without
another provider connection, source store or replacement reader:

```javascript
const intake = createSlackThreadIntake(originalRequest,
  {reader, publisher, envelope}, {
    state: load(originalRequest.operation_id + '-thread-intake'),
    onState: async state => store(originalRequest.operation_id + '-thread-intake', state),
  });

await intake.retainThread(savedCollection, {
  source: {capture_path: retainedCapturePath},
  original_envelopes: savedOriginalEnvelopes,
});
const context = intake.context();
store(originalRequest.operation_id + '-current-thread', context);
```

The collection keeps its original `finished_at` observation time. If an original
capture carries that time separately, supply it as `observed_at`; the intake
never dates retained content as newly fetched. `source` is optional private
locator metadata, and `original_envelopes` preserves any native envelopes that
the existing adapter wrapped before collection.

The original selected message must already resolve to its canonical parent,
either from its native permalink or the intake's retained search. A new imported
collection belongs either to the current original window from its beginning,
or to the exact saved next/recovery request. A recovered window is compared with
`next_request.args`, including its literal bounds and page size, rather than
with the earlier wider `current_args`. Every page in one collection preserves
that collection's own window and page size. A cursor continuation also joins the
exact saved opaque cursor. Omitting an original bound, changing page size under
an old cursor, or substituting another recovery window is rejected.

The reader still processes every retained page and identifies the original
rendering recovery. Shortened or failed captures retain their continuation and
cooldown. An already accepted byte-equivalent collection is recognized before
frontier validation: replay after a later page or `READY` returns the current
summary without adding a capture, rewinding progress or redelivering bodies.
The original capture, including its full provider response, is the replay key.

Complete imported pages make their context usable immediately. The maintained
whole-thread projection decides whether their full chain reaches `READY` for
the selected window; a page's provider END alone is insufficient. A partial
chain preserves its exact next request for `read`. No native call is counted
for adoption. Adopting the same original collection again reuses the existing
capture; overlapping pages keep every observation while message identities
appear once. Older imported renderings cannot overwrite newer message bodies
or rewind a newer saved cursor/completion state.

When a previously unseen older collection is adopted, its pending capture also
retains `preserved_progress`: the newer logical status, exact next request,
provider-end marker and issue. This is saved with the complete capture before
projection. Finishing or reopening that pending capture first restores its
saved progress, then derives the current whole-thread frontier from the retained
native collections. Only captures joining that exact request/window/cursor
chain can establish completion. Historical overlap captures and their bodies
remain retained and are listed under `thread_coverage.unjoined_captures`; they
cannot rewind or certify a different current chain. A provider cooldown remains
separate evidence and is reapplied after projection. New message observations
are still retained.

`context().observed_at` and `summary().observed_at` identify the latest captured
message source, independently of the time a snapshot was saved. The summary
also reports `adopted_captures` and the actual `native_calls`. Original envelopes
and bodies remain in `snapshot()`; save them through the project's existing
private backing.

After a restart, pass the unchanged original request and saved snapshot to the
same constructor. Pending capture processing, complete offline context, next
cursor and provider cooldown all resume from that record. A `READY` intake's
`read` reuses its context immediately; use `refresh` when the work calls for a
new native observation.

## Refresh and publish through the original operation

After consuming a complete thread, refresh its existing intake:

```javascript
let refreshed = await intake.refresh(tools, {max_pages: 4, timeout_ms: 45000});
while (refreshed.status === 'CONTINUE' || refreshed.status === 'RECOVERING_CAPTURE') {
  refreshed = await intake.read(tools, {max_pages: 4, timeout_ms: 45000});
}
const current = intake.context();
```

Refresh keeps the canonical destination and all retained history. It opens a
new read window overlapping the last observed reply by one timestamp unit,
preserving the original timestamp precision and any original upper bound.
This retrieves newly appended coordination with the same case. To refresh
older edited messages, retain the same operation and request its full original
window:

```javascript
await intake.refresh(tools, {mode: 'full', max_pages: 4, timeout_ms: 45000});
```

`mode: 'full'` uses the constructor's original time bounds and resets only the
read cursor. `mode: 'new_replies'` is the existing default. Both modes preserve
all message observations, source history and the canonical publication
destination. Continue the returned request until the selected window is ready.

After the actual work is completed, use the maintained publisher and its
ordinary continuation records:

```javascript
const published = await publisher.publishSlackMessage(tools, {
  destination: intake.context().destination,
  message: completedWork,
}, publicationOptions);
```

The same destination works with `publishSlackFile`. Keep their send,
edit, file allocation and readback state in the original operation. Reading
or refreshing a thread does not publish, allocate a file or dispatch work.

## Interpreting outcomes

| Status | Retained result and continuation |
| --- | --- |
| `READY` | The maintained whole-thread reader accepted a complete rendered chain to provider END for the selected current window, with its reply-count and known-message checks. Consume retained context and continue the project's work. |
| `CONTINUE` | The exact next provider request is saved. Call `read` again. |
| `RECOVERING_CAPTURE` | The maintained whole-thread reader saved a smaller-page restart of the original selected window. Call `read` again or adopt that exact returned collection. |
| `RESOLUTION_REQUIRED` | Continue the retained resolution cursor or supply the existing lexical-search collection containing the exact selected message. |
| `PROVIDER_COOLDOWN` | The observed provider retry time is saved with the original native failure. Consume retained context and continue the same read after `cooldown.not_before`. Reopening before then makes no additional native call. |
| `NATIVE_READ_REQUIRED` | The native failure or pagination condition and original next/recovery request are saved. Continue when that provider condition permits. |
| `CAPTURE_REQUIRES_SOURCE` | The maintained projector cannot establish a complete chain, or the retained 1,000-native-call bound was reached. Original source and any next request remain retained. Inspect the reported issue; `read` does not silently restart the original request. |

The returned summaries describe retained source and native pagination. They
remain distinct from a stable Slack snapshot or a decision that no work is
available.


## Direction-aware continuation and delivered highwater

This public edition uses boundary version 2 from the complete ES-9960 source.
See [CONNECTED_SLACK_THREAD_RECOVERY.md](CONNECTED_SLACK_THREAD_RECOVERY.md).
Saved older snapshots keep their full captures, operation and delivery bookmarks;
the intake replays the historical call semantics before the corrected original
window pass. Do not trim captured history or change the constructor request to
hide an old incomplete window.

`refresh(tools, {mode: 'new_replies', max_pages: 4})` computes its overlapping
`oldest` from the greatest actual retained reply timestamp, using exact integer
arithmetic and one timestamp tick of overlap. It does not use the cursor's
decoded value or a declared page count. A cursor may refer to a later reply
whose body never arrived. Default to about20 native replies per page for long
work threads; keep all returned full bodies in the private state and print only
selected useful content.

A refresh cannot silently replace an unfinished prior read. Finish or recover
its saved next request first. New-reply refresh covers only the newer overlapping
window. Use the existing full refresh when an older claim/source may have been
edited; retain its prior version and reconcile that change with the same
original operation.

## Consume useful work without repeating coordination

Use bounded `delivery(bookmark, {limit: 8})` batches, retain the pending batch,
and advance the bookmark only after consuming those actual returned bodies.
This makes unchanged coordination disappear from later deliveries while new
exceptions, actual results and edited claims remain visible with their original
channel, parent, message identity and source index.

The reader does not infer that silence cancels a task or that an old claim owns
all work in a project. At the consumer, read the full relevant new/changed body,
join it to its original operation, identify concrete source/result/error and
continue that existing work. Route actual failures or completed output to its
current accepting owner. Preserve full exact source for deeper inspection;
a compact displayed head or generated summary is not the retained message.

Do not print an entire large `context()` or raw tool envelope into a model
response. A message-count limit still permits large individual messages:
inspect metadata first, select complete relevant bodies, and keep unrelated
bodies in the original snapshot for subsequent consumption. A consumer must
not acknowledge unprinted/unprocessed bodies merely because it displayed a
short summary of their batch.

State snapshots, pending deliveries and bookmarks are private operation data.
The public runtime/source manifest contains generic code and neutral examples
only. Use the existing private source store for durable continuation; no new
background watcher, alternate account, message dispatcher or claim registry is
created by this intake.
