# GridKind — simulated Alexa+ affordability planner

A standalone, original **simulated Alexa+ experience** prototype for Amazon Build, Ship, Shape 2026 (Alexa+ track). This is **not** an Alexa/Amazon integration, smart-home device controller, live meter, tariff feed, or Devpost entry. The [official rules](https://amazonappdev2026.devpost.com/rules) permit an alternate simulated Alexa+ experience using an agentic tool, no mandatory MCP runtime hook; require an actual demo video under 3 min, public code with license or judges' private repo access, feedback and entrant submission by **Oct 23, 2026, noon PDT**.

GridKind simulates an agent that autonomously calls a constraint-aware optimizer on 24-hour **hypothetical** hourly prices; checks shared 3 kW circuit and quiet hours; explains baseline vs cheaper plan; requests separate human approval; then dispatches **only in-memory, labeled simulated device commands**, with replay-safe receipts and reset. It is a verifiable planner, not a generic chat wrapper or a text-only storyboard. One front-end browser session is isolated from others by a unique HttpOnly cookie. No external network/API calls, keys, utility data, or device pairing. The browser UI stylesheet is served as same-origin `/style.css` under the existing strict `style-src 'self'` policy; no inline CSS permission is needed.

## Run

Node.js >= 22, no packages to install:

```bash
node server.mjs
# visit http://127.0.0.1:4181
node --test test.mjs    # two focused behavioral checks, no broad suite
```

For loopback-only hosting, requests must use the matching local Host (`127.0.0.1`, `localhost`, or `[::1]`) and listening port; forged public Host headers are rejected before a session is created. An explicit non-loopback `HOST` remains an intentional deployment choice.

Say “Find a cheaper schedule for tonight”, inspect item times and relative prices, click **Approve** and then **Execute simulation**. The receipt shows `simulated: true`, `liveDeviceCalls: 0`. Use **Reset session** to discard the current proposal. The UI shows no live-service or AWS/official account claim.

## Agentic tools and method

- `plan` enumerates feasible whole-hour placements for 1–5 tasks. It respects deadlines, quiet hours, and a shared circuit power ceiling, comparing the **earliest jointly feasible** baseline with the joint minimum-cost schedule. It will move a flexible load later if a greedy prefix would block a fixed load; task hours outside the 0–24 hour horizon are rejected.
- `makeAgent` routes a speech-like command to the scheduling/explanation tools, maintains proposal revision and approved exact ID, and exposes a guarded, idempotent simulated-execution tool.
- No task is scheduled after plan mutation until a human approves the new plan ID. A retry cannot send duplicate simulated commands.
- Price vector is a fictional 24-hour $/kWh curve ($0.12 off-peak, $0.25 general, $0.43 peak); task powers and times are illustrated assumptions, not a consumer energy claim. Savings are differences **within this one hypothetical scenario**, not forecast actual household savings.

## Original-owner competition handoff

Existing HomeOps and Hearthline Alexa candidates are separate products. This source package is a new GridKind candidate; do not conflate their Devpost entrants. To make this candidate submission-ready, an authorized entrant must assess overlap/eligibility, confirm product direction, record a genuine short browser demo, create a durable public MIT source repository and file real Devpost fields/feedback. No app was submitted or prize awarded as a result of this prototype.


## Flat-tariff symmetry bound

The scheduler treats the sum of each task's cheapest unconstrained option as a global admissible lower bound. Candidate starts are visited in ascending order, so the first feasible schedule that reaches that bound is also the lexicographically earliest optimal schedule. Equal-cost flat-tariff alternatives are not enumerated after that proof point.

This preserves the exact cost, task order, tie-break output, infeasible error text, and circuit constraints. The source-pinned Muse OPT3-02 residual panel measured 41/41 exact output matches with zero mismatches; worst-case runtime fell from 5.94 ms to 0.09 ms on that retained VM panel. Those are diagnostic VM measurements, not an official organizer score.

Focused source regression:

```bash
node amazon-gridkind-alexa-2026/test-flat-symmetry.focused.mjs
```

