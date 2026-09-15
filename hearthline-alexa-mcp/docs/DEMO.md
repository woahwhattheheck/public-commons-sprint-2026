# Three-minute demo script

## 0:00–0:25 — the problem

"Alexa, get the house storm-ready. Don't buy or send anything unless I approve it."

Show that Hearthline is an MCP 2025-11-25 server, not a one-off web endpoint. The mission survives MCP session boundaries.

## 0:25–1:10 — autonomous read/orchestration

Seed a deliberately incomplete demo inventory. Create a storm-readiness mission. Hearthline combines live/public alert context with local inventory and returns one coherent plan: completed read steps plus external-commit steps marked `awaiting_approval`.

Open the MCP App dashboard and show the same mission state visually.

## 1:10–1:50 — human authority boundary

Attempt to execute a pending reminder before approval: it fails closed.

Approve that one action using its mission id, action id, and current plan hash. Explain that the approval itself rotates the mission generation, so another pending action cannot reuse the old approval view.

## 1:50–2:25 — idempotent execution

Execute the approved reminder with an idempotency key. Show the durable receipt. Repeat the exact call and show that Hearthline returns the original receipt with `replayed: true` instead of causing a second effect.

Show the shopping action and its explicit `prepared_not_purchased` semantics.

## 2:25–3:00 — cross-session recovery

Reconnect with a new MCP session and list missions. Read the original mission and receipt. Close on the product thesis: Alexa+ can carry a household goal across conversations without silently turning conversational intent into irreversible action.
