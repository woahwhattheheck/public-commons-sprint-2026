# Hearthline architecture

## Components

```text
Alexa+/MCP client
      |
      | MCP 2025-11-25 Streamable HTTP
      v
+---------------------------+
| transport/session fence   |
| /mcp POST + GET(405)      |
| Origin + protocol checks  |
+-------------+-------------+
              |
              v
+---------------------------+       +-------------------------+
| mission orchestrator      |<----->| atomic JSON state       |
| plan / approve / execute  |       | missions / receipts     |
+-------------+-------------+       +-------------------------+
              |
     +--------+---------+
     |                  |
     v                  v
NWS read adapter     local demo adapters
(active alerts)      (inventory/outbox/handoff)

MCP App host <---- ui://hearthline/mission-dashboard.html
```

## Two different session concepts

MCP HTTP sessions are ephemeral transport state and can end at any time. Hearthline missions are application state and deliberately outlive MCP sessions. That makes a command such as "continue the storm-prep mission from yesterday" meaningful after a client reconnect.

## Approval generation

An external-commit action cannot jump from `awaiting_approval` to `complete`.

```text
awaiting_approval --(mission id + action id + current planHash)--> approved
approved --(idempotency key)--> complete + durable receipt
```

Every approval and execution recomputes the mission plan hash. This prevents a confirmation made against an older visible plan from silently authorizing a later generation.

## Provider contract

Read providers return bounded, sanitized data. Write providers should have two phases:

1. **prepare** — produce the exact external effect as a preview artifact;
2. **execute** — require explicit approval plus idempotency key and return a durable provider receipt.

The current shopping adapter intentionally implements only a handoff artifact, not merchant execution.

## Transport choices

Hearthline responds with JSON on Streamable HTTP POSTs. The MCP spec permits a Streamable HTTP server that does not expose an unsolicited SSE stream to return HTTP 405 on GET. This keeps the first version compact while still satisfying the 2025-11-25 transport contract. Stateful mission behavior is in application storage rather than depending on long-lived SSE connections.
