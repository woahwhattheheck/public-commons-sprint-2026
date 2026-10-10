# Delivery Finality Gate · durable confirmation before cadence advancement

**Nonbounty revenue / original implementation · October 10, 2026 · MIT**

This source solves a specific operational failure of automation systems: a sender's `HTTP 201 Accepted` means its gateway queued the work, **not** that the recipient received the message. Advancing a CRM or outreach cadence after HTTP 201 silently burns undelivered touches. This project is a runnable, local-first Node + SQLite prototype: a durable delivery-intent journal, an independently authenticated callback entry point, a fail-closed review queue, and an idempotent outbox for downstream state changes.

## Original, publicly reported buyer problem

- First-party public n8n community pilot discussion: https://community.n8n.io/t/looking-for-3-n8n-users-with-real-workflow-reliability-issues-free-pilot-audit/310860
- One operator described a July 31–August 3 incident: **13 cadence records advanced, 0 messages actually delivered**, despite green n8n executions and gateway acceptance. Some 500 responses were also misrouted through regular output. They fixed the 500 error branch, but the difficult remaining case was **HTTP 201 accepted → later asynchronous delivery callback**.
- In that public thread, they said a durable “accepted but unconfirmed → don't advance” mechanism that survives missing callbacks is what they'd pay for, rather than a retrospective audit. **This does not mean they offered TJLabs a contract, accepted a quote, or gave permission to contact them.** Another participant owns an ongoing no-cost pilot with that operator; preserve that relationship.
- The public thread provides a textual incident description, *not* the private workflow export, gateway credentials, actual provider callback contract, or production sample. Our acceptance tests use our own real gate code and the published **13/0 behavioral shape**. They are not a replay of any private n8n tenant or an assertion of actual recipient delivery.

## What actually runs

`gate.mjs`: Node 22.16+ built-in SQLite (`node:sqlite`, experimental in Node 22). SQLite WAL + `synchronous=FULL` and explicit transactions persist intents and callbacks through process restart. No npm installs, LLM calls, payment, live recipient, external transport or hosted GitHub Actions. Caller passes **pseudonymous recipientKey**, not raw phone/email or message body; one composite `(tenant, campaign, recipientKey, touch)` is unique across crashes and parallel requests.

`server.mjs`: loopback-only `127.0.0.1` HTTP integration for a self-hosted n8n HTTP Request node. All routes require a strong bearer token. Callbacks are marked `verified` only **after** a caller-owned provider-specific verifier validates the actual upstream webhook signature; possessing the local service token is not a substitute for a genuine provider delivery receipt. The service never sends anything and never automatically retries uncertain dispatches. No live outbound network.

`test/gate.test.mjs`: 7 focused test cases on the **actual source and local HTTP server** covering 13 gateway-accepted/no-delivery rows, callback-to-outbox, restart and dedup, early callback race, timeout→review and late delivery, transport uncertainty, duplicate/conflicting provider events, tenant isolation and bearer-token enforcement.

Run locally (Node 22.16+; temporary/test DB for demo):

```sh
node --test business/n8n-delivery-finality-20261010/test/gate.test.mjs
node business/n8n-delivery-finality-20261010/demo.mjs
```

Run loopback service with a **user-managed secret stored outside this repository**:

```sh
export GATE_DB_PATH="${HOME}/delivery-finality.sqlite"
export GATE_API_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
node business/n8n-delivery-finality-20261010/server.mjs
```

Do not expose the service on the public Internet, commit the token, or set the database on an untrusted/shared path. Protect DB files and HTTP transport where deployed; `node:sqlite` is experimental in Node 22 and should be version-pinned/reassessed for deployment. The sample does not implement gateway-specific signature verification, rate limits, tenant identity authorization beyond the API bearer, or the downstream SQL effect writer. Those are explicitly separate paid integration work.

## n8n two-phase recipe (not an automated live-send workflow)

The existing n8n schedule / SQL query / messaging gateway nodes remain customer-owned. Add HTTP Request steps against a **reachable private loopback service** on the self-hosted instance; ensure the n8n runtime actually shares the service network namespace (inside Docker, `127.0.0.1` is the container, not automatically the host). Each request has `Authorization: Bearer <private token>` and JSON content type. **Never put the private token in a downloadable example.** Use n8n credential storage / private environment configuration.

| Stage | Internal REST call | Response/guard |
|---|---|---|
| Before gateway egress | `POST /intents/reserve` with `{tenant,campaign,recipientKey,touch,reviewAfterMs}` | Continue ONLY when `sendAllowed === true`, otherwise don't send; response has stable `id` |
| Immediately before egress | `POST /intents/{id}/begin` | Journal uncertain dispatch before doing external work |
| Gateway answers 201/202 with unique ID | `POST /intents/{id}/accepted` with `{providerId,httpStatus:201}` | `ACCEPTED_UNCONFIRMED` is **not** success, never write cadence progress from this response |
| Gateway request errors, timeout or loses connection | `POST /intents/{id}/transport-uncertain` | Manual review; **do not auto-resend** an unknown outcome |
| Real authenticated delivery webhook | Provider verifier → `POST /callbacks/verified` with `{tenant,providerId,eventId,kind:"delivered"}` | Durable callback, possible out-of-order merge; only specific provider-confirmed delivered status yields a delivery effect |
| Downstream effect worker | `GET /outbox` → apply each `effect_id` as unique transaction in the **customer cadence database** | Do not advance unless a `DELIVERED` effect exists. Use unique `(effect_id)` at destination for safe at-least-once processing |
| After downstream database commits | `POST /outbox/{effectId}/ack` with `{externalReceipt:"actual-id-of-downstream-transaction"}` | Records acknowledgement; prevents repeated export of same effect |
| Operator clock sweep and review | `POST /maintenance/review`; `GET /reviews` | Any reserved / dispatch-unknown / accepted-unconfirmed item past its review deadline becomes `REVIEW_REQUIRED`, not auto-delivered or auto-retried |

Apply the effect in the destination with a single transaction containing **both** the idempotency insert and guarded contact-stage advance, conceptually:

```sql
BEGIN;
INSERT INTO processed_delivery_effects (effect_id, processed_at)
VALUES (:effect_id, CURRENT_TIMESTAMP)
ON CONFLICT (effect_id) DO NOTHING;
-- Only if that INSERT inserted exactly one new row:
-- UPDATE actual_customer_cadence SET touch_count = :confirmed_touch,
--   next_touch_at = :next_due
-- WHERE tenant_id = :tenant AND campaign_id = :campaign
--   AND recipient_hash = :recipient_key AND touch_count = :previous_touch;
COMMIT;
```

The literal destination table/columns, workflow IDs, gateway callback signature scheme, and allowed sends must be verified against the customer's own integration. The outbox provides **at-least-once delivery of advance instructions**, not magic distributed exactly-once delivery. If the provider emits `accepted` but never a definitive `delivered` signal, there is **no confirmed-delivery effect** to release; deployment must resolve that provider limitation or keep manual hold.

## Exact failure semantics

- Inbound callback can win the race before the HTTP 201 handler; stored and reconciled by `tenant + providerId` once acceptance is linked.
- Duplicate `(tenant,eventId)` callbacks with matching payload have no extra effect; reusing the event ID for a different provider/message or event kind is rejected.
- Confirmed failure does not advance. Conflicting `failed`/`delivered` callbacks put the intent into `REVIEW_REQUIRED` and suppress *unacknowledged* outbox effects. If a downstream effect was already committed before conflicting evidence arrived, an operator must resolve it separately; no automatic impossible rollback.
- Timeouts never infer delivery or resend. A late authenticated delivery callback reconciles the original intent and releases one deterministic effect only if provider reports are coherent.
- Two candidates for the same tenant/campaign/pseudonymous recipient/touch return the same reservation; only the first has `sendAllowed: true`. A crash after reserving but before actual egress may therefore withhold a valid send until manual review: the conservative alternative prevents unverified duplicate sends.
- The gateway and provider itself may misreport delivery. A cryptographically authenticated **provider** callback represents provider evidence, not proof a human read the message. Confirm exactly what the provider's `delivered` status promises.

## Commercial pilot concept — *proposed, not sold or accepted*

**Suggested first paid pilot:** **$950 fixed, five business days after client access and requirements**, contingent on buyer approval and named technical implementer capacity. Deliver one customer's provider-signature bridge, one self-hosted n8n cadence integration and callback worker, verified replay of the provided redacted actual failure, and an operator handoff; one narrowly defined correction round included. Boundaries: no purchased sender API, no unapproved outreach, no unlimited support, and no invented experience/results. Owner should quote only after verifying sender architecture, actual definitive delivery callback capability, PII and consent rules, database update authority, and authentic buyer interest. Don't solicit the existing pilot participants over the current collaborator's live trial. A stronger route is to show this code to an *unclaimed* operator who independently reports the same failure mode and asks for work.

**Acceptance to get paid:** buyer signs fixed SOW, owner confirms real provider/callback path, provider-issued 201 leaves record unadvanced, provider-issued *verified delivered* callback commits the one idempotent delivery progress write, crash/replay/late callback do not advance twice, missing confirmation enters review, then buyer signs off. These are observable deployed milestones, not theoretical confidence scores.

Source owner: `REV-N8N-DELIVERY-FINALITY-GATE-20261010-GPT6CLOUD`; #sales claim. No user/prospect contacted, no bill, no invoice, no settled revenue. No connection to held Michael/external demo, bounties, passed competitions, or other DealScout writers.