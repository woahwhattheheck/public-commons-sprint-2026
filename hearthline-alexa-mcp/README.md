# Hearthline — stateful household mission control over MCP

Hearthline is a self-hosted Model Context Protocol server built for agentic household workflows. It turns a goal such as **"get the house storm-ready"** into a durable mission that can span conversational sessions, combine live read-only context with local household state, and hold any external-commit step behind explicit human approval.

The server implements **MCP 2025-11-25 Streamable HTTP** directly on Node.js 20+ with no runtime dependencies. A built-in MCP App (`ui://hearthline/mission-dashboard.html`) renders mission state in compatible hosts.

## Why this is not a basic API wrapper

A single Hearthline mission crosses multiple boundaries:

1. read live public context (currently active U.S. National Weather Service alerts),
2. reconcile that context with durable local household inventory,
3. generate a dependency-aware action set,
4. separate read-only work from external-commit work,
5. require an approval tied to the exact current plan hash,
6. execute approved demo actions idempotently, and
7. leave a durable receipt so a later session can explain what happened.

Approval does **not** mean purchase. The current shopping action deliberately stops at `prepared_not_purchased`; it creates a handoff artifact but has no code path that can place an order.

## Run

```bash
npm test
npm run demo
npm start
```

Default endpoint: `http://127.0.0.1:8787/mcp`

For a remote self-hosted deployment, set an explicit origin allowlist and persistent store path:

```bash
HOST=127.0.0.1 \
PORT=8787 \
ALLOWED_ORIGINS=https://your-host.example \
HEARTHLINE_STORE=/var/lib/hearthline/state.json \
node src/server.mjs
```

Terminate TLS at a trusted reverse proxy. Do not expose a plaintext MCP endpoint to the public internet.

## MCP surface

| Tool | Purpose | External effect |
|---|---|---|
| `hearthline_seed_inventory` | set demo household stock counts | local state only |
| `hearthline_prepare_storm` | NWS alerts + inventory reconciliation + mission creation | NWS read + local state |
| `hearthline_get_mission` | read current mission generation | none |
| `hearthline_list_missions` | recover missions across sessions | none |
| `hearthline_approve_action` | approve one exact-plan action | approval state only |
| `hearthline_execute_approved` | execute an approved demo action with idempotency receipt | local outbox / shopping handoff only |

## Safety and correctness invariants

- **Human-in-the-loop:** all `external_commit` actions start `awaiting_approval`.
- **Stale-plan fence:** every approval/execution rotates the mission `planHash`; the next approval must re-read state.
- **Idempotency:** duplicate execution keys replay the original receipt instead of repeating work. Reusing a key for a different action fails closed.
- **No purchase claim:** shopping execution returns `prepared_not_purchased` and never calls a merchant.
- **Durable state:** missions, receipts, inventory, and the demo outbox survive MCP sessions and process restarts.
- **Atomic persistence:** state writes use temp-file + rename replacement.
- **Transport security:** hostile `Origin` values are rejected; remote origins must be explicitly allowlisted.
- **Protocol fence:** sessions negotiate MCP `2025-11-25`; subsequent requests must carry the negotiated protocol header and session ID.
- **Lifecycle fence:** tools/resources are unavailable until `notifications/initialized` is received.
- **Rate limiting:** each MCP session is bounded to 120 tool invocations per rolling minute.
- **Session lifetime:** idle transport sessions expire after 30 minutes by default; durable missions remain recoverable after reconnect.
- **External-data sanitation:** NWS strings are length-bounded and control characters removed before they reach tool output.

## MCP Apps

Tools that benefit from visual state include `_meta.ui.resourceUri = "ui://hearthline/mission-dashboard.html"`. The resource is served as `text/html;profile=mcp-app` and performs the MCP Apps `2026-01-26` iframe handshake before accepting tool-result notifications.

The UI is progressive enhancement: all core mission behavior remains available to clients that ignore MCP Apps metadata.

## Tests

The suite covers:

- MCP initialize/session/lifecycle behavior,
- Origin and protocol-version rejection,
- MCP App discovery and iframe handshake,
- complete mission → approve → execute flow over HTTP,
- persistence across orchestrator instances,
- stale-plan approval rejection,
- idempotent replay,
- explicit non-purchase shopping semantics,
- tool execution vs protocol error semantics,
- NWS coordinate validation and untrusted-text sanitation,
- idle MCP session expiry without loss of durable mission state.

## Project boundaries

This repository is a build/demo carrier. It does not register for a hackathon, publish a Devpost submission, provision cloud infrastructure, purchase goods, send household notifications, or claim prize eligibility. Any production provider that can cause a real-world effect should preserve the same prepare → approve → idempotent execute pattern and add provider-specific authorization.
