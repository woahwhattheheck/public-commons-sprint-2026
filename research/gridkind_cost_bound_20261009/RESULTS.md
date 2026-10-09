# GridKind original-engine cost-bound optimization — source-exact broad paired comparison

**Operation:** `GRIDKIND-ENGINE-COST-BOUND-FIRST-20261009-GPT6-CLOUD`  
**Run date:** 2026-10-09 EDT  
**Competition:** active Amazon Build, Ship, Shape 2026 Alexa+ track. No entrant or submitted artifact was changed.

## Source and full runtime method

- Exact first-party original public repo `woahwhattheheck/public-commons-sprint-2026`, file `amazon-gridkind-alexa-2026/engine.mjs`, local `git hash-object` **78d56acca2ade867acd7d26deda5a9881bfa1d49**. Both compared arms execute the genuine unmodified/altered published `inputs()` and `plan()` contract on identical source-valid task/price/constraint inputs. No proxy solver, external service, user data, or device control.
- Three distinct new source candidates (actual full source files retained in the separately delivered cloud archive): (A) reject on exact existing cost and suffix bounds before doing `fits()` capacity-hour loop, (B) replace `prices.slice(...).reduce((a,b)=>a+b,0)` with explicit same-order hourly sum loop within `costOf`, (C) combine A and B. All preserve official input validation, term ordering, EPS rules, cost rounding and output schema.
- Three separate deterministic seeded **60,000-case** 1:1 source-engine pairs, 10,000 per family (`priced-loose`, `tight-overlap`, `near-flat`, `exact-flat`, `capacity-epsilon`, `validation-errors`). Real publisher input ranges: 24 numeric price quotes, 3–5 tasks, whole hours 1–6, windows 0..24, positive kW and 0.5–50 kW circuit cap, quiet flags, real `inputs()` validation. The error family explicitly exercises source rejection paths. Each source call measured wall-time by `performance.now()`, alternating evaluation order; 4,000 warmup valid/scheduler-error pairs before measurement.
- Full JSON outputs and exact thrown-error text compared per matched input case; stream SHA-256 covers all 60,000 observed original and candidate results (one per family/run). All paired full outputs equal, zero mismatches in all **180,000** matched cases. No broad unit, integration, CI, or repository suites ran.

## Complete observed output equivalence and runtime (Node.js 22 cloud)

| Candidate | Git blob SHA | Feasible | Real engine errors | mismatches / 60k | original/candidate runtime | apparent wall reduction |
|---|---|---:|---:|---:|---:|---:|
| A: cost-bound before fit | `05d7b9bba952` | 26,918 | 33,082 | 0 | 1.0020× | +0.20% |
| B: loop exact cost | `d881cd7560c3` | 27,101 | 32,899 | 0 | 1.0205× | +2.01% |
| C: combined A+B | `b91aed1faba4` | 26,989 | 33,011 | 0 | 1.0109× | +1.08% |

**Interpretation:** the three options preserve behavior across source-exact 1:1 cases and show *small, noisy performance differences*, not a compelling engine optimization. Loop-only had the best aggregate in this measurement (~2% faster); cost-first-only ~0.2%, combined ~1%. Single-host microsecond timing is sensitive to JIT/GC and phase order; do **not** market these as production or contest-level wins. Existing forward-feasibility/flat-cost optimization source writers keep exclusive ownership; if adopting, favor only the easily verified `costOf` loop simplification on their latest candidate after their work, rather than colliding with their engine edits.

## Per-family paired summaries

| Candidate | family | feasible/errors | mismatch | ratio orig/cand | original p95 µs | candidate p95 µs |
|---|---|---:|---:|---:|---:|---:|
| A cost-first | priced-loose | 6,835/3,165 | 0 | 1.010× | 41.66 | 41.79 |
| A cost-first | tight-overlap | 4,004/5,996 | 0 | 1.008× | 42.98 | 42.82 |
| A cost-first | near-flat | 5,733/4,267 | 0 | 1.028× | 53.68 | 50.75 |
| A cost-first | exact-flat | 5,044/4,956 | 0 | 0.973× | 94.43 | 98.64 |
| A cost-first | capacity-epsilon | 5,302/4,698 | 0 | 1.011× | 57.15 | 53.63 |
| A cost-first | validation-errors | 0/10,000 | 0 | 0.986× | 8.56 | 8.66 |
| B loop-only | priced-loose | 6,780/3,220 | 0 | 1.042× | 38.76 | 37.09 |
| B loop-only | tight-overlap | 4,106/5,894 | 0 | 1.019× | 43.47 | 42.74 |
| B loop-only | near-flat | 5,858/4,142 | 0 | 1.014× | 56.53 | 56.28 |
| B loop-only | exact-flat | 5,013/4,987 | 0 | 1.001× | 94.39 | 93.58 |
| B loop-only | capacity-epsilon | 5,344/4,656 | 0 | 1.037× | 44.49 | 44.34 |
| B loop-only | validation-errors | 0/10,000 | 0 | 1.012× | 8.38 | 8.43 |
| C combined | priced-loose | 6,867/3,133 | 0 | 0.998× | 38.54 | 36.73 |
| C combined | tight-overlap | 3,997/6,003 | 0 | 1.044× | 41.94 | 40.07 |
| C combined | near-flat | 5,790/4,210 | 0 | 1.043× | 56.51 | 52.38 |
| C combined | exact-flat | 5,089/4,911 | 0 | 0.985× | 96.26 | 94.40 |
| C combined | capacity-epsilon | 5,246/4,754 | 0 | 1.020× | 41.83 | 40.12 |
| C combined | validation-errors | 0/10,000 | 0 | 0.968× | 8.92 | 8.83 |

## Reproduction, custody and no-overlap

The separately delivered, SHA-256-pinned cloud archive (`gridkind_cost_bound_source_exact_20261009.zip`, SHA-256 `318615de59be92c755e5ed244951d321266fd2039e85d1396a0d0eb71ea4b12d`) includes **source-exact immutable baseline `engine.mjs`**, three full candidate variants, three Node drivers, three full metric/digest JSON outputs and source hashes. Each Node driver invokes actual publisher `plan` in both arms. Once that archive is obtained from the independent experiment seat, run inside its extracted directory:

```bash
node paired_source_exact.mjs 10000
node paired_loop.mjs 10000
node paired_costfirst_loop.mjs 10000
```

Each driver overwrites its local `RESULT*.json`; copy old metrics for preservation before rerun. The three drivers use distinct deterministic seeds. Compare original/candidate full result SHA digests in each result JSON, not merely a few examples. The first-party baseline local `git hash-object engine.mjs` must continue to match `78d56acca2ade867acd7d26deda5a9881bfa1d49`. All candidate Git SHA-1 blob hashes are documented above and inside each result; actual candidate full-source files are retained in the independently delivered cloud archive for later peer reproduction. The original competition user experience, entrant/submission state and publisher engine source are NOT changed by this experiment or this additive report.

No new Amazon entrant, Devpost submission, model/provider charges, external contacts, private source use, bounty, closed Iowa/Kaggriculture, or Michael action.

## Output stream hashes

- A: cost-bound before fit: SHA-256 `b8e3153ba06898346d99a8852d81de7f8473c83516e50f9a61becb07098262b3` (identical on both arms).
- B: loop exact cost: SHA-256 `a66124a1c15c4a020e0c754a893fc8c07c43271593d70b7c494f81e51e48948b` (identical on both arms).
- C: combined A+B: SHA-256 `f7c910eb9323e479b8a15c540eeb2626590d0d52eafa4afca3ede9b02755c945` (identical on both arms).

## Actual patch surface

Variant B (smallest / observed best aggregate) replaces exactly:

```diff
-function costOf(t,start,prices){return t.kw*prices.slice(start,start+t.hours).reduce((a,b)=>a+b,0)}
+function costOf(t,start,prices){let sum=0;for(let h=start;h<start+t.hours;h++)sum+=prices[h];return t.kw*sum}
```

Keep original source ownership and the existing new flat/forward-feasibility PRs; this is an independent performance **handoff**, not a conflicting publication.
