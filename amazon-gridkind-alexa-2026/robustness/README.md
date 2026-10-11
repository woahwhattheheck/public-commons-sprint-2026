# GridKind: tariff robustness and human replan decision

The GridKind interactive scenario editor (PR736) lets the operator plan and approve a **hypothetical** household schedule. A very practical question remains: *what happens if a quoted tariff changes before the scheduled loads run?* This source-native analysis answers it without changing the actual schedule or its approval.

`compare.mjs` imports `inputs` and `plan` from the **existing unchanged** `../engine.mjs`. It obtains the initial optimized schedule, then for each alternative tariff **reprices that same fixed schedule** and separately asks the original optimizer to find the best new feasible schedule. The difference, `regretUsd`, is the possible cost reduction *under that alternative price vector* from making a new decision. It shows changed load start hours and a portable, offline HTML explainer, not another independent optimizer. The original optimizer remains the authority for concurrency, deadlines, and quiet hours.

## Run in the real local Node 22+ product checkout

```bash
node amazon-gridkind-alexa-2026/robustness/compare.mjs \
  amazon-gridkind-alexa-2026/robustness/sample.json \
  --json /tmp/gridkind-rate-review.json \
  --html /tmp/gridkind-rate-review.html
# Open the HTML file locally to see three scenario comparisons.
```

For live browser editor integration, export the editor's *exact currently reviewed* `prices`, `maxKw`, and `tasks` as `base`, then supply 1–8 named alternate `prices` vectors (24 finite nonnegative $/kWh numbers each, in the original engine's `[0,10]` range). This module does **not** silently read external tariffs or merge estimates from different customer intents. If the user edits any device constraint, generate a new `base` and run the analysis again. The generated SHA-256 identifies the exact analyzed input, not approval authority or live-price provenance.

`retainedScheduleCostUsd` evaluates the **initial optimized task start hours** under the changed rates. `freshlyOptimizedCostUsd` comes from `plan({...base,prices:alternative})`. `regretUsd = max(0,retained - fresh)` to four decimal places; a larger number means greater incentive to request a new reviewed plan. `repricingVsOriginalUsd` is **not** savings, only the extra cost/discount of changed tariffs if the first schedule stays. Costs are shown with four decimals to match GridKind's existing engine display; not invoices or utility measurements. Replan recommendation **does not** reuse the original approval ID, send commands or touch a meter, device, wallet or network. Executing a newly chosen schedule requires the existing separate human approval process.

`sample.json` uses the original public product demo devices and three explicitly fictional alternative rates; it is a transparent decision-quality example, not a claim about a customer's tariff or organizer benchmark. Outputs are JSON plus stand-alone responsive HTML with no scripts, remote assets or telemetry. HTML escapes user-provided names and labels; output paths are create-only (`wx`). CLI uses standard Node modules and no new dependencies or GitHub Actions.

Owned as additive `robustness/` source; no edits to PR736's app/server/agent/browser files, and no modification of source optimizer `engine.mjs`. Competition submission and product UI adoption remain with the original GridKind entrant.
