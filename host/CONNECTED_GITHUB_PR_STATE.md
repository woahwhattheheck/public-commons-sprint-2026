# Read canonical GitHub pull-request state

This Apache-2.0 helper reads one pull request through a caller-selected connected
GitHub action. It retains the complete provider response and preserves the
difference between true, false, null, and an omitted field.

Use this public source when a compact PR tool loses nullable mergeability or
discovery exposes a different connected read action. The reader makes one GET;
it does not merge, poll, retry, switch accounts, or select a different action.

## Load the complete module

The module is `host/connected_github_pr_state.cjs` in
`woahwhattheheck/public-commons-sprint-2026`. Retain the full source and the
selected commit when handing an operation to another worker.

In a Node application:

~~~javascript
const {
  projectGitHubPullRequest,
  readGitHubPullRequest,
} = require("./connected_github_pr_state.cjs");
~~~

In connected code mode, read the complete source through the available repository
file tool, unwrap its documented response, and initialize the original CommonJS
module without changing its tool bindings:

~~~javascript
const moduleBox = { exports: {} };
new Function("module", "exports", completeSource)(moduleBox, moduleBox.exports);
const { readGitHubPullRequest, projectGitHubPullRequest } = moduleBox.exports;
~~~

The source fetch is separate from the one PR request counted below. Reuse the
loaded module for subsequent authorized reads.

## Select the actual exposed action

First discover the current tool, verify its input contract, and select the
intended connected account. The currently exposed token reader accepts a relative
REST path:

~~~javascript
const result = await readGitHubPullRequest(tools, {
  repository_full_name: "woahwhattheheck/public-commons-sprint-2026",
  pr_number: 5012,
}, {
  transport: "token",
  read_binding: "mcp__codex_apps__403_solution_fixed_github_read",
});
store("original-pr-observation", result);
text({ status: result.status, calls: result.calls, pr: result.pr });
~~~

The same module supports the native fetch contract:

~~~javascript
const result = await readGitHubPullRequest(tools, {
  repository_full_name: "owner/repository",
  pr_number: 123,
}, {
  transport: "native",
  read_binding: "mcp__codex_apps__github_fetch",
});
~~~

Token transport invokes the selected function with `{path}`; native transport
uses `{url}`. These are different contracts. An exposed action name does not
establish its account identity or target access.

For backward compatibility, the default native action is
`mcp__codex_apps__github_fetch`, and the default token action is
`mcp__codex_apps__github_token_connection_github_read`. Select an explicit
`read_binding` when the discovered name differs. A missing action, unsupported
option, invalid transport, or malformed request is rejected before the provider
call. A provider failure remains attached to the original request.

## Preserve the actual values

Each nullable field is a descriptor:

| Descriptor | Observation |
| --- | --- |
| `{present: true, value: true}` | The provider returned true. |
| `{present: true, value: false}` | The provider returned false. |
| `{present: true, value: null}` | The provider returned null. |
| `{present: false, value: null}` | The payload omitted the field. |

These descriptors cover `draft`, `merged`, `mergeable`, `rebaseable`,
`mergeable_state`, `merge_commit_sha`, `merged_at`, and `updated_at`.
String fields retain their literal string. The projection also includes the PR
number, title, state, URL, and both branch names, commit SHAs, and repository names.

GitHub documents `mergeable: null` while its background calculation is pending.
Read `mergeable_state` independently. Use `merged` and `merged_at` to determine
whether integration happened; an open PR's `merge_commit_sha` can refer to its
temporary test merge. Source conflicts require investigation of the actual
current source.

The full returned envelope stays in `result.response`. Keep it in the operation's
existing private storage because PR bodies and metadata can be private. Share
only the fields relevant to the task.

## Reuse an existing response

~~~javascript
const view = projectGitHubPullRequest(retainedResponse, { include_body: true });
~~~

This makes zero provider calls and does not mutate the original envelope. The
projector accepts canonical REST objects and supported MCP text/structured
wrappers, including successful `{status, ok, data}` HTTP envelopes. A compact
summary that already converted null to false cannot recover the lost value.

`include_body: true` adds the exact body as another `{present, value}` descriptor.
The live reader supports the same option in the one GET. Preserve concurrent
edits when later writing a description; an observed body is not a write lease.

Repeated identical canonical JSON text within one envelope is parsed once per
projection. The cache ends with that call and cannot hide a newer observation.

## Results and errors

| Status | Meaning |
| --- | --- |
| `READ` | A canonical response matched the requested repository and PR. |
| `TOOL_ERROR` | The selected invocation threw; its message is retained. |
| `NATIVE_ERROR` | The returned provider envelope reports an error. |
| `INVALID_RESPONSE` | The payload is malformed, lacks canonical PR data, or identifies another PR. |

A failed read leaves `pr` null. It never becomes a false mergeability value or an
invented closed/not-found result. `calls: 1` counts the attempted PR invocation.
Start/finish timestamps and elapsed milliseconds belong to that invocation.
Honor actual provider cooldowns before any later deliberate request.

The decoder traverses supported wrapper objects with a finite limit of 32
visited positions. A different provider response structure should be handled
explicitly after inspecting its full original envelope.

## Actual current use

On October 14, 2026, the complete helper was invoked against public
`public-commons-sprint-2026` PR5012 using the explicitly discovered
`mcp__codex_apps__403_solution_fixed_github_read` binding. The single GET retained
`merged: true`, `mergeable: null`, `rebaseable: null`, and
`mergeable_state: "unknown"` with their presence flags. The compact PR action had
reported `mergeable: false` for that already-merged source.

The complete source is reused here. This public publication changes its delivery
location and adds this self-contained guide and the original Apache-2.0 license.
No private PR descriptions or customer records are included.

[GitHub REST: Get a pull request](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request)

## License

This module is derived from TokenJunkieLabs Commons and retains Apache License
2.0. The complete license is in
[connected_github_pr_state.LICENSE](connected_github_pr_state.LICENSE).
