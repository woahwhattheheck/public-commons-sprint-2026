# Native MCP App action controls

The existing `ui://hearthline/mission-dashboard.html` resource now exposes the
mission's local actions directly inside a compatible MCP Apps host. It is not a
second server, browser simulator, or standalone chat client. The existing
orchestrator, approval records, operation IDs, receipts, and persistent store
remain authoritative.

## Use

Open a mission through `hearthline_prepare_storm` or `hearthline_get_mission` in a
host that renders the resource. The host must negotiate MCP Apps `2026-01-26`
and advertise `hostCapabilities.serverTools`. Without that capability the
resource remains readable, with its controls disabled.

Each local shopping handoff or reminder exposes separate steps:

1. **Approve local handoff / reminder** binds the displayed action and current
   plan hash to one durable operation. This does not execute it.
2. **Execute approved local action** uses the operation ID returned by the server.
   Shopping produces `prepared_not_purchased`; reminders remain in the local outbox.
3. **Replay original receipt** repeats the same operation, not a new action.
   The displayed receipt includes the server's digest and replay flag.

**Refresh mission** explicitly reads current durable state. A refusal, invalid
response, or timeout never appears as success. After an uncertain outcome,
mutation controls stay disabled until a successful refresh reconciles the
server state. If an approval committed but its response was lost, refresh
recovers its existing operation ID rather than creating a second approval.
A repeated approval for the same displayed action and plan uses a deterministic
operation ID. The server still validates every operation, action and plan hash.

There are no direct network requests from the resource, automatic approvals,
background polling, or embedded credentials. All calls use standard
host-mediated `tools/call`; responses are correlated to one pending request,
with a 30-second timeout. Parent-frame identity and the negotiated parent
origin are checked. User and server strings are rendered as text, not HTML.

## Focused verification

From `hearthline-alexa-mcp` with Node 20+:

```sh
node test/app-controls.integration.mjs
```

Optional inspectable JSON output:

```sh
HEARTHLINE_APP_EVIDENCE_DIR=./app-evidence node test/app-controls.integration.mjs
```

The four cases execute the **actual embedded UI script** in a Node VM with a
minimal DOM and bridge it to the **existing real tool dispatcher, orchestrator,
and JsonStore**. They cover completing both local actions and exact receipt
replay, a capability-absent host, a host refusal, and a committed approval whose
response is deliberately dropped before timeout/recovery. Weather and injected
host faults are explicitly local fixtures. This is not a browser/HTTP or Alexa
host integration test.

The implementation run on October 9, 2026 passed all four cases on Node 22.16.0.
The normal flow used five tool calls, produced two receipts and exactly one
local reminder outbox entry. Chromium localhost navigation in that container
returned `net::ERR_BLOCKED_BY_ADMINISTRATOR`; no browser-policy bypass was used
and no browser-to-HTTP result is asserted.

The separately coordinated Hearthline browser-host/recording work may load this
same resource and forward its `tools/call` messages. A genuine supported-host
recording, publicly hosted video, entrant account verification and final
competition submission remain separate delivery steps. Existing contributor
and entrant rights are unchanged.

Protocol references:
- https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html
