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

Say “Find a cheaper schedule for tonight”, inspect item times and relative prices, click **Approve** and then **Execute simulation**. The receipt shows `simulated: true`, `liveDeviceCalls: 0`. Use **Clear current plan** to discard the current proposal. The UI shows no live-service or AWS/official account claim.

## Plan your own hypothetical scenario

The browser now exposes the original optimizer's inputs. Choose which of the
three example loads to include, edit each load's power, duration and allowed
window, and choose whether it must avoid 22:00–07:00 quiet hours. Set a shared
circuit cap and hypothetical off-peak, daytime and evening rates. Rates use the
displayed fixed time bands; they are not fetched from a utility.

Click **Plan this scenario** to compare the earliest jointly feasible schedule
with the cheaper schedule. Planning commands in **Ask GridKind** use those same
settings. A changed field disables approval and execution until a new plan is
generated. Infeasible inputs show the existing optimizer's explanation and do
not authorize the previous schedule. Approval still binds the exact plan ID,
and execution emits only the existing simulated receipt.

The last valid scenario stays with the original browser session and is restored
on reload. **Clear current plan** clears its approval and receipt while retaining
the settings; **Restore example** edits the form back to the original example and
requires replanning. Exported agent views are copies, so editing a returned view
cannot mutate an approved schedule.

Run the focused original-engine and browser-script flow check with:

```bash
node --test test-scenario-flow.focused.mjs
```

## Portable household scenario: real cross-session handoff

The original browser now has **Download my scenario**, **Open a GridKind scenario
file**, a human-readable preview and **Apply imported assumptions** directly
below the editable household loads. This is not a new simulator or agent.

1. On the original running page, choose/edit loads, constraints and three-band
   hypothetical tariff. Download `gridkind-hypothetical-scenario.json`; a valid
   unplanned draft is exportable, and a current proposal may contribute an
   **illustrative, non-authoritative** baseline/optimized cost summary.
2. On another browser/computer, open the JSON file locally. The first step only
   reads and previews the scenario. The UI accepts one of the three original load
   identities with correct labels, whole-hour windows and duration, the 24-hour
   three-band tariff, finite costs and circuit power. It rejects duplicate loads,
   unknown fields, bad bounds, receipt/approval fields and files over 40 KB.
3. **Apply imported assumptions** invokes the original HTTP `cancel` first,
   clearing server-held proposal, approval and simulated receipt. If that call
   fails the imported inputs are not applied. The browser then updates the
   *existing* editor, invalidates any tariff comparison and requires the
   original `propose -> approve -> execute` sequence. Previously approved IDs
   and receipts from either browser cannot be imported or used.

This is a user-owned **hypothetical input artifact**, not a shared trusted
authorization, tariff feed, utility bill, smart-device command or cross-account
session transfer. No scenario is uploaded or transmitted to an external server.
The browser creates and opens JSON locally; the original GridKind server still
performs planning in the active browser session. The file carries explicit
`kind='gridkind/hypothetical-scenario'` and `version=1`; plan ID in the optional
illustrative summary is informative only, never passed to the original agent.

To inspect the exact portable format or run the focused pure source exercise
from the original `scenario-handoff.js` module, import
`makeScenarioHandoff`, `readScenarioHandoff` and
`validatePortableScenario` directly in Node >=22. No npm or hosted CI.

## Compare a changed tariff

After planning, **What if the tariff changed?** compares the current optimized schedule
with a newly optimized schedule under hypothetical off-peak, daytime and evening
rates. The loads, deadlines, quiet hours and circuit cap stay those of the current
proposal. Costs use four decimal places; changed start hours show what replanning
would require. **Download comparison JSON** saves the original rate-robustness report.

The panel uses the existing `robustness/compare.mjs` analyzer and `engine.mjs`
optimizer through `POST /api/robustness`. The endpoint binds `proposalId` to this
browser session's current proposal and returns HTTP 409 if it has been replaced
or cleared. It cannot change a proposal, approval, execution receipt or history.
Editing the main scenario requires planning again; editing alternative rates
invalidates the comparison and its download. Late results never replace newer edits.

Comparison does not apply the alternative tariff or approve a new schedule.
To use different rates, edit the main scenario and plan it through the existing
workflow. All costs remain hypothetical; this does not read utilities or devices.

The focused HTTP and shipped-module workflow can be run with
`node --experimental-vm-modules test-robustness-flow.focused.mjs`. Its small DOM
fixture exercises the actual scripts and download bytes, not browser rendering.

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



