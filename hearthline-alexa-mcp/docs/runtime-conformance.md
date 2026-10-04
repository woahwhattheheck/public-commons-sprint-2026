# MCP 2025-11-25 runtime conformance

Hearthline's Alexa+ carrier uses **MCP 2025-11-25 over Streamable HTTP**. This document defines the evidence gate for the Amazon Build, Ship, Shape Alexa+ runtime requirement.

## Runtime contract

The server:

- exposes one `/mcp` Streamable HTTP endpoint;
- negotiates the server-supported protocol revision during `initialize`;
- issues a cryptographically random `MCP-Session-Id` and requires it on later requests;
- requires `MCP-Protocol-Version: 2025-11-25` on subsequent session-bound HTTP requests, including `GET` capability attempts and explicit `DELETE` termination;
- requires `notifications/initialized` before ordinary operations;
- advertises and serves tools and the Hearthline MCP App resource;
- returns JSON-RPC method-not-found (`-32601`) for unknown request methods;
- rejects malformed MCP request IDs, invalid origins, wrong or missing protocol headers, and missing/expired sessions without executing a tool;
- validates any session-bearing `GET /mcp` against session existence and protocol version before deciding that no SSE stream is available, yielding `404` for terminated/expired sessions and `400` for an unsupported or missing session protocol version;
- supports explicit session termination with HTTP `DELETE`;
- intentionally does not expose a standalone server-to-client SSE stream, so a `GET /mcp` with no applicable transport error — including a current valid session — returns `405`.

The runtime remains stateful for the 2025-11-25 handshake era. The durable household mission store is independent from the transport session and is not deleted when an MCP transport session expires or is terminated.

## Reproducible evidence

From `experiments/hearthline-alexa-mcp`:

```sh
node --test test/runtime-conformance.test.mjs
node runtime/conformance-probe.mjs
```

The probe starts the real server on loopback, executes a protocol matrix, emits no random session identifiers or ephemeral port numbers, and produces a canonical SHA-256 over the normalized evidence object. A non-green check exits non-zero. Its transport matrix includes anonymous and current-session no-SSE `GET` handling, unsupported-version precedence, and post-termination session rejection so a bare `405` cannot mask a required `400` or `404`.

The full package suite remains:

```sh
npm test
node scripts/demo.mjs
```

## Authority boundary

This conformance rail proves protocol/runtime behavior only. It does not register an Alexa device, create or mutate an Amazon/AWS account, deploy infrastructure, place purchases, contact vendors, execute contracts, submit a Devpost entry, or claim a prize.