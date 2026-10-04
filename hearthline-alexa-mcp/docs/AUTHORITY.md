# Hearthline authority core

Hearthline separates **planning**, **approval**, and **execution authority**. The mission `planHash` remains the stale-plan fence, but an approved action now also creates a durable operation record that binds the exact executable intent to one operation ID.

## Operation contract

New clients should supply a stable `operationId` (8–128 safe ASCII characters) to `hearthline_approve_action` and reuse that exact ID for `hearthline_execute_approved`.

Approval records bind:

- mission ID and action ID;
- action kind, risk, summary, and exact payload digest;
- the plan hash actually approved;
- approval time;
- one explicit authority ceiling;
- a canonical SHA-256 `approvalDigest`.

An exact approval retry is idempotent. Reusing an operation ID with another action, another payload, or another plan generation fails closed. A payload changed after approval cannot be executed under the old operation.

The pre-authority demo API is retained for compatibility: if approval omits `operationId`, Hearthline derives a deterministic `legacy:<digest>` operation; `idempotencyKey` remains accepted by execute. Legacy keys are still globally single-bound to one approved operation and cannot authorize a sibling action. New integrations should use explicit operation IDs.

## Authority ceiling

Every approval and execution receipt carries the same conservative ceiling:

- local state mutation: **true**;
- network call: **false**;
- purchase: **false**;
- payment: **false**;
- message delivery: **false**;
- booking: **false**;
- contract: **false**;
- account mutation: **false**;
- provider mutation: **false**.

This ceiling describes what the current Hearthline demo runtime can authorize. `shopping_proposal` still ends at `prepared_not_purchased`. `household_reminder` still writes only to the local demo outbox; it is not evidence that a message was delivered.

## Tamper-evident receipts

Authority material uses strict canonical JSON before SHA-256 hashing. Non-finite numbers, negative zero, sparse arrays, accessors, hidden properties, symbols, cycles, non-plain objects, and `undefined` are rejected from authority material rather than silently normalized.

Execution receipts bind the approval digest, action digest, output digest, semantics, and previous receipt digest. The authority state stores a receipt head and validates the full chain before authority operations. Completed operations must point to a receipt that validates against the exact approval.

This is **tamper-evident**, not a substitute for filesystem trust or a hardware-backed signature. A party with unrestricted write access to the state file can replace the entire local trust domain. Production deployments should protect the store and add provider-specific credentials/signatures at the provider boundary.

## MCP evidence surface

`hearthline_get_operation` returns the durable operation record for audit/debugging without executing anything. `hearthline_approve_action` and `hearthline_execute_approved` return the approval/receipt material in `structuredContent` so a host can render an evidence/decision packet.

## Hostile coverage

Focused tests cover operation rebinding, payload mutation after approval, exact-retry replay, restart replay, approval-ceiling tampering, receipt tampering, receipt-chain integrity, shopping no-purchase/no-payment semantics, and legacy-key cross-operation collision.
