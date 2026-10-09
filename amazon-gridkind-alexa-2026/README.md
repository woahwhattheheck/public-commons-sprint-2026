# GridKind — simulated Alexa+ affordability planner

A standalone, original **simulated Alexa+ experience** prototype for Amazon Build, Ship, Shape 2026 (Alexa+ track). This is **not** an Alexa/Amazon integration, smart-home device controller, live meter, tariff feed, or Devpost entry. The [official rules](https://amazonappdev2026.devpost.com/rules) permit an alternate simulated Alexa+ experience using an agentic tool, no mandatory MCP runtime hook; require an actual demo video under 3 min, public code with license or judges' private repo access, feedback and entrant submission by **Oct 23, 2026, noon PDT**.

GridKind simulates an agent that autonomously calls a constraint-aware optimizer on 24-hour **hypothetical** hourly prices; checks shared 3 kW circuit and quiet hours; explains baseline vs cheaper plan; requests separate human approval; then dispatches **only in-memory, labeled simulated device commands**, with replay-safe receipts and reset. It is a verifiable planner, not a generic chat wrapper or a text-only storyboard. One front-end browser session is isolated from others by a unique HttpOnly cookie. No external network/API calls, keys, utility data, or device pairing.

## Run

Node.js >= 22, no packages to install:

```bash
node server.mjs
# visit http://127.0.0.1:4181
node --test test.mjs    # two focused behavioral checks, no broad suite
```

Say “Find a cheaper schedule for tonight”, inspect item times and relative prices, click **Approve** and then **Execute simulation**. The receipt shows `simulated: true`, `liveDeviceCalls: 0`. Use **Reset session** to discard the current proposal. The UI shows no live-service or AWS/official account claim.

## Agentic tools and method

- `plan` enumerates feasible whole-hour placements for 1–5 tasks. It respects deadlines, quiet hours, and a shared circuit power ceiling, comparing a compliant earliest-arrival baseline with the joint minimum-cost schedule.
- `makeAgent` routes a speech-like command to the scheduling/explanation tools, maintains proposal revision and approved exact ID, and exposes a guarded, idempotent simulated-execution tool.
- No task is scheduled after plan mutation until a human approves the new plan ID. A retry cannot send duplicate simulated commands.
- Price vector is a fictional 24-hour $/kWh curve ($0.12 off-peak, $0.25 general, $0.43 peak); task powers and times are illustrated assumptions, not a consumer energy claim. Savings are differences **within this one hypothetical scenario**, not forecast actual household savings.

## Original-owner competition handoff

Existing HomeOps and Hearthline Alexa candidates are separate products. This source package is a new GridKind candidate; do not conflate their Devpost entrants. To make this candidate submission-ready, an authorized entrant must assess overlap/eligibility, confirm product direction, record a genuine short browser demo, create a durable public MIT source repository and file real Devpost fields/feedback. No app was submitted or prize awarded as a result of this prototype.
