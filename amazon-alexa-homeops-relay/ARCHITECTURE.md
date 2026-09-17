# HomeOps Relay architecture

## Goal

Give an Alexa+ agent a useful **multi-step household operations memory and decision layer** without silently turning model output into purchases, messages, appointments, or device changes.

## Trust model

```text
MCP client
   │
   ▼
Streamable HTTP boundary
  - Host/Origin check
  - strict JSON
  - protocol/session lifecycle
   │
   ▼
HomeOps tools
   │
   ├─ create issue
   ├─ add evidence
   ├─ add quote
   ├─ propose plan ─────────────┐
   │                            │ exact digests
   ├─ explicit human review ◄───┘
   │
   └─ request side effect
          │
          ▼
   PROPOSAL / REQUEST ONLY
   execution_authorized = false
          │
          X no executor in this project
```

## Evidence binding

Each issue, evidence item, and quote gets a SHA-256 content digest. Proposals bind:

- current issue digest;
- sorted evidence digests;
- sorted quote digests;
- explicit steps;
- `authority = PROPOSAL_ONLY`.

A human review binds the exact `plan_digest`. A side-effect request checks that the stored approval still refers to the exact stored plan and then binds both digests. `action_id` is globally replay-protected for the process lifetime.

## Event custody

The local store appends a chained event ledger. Every event contains the previous event digest, sequence number, subject, type, and a digest over its canonical form. `homeops.verify_event_chain` detects mutation or reordering.

This chain is an integrity mechanism, **not** a signature, identity proof, payment proof, or third-party attestation.

## MCP 2025-11-25 boundary

The HTTP transport intentionally follows the competition's pinned 2025 handshake era rather than silently switching to the newer 2026 stateless era:

1. client POSTs `initialize` with protocol `2025-11-25`;
2. server returns `Mcp-Session-Id`;
3. client sends `notifications/initialized`;
4. later tool traffic must carry the session ID;
5. client may terminate the session with DELETE.

The server uses JSON response mode and declines optional GET/SSE with `405`.

## Security / least authority

- no shell or subprocess invocation;
- no network calls from domain tools;
- no secrets or credential store;
- no vendor contact;
- no payment API;
- no scheduler integration;
- no IoT actuator integration;
- no external executor;
- strict bounded input sizes;
- exact field sets for domain operations;
- duplicate identifiers fail closed;
- unsupported action kinds fail closed;
- rejected/unreviewed plans cannot emit an action request;
- even an approved plan produces only `execution_authorized=false`.

## Known intentional limits

The reference store is process-memory state for a reproducible hackathon server. A production deployment would need durable storage, authentication/authorization, encrypted secrets, tenant boundaries, operational observability, an explicit executor authorization model, and provider-specific confirmation semantics. Those are not claimed here.
