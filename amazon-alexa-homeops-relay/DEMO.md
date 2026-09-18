# HomeOps Relay — <3 minute demo storyboard

Target: **2:35–2:50**. Keep the screen on the MCP client/Inspector plus a compact event/readback view.

## 0:00–0:20 — Problem

“Household maintenance is rarely one question. It is weeks of evidence, quotes, decisions, and follow-up. HomeOps Relay gives Alexa+ a persistent operations layer without letting an agent silently buy, message, schedule, or actuate.”

Show `tools/list` and the seven HomeOps tools.

## 0:20–0:55 — Build the issue record

Call:

1. `homeops.create_issue` — upstairs HVAC too warm;
2. `homeops.add_evidence` — thermostat/manual observation;
3. `homeops.add_quote` — diagnostic visit quote.

Call `homeops.get_issue` and point out the digests and retained records.

## 0:55–1:25 — Evidence-bound plan

Call `homeops.propose_plan` with a short diagnostic sequence.

Point out:

- `authority: PROPOSAL_ONLY`;
- `issue_digest`;
- `evidence_digests`;
- `quote_digests`.

Explain that changing the evidence generation requires a new proposal instead of silently reusing stale context.

## 1:25–1:55 — Human control

First try `homeops.request_side_effect` before review and show the tool failure.

Then call `homeops.review_plan` with `APPROVE` and an explicit reviewer identity.

Repeat `homeops.request_side_effect` for `SCHEDULE_VISIT`.

Zoom in on:

```json
"execution_authorized": false,
"requires_external_executor": true
```

“This MCP compiles a bounded request. It does not schedule anything.”

## 1:55–2:20 — Replay / tamper evidence

Call `homeops.verify_event_chain` and show `valid: true`, event count, and head digest.

Optionally run the hostile suite briefly in a second terminal and show 30 passing cases in both normal and optimized Python.

## 2:20–2:45 — Why Alexa+

“Instead of a single-turn Q&A wrapper, Alexa+ can keep long-running household work coherent: what happened, what evidence exists, what vendors quoted, what plan was reviewed, and what still requires a person. The protocol surface is a real MCP 2025-11-25 Streamable HTTP server, and the action boundary is explicit.”

End on the architecture diagram / README.

## Capture checklist

- Show the actual Streamable HTTP server process running.
- Show the MCP client connecting through initialize/session lifecycle.
- Keep all household names/vendors synthetic.
- Do not imply a message, purchase, appointment, device change, Alexa production deployment, award, or payment happened.
- Public video must be YouTube or Vimeo and under three minutes per the current official rules.
