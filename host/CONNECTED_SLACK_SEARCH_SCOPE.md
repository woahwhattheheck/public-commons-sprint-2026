# Slack search scope adapter

The existing `connected_slack_pages.cjs` collector remains the reader and page-budget owner. This additive adapter protects its native search boundary when the installed tool's advertised argument form changes. A response headed `Search Results for:` with no expression is a failed search, not evidence that no work, claim, record or prospect exists.

## Existing integration

Use the exact tool descriptor returned by current discovery. `inputSchema`, top-level `parameters`, and nested `function.parameters` descriptors are accepted; each descriptor must retain the exact native binding name. Do not construct a descriptor by unioning old and new inventories.

```js
const {collectSlackPages} = require('./connected_slack_pages.cjs');
const {createScopeCheckedSlackTools, planSlackSearchScopeContinuation}
  = require('./connected_slack_search_scope.cjs');

const checkedTools = createScopeCheckedSlackTools(tools, {
  contracts: discoveredSearchContracts,
  onObservation: (observation, originalResponse) =>
    saveToExistingPrivateCustody(observation, originalResponse),
});
const result = await collectSlackPages(checkedTools, originalRequest);
```

`discoveredSearchContracts` maps each exact binding name to its descriptor. Only supplied search bindings are wrapped. Channel reads, thread reads and every other tool remain inherited unchanged. Native names default to the two bindings already used by the maintained collector; an explicit `bindings` map supports the same functions when a runtime exposes different names.

Each invocation makes zero or one native call. It never discovers tools, searches again, changes account, changes workspace, sends, or starts a schedule. No hidden retry can undercharge the existing native-call budget. A failed custody callback retains the arriving response inside the returned failure instead of silently losing it.

## Argument custody

The adapter accepts the original collector's `query` or `keywords` plus `filters`, and sends only fields advertised by the fresh descriptor. It translates the lexical scope between the two forms and `limit`/`count` where explicitly supported. Two supplied representations must agree. Unknown modifiers, unsupported Boolean translations, conflicting limits and dropped restrictions stop before transport. Empty `natural_language_query` may be omitted when unadvertised; nonempty semantic context may not be discarded.

Numeric timestamp bounds, opaque cursors, channel types, user/channel filters and all other original arguments remain literal. An unsupported field is reported rather than removed or converted into an approximate date window. Required arguments must be present. This is a binding adapter, not a replacement JSON Schema validator; the native tool retains its ordinary type and permission checks.

## Response custody

Supported echo carriers are the native Slack `query` beside `ok`/`messages`/`files`/`results`, and the first renderer heading `Search Results for:`. Text/structured-content envelopes are unwrapped without traversing message bodies. Copied headings inside messages are not scope evidence. Conjunctive term ordering may differ; quoted contents and Boolean ordering are preserved.

Matched responses and native provider failures pass through unchanged. An empty, changed or missing echo returns the ordinary native-error shape understood by `projectSlackReadFailure`: `ok:false`, `isError:true`, `error_code`, `error` and `error_data`. The exact arriving response remains under `native_response`, so the caller can retain it privately and resume the same operation. `require_echo:false` permits an unobserved echo for consumers that independently establish scope; an explicitly blank or mismatched echo still fails.

A scope failure is not a relationship hold, permission denial, empty CRM, or absence of another claim. Existing direct channel/thread reading continues normally.

## One explicit rediscovery continuation

The owner may rediscover the **same** tool after retaining a scope failure. Feed that descriptor and the retained failed response to `planSlackSearchScopeContinuation`. The plan is produced only when the advertised binding and actual native arguments change without losing the original intent. It does not call a tool.

```js
const plan = planSlackSearchScopeContinuation(retainedScopeFailure, freshDescriptor);
const continuationTools = createScopeCheckedSlackTools(tools, {
  contracts: {[plan.tool_name]: plan.contract},
  continuation: plan,
  onObservation: saveObservationAndOriginalResponse,
});
// This is an explicit new call in the caller's existing operation and budget.
// Keep max_pages:1 for the repair attempt, then use a normal fresh-contract
// facade for subsequent ordinary pages after the query is confirmed.
const continued = await collectSlackPages(continuationTools, {
  ...originalRequest, operation: plan.operation, args: plan.args, max_pages: 1,
});
```

The continuation facade permits one exact native call. The existing operation owner persists consumption before reconstructing a facade after a restart; this adapter does not create a second durable ledger. Its second failure records attempt two and cannot generate another repair plan. A second invocation of the same continuation facade makes zero calls. Provider failures and thrown native errors are not converted into scope retries. The original opaque cursor is preserved, never synthesized or replaced with an invented page.

## Focused receiving

`host/connected_slack_search_scope_receiving.cjs` operates the adapter through an instrumented native function with the retained blank-heading renderer shape, then one explicit rediscovery from the structured schema to the legacy query schema. It covers the original query, result-size translation, literal timestamp/cursor preservation, no hidden calls, exhausted recovery, native error passthrough, message-body spoof refusal and callback custody failure. It runs locally and does not contact Slack or any customer.

The public utility and exercise contain generic identifiers only. Live search terms, messages, provider responses and credentials belong in the caller's existing private custody.

## References

Maintained dependency observed at `host/connected_slack_pages.cjs`, blob `3d99cd02f5ddcf48ff3d8c1e423e81da02757404`. The collector invokes `tools[spec.binding](requested)` and already recognizes the native failure shape used here.

Slack documents a required native `query` and echoes it in successful `search.messages` responses: https://docs.slack.dev/reference/methods/search.messages/ . This adapter binds the actually discovered connector contract, not that REST method directly.
