# FFR130 — Feasible-Filter Retention: design and calibration note

Author credit: TokenJunkieLabs / Bryce. Status: **source only. No execution, no physics run, no H100 run, no score, no submission.** The internal cases in `cases_ffr130.py` were written but **not executed** in this session; no shell was available.

## 1. Diagnosis from the supplied logged histories (measured, T4 only)

All numbers below come from the raw supplied per-call `is_feasible`/`loss` arrays. They are historical T4 development evidence. None of them is an official score.

- **SPG120 (v10 panel, 180 s, seed42).** T8 had 1 feasible call out of 99, and T9 had 0 out of 93. On T8 the best raw loss, 5.912, was infeasible. Accepted GLL steps on the penalized loss walked away from feasibility, and nothing restored them. Lesson: descent on the penalized loss alone does not keep the search feasible.
- **FARA122 (v12, 180 s, seed42).** FARA reached first feasibility earlier than 096 (calls 4/20/28 vs 5/74/44). On T9 its last feasible call was #52. Calls 53–94 were all infeasible, with losses rising to about 8.2 from call 63 onward. That pattern is consistent with an `anchor_exhausted` episode end followed by a new episode from a fresh random start. The diagnostics say this, but only the history is authoritative. Meanwhile 096 stayed largely feasible from call 44 to call 92 and found its best at call 66. Lesson: early discovery did not become a better final loss. **Losing the feasible region (by restarting away from it) cost T9.** Extra feasible calls on T8 (66 vs 16) did not improve the minimum either. Feasible-call count is not a proxy for quality.
- **096 vs V1.** The ranking reversed between 180 s/seed42 (096 won 2/3, mean −0.1308) and 600 s/seed73 (V1 won 3/3). V1 overran the budget in every cell. At 600 s, 096 kept improving until about 280–360 s and then plateaued while V1 kept improving. That suggests more polish near the incumbent may matter at long horizons. It is a hypothesis, not a calibration.

## 2. Design (newly designed behavior, unmeasured)

1. **SEEK** (no feasible point yet in this episode): 096-style clipped Adam with trust radius and decaying noise on the full default loss. It never fabricates feasibility.
2. **Retention once feasible:**
   - **Incumbent rule.** Only a finite, logged, `is_feasible=True` point with a strictly lower loss replaces the incumbent (`Incumbent.offer`).
   - **Filter.** Infeasible trials are judged with a small filter over the *returned* pair (penalty_sum = Σ `aux['violations']`, `aux['sensitivity_loss']`). penalty_sum is the sum of active squashed-ReLU penalty outputs, **not** raw physical power excess. `is_feasible` is used only as the separate physical flag.
   - **Admission.** A trial is admitted only if no filter entry dominates it within margins and the infeasible streak is ≤ the adaptive cap.
   - **Rejection.** A rejected trial is bisected back toward the last admitted point, up to `max_bisections` times. After that, or once the streak exceeds the cap, the search restores to the episode's best feasible point with a fresh Adam state and trust × 0.7. Every bisection and restoration point is an ordinary logged call.
3. **Adaptive excursion cap (§4).**
4. **Portfolio.** Once a feasible point exists, explore episodes (next public random start, own retention target, filter cleared) alternate with polish episodes (global incumbent, half trust, noise × 0.25). Unlike FARA, the incumbent region is revisited after every exploration, so the T9 failure mode of never returning to it cannot happen.

**Differences from the prior candidates:**
- vs SPG120: no GLL penalized line search. Uses filter acceptance and explicit restoration instead.
- vs FARA122: no fixed six-infeasible trigger, no 4 probes along the objective gradient, and no abandonment of the feasible region on exhaustion. Instead it uses a data-adaptive cap, filter dominance, segment bisection, and alternating polish.

## 3. Parameter / state / call-cost table

| Item | Default | Source | Calibrated? |
|---|---|---|---|
| learning_rate, restarts, restart_patience, trust radii (0.30/0.01/0.80), noise (0.10, 0.997) | 096 values | copied from 096 (measured T4 incumbent) | not for H100/4 h |
| polish_patience | 120 | new | **uncalibrated** |
| hold_noise_scale | 0.25 | new | **uncalibrated** |
| filter_size / margins | 16 / 1e-4 | new; filter concept from Fletcher–Leyffer | **uncalibrated** |
| cap_init / mult / lo / hi | 4 / 2.0 / 2 / 24 | new; FARA's 6 had mixed results | **uncalibrated**; adapts online |
| max_bisections | 3 | new | **uncalibrated** |
| stop_margin / return_reserve_s | 1.10 / 0.05 s | 096 guard (kept every measured 096 cell inside budget on T4) | H100 call time unmeasured |
| max_episodes | 100000 | hard loop bound | n/a |

**Cost per iteration:** exactly one logged `value_and_grad_aux` call, with no extra evaluations. Without a penalty contract it falls back to `value_and_grad`.

**State (n = number of parameters, about 200):**
- Vectors: x, Adam m and v, episode anchor, episode best, global incumbent, and starts (≤16).
- Recent-point ring: 32 hashes of 8n bytes each.
- Filter: ≤16 pairs. Cap history: ≤16 ints.

**Memory bound:** about (6 + 16)·n float64 plus 32·8n bytes for the hash keys, i.e. about 54·8n ≈ 86 KB at n = 200. All of this is O(n). There are no matrices, no Hessian/HVP, and no batching.

## 4. Adaptive rule (no arbitrary time fractions)

The algorithm never switches phase at a fixed fraction of the budget. Phase changes are triggered only by logged events:
- first logged feasible point in an episode;
- filter dominance on returned aux pairs;
- streak > cap;
- patience counts of logged calls.

The cap is `clamp(ceil(2 × mean length of the last 16 natural re-entries), 2, 24)`, where a natural re-entry is an infeasible run that ended in a logged feasible point without forced restoration.

The only time-dependent rule is the 096 predictive stop. It uses public `time_left`/`evals_left` and the observed call durations.

**Safe fallback:** if aux is absent, unknown, malformed or nonfinite, the call is treated as infeasible with no filter information. If the problem has no penalty contract (`power_thresholds is None`), the algorithm runs SEEK-only: 096-like penalized Adam that claims no feasibility.

## 5. Calibration plan (owner-run; not performed here)

1. Static review, then the native reviewer runs `cases_ffr130.py`.
2. Run **only FFR130** on the held-out public T7/T8/T9, seed 42, 180 s, T4 panel. Reuse the exact compatible 096 rows (panel SHA `18d39e9f…`: 5.058707 / 4.977320 / 4.972152), provided the source, runner, package versions and x64 setting match. Do not rerun 096 or FARA cells.
3. Report per-call histories and paired deltas. The diagnostics that matter:
   - longest post-feasible infeasible streak;
   - calls from the last feasible call to the end;
   - when the best was found;
   - restorations.

   Do not use feasible-call count as the success measure.
4. Promote only if there is a measured improvement in best feasible loss. A three-cell 180 s sample cannot settle long-horizon behavior (see the 096/V1 rank reversal).
5. The cap, polish and filter constants remain uncalibrated for H100 and 4 h. Any 4-hour effectiveness claim requires a source-matched full-budget run or an official result. Neither exists.

## 6. Paper pins

- Wächter & Biegler, "Global and Local Convergence of Line Search Filter Methods for Nonlinear Programming", CAPD TR B-01-09 (rev. 2002), §2 / Algorithm I. https://optimization-online.org/wp-content/uploads/2001/08/367.pdf
- Fletcher & Leyffer, *Math. Programming* 91 (2002), DOI 10.1007/s101070100244.

Only the two-measure dominance concept is borrowed. The barrier/SQP convergence theory does **not** apply to UIFO.
